"""
calibrate.py
============
Camera calibration utility for the Fabric Edge Detection system.

Two-step process:
  1. capture   — Save checkerboard frames from live RTSP cameras
  2. calibrate — Compute intrinsic parameters + distortion coefficients

Usage:
  python calibrate.py capture --left-src rtsp://172.32.0.94:554/live/0 --right-src rtsp://172.32.0.93:554/live/0
  python calibrate.py calibrate

Output: calibration_data/left_calib.json and calibration_data/right_calib.json
"""

import argparse
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("calibrate")

CALIB_DIR = "calibration_data"
CAPTURE_DIR = "calibration_images"

os.makedirs(CALIB_DIR, exist_ok=True)


# ── Helpers ──────────────────────────────────────────────────────────────────

def find_chessboard(img, board_size):
    """Find chessboard corners with robust preprocessing."""
    flags = (cv2.CALIB_CB_ADAPTIVE_THRESH
             + cv2.CALIB_CB_NORMALIZE_IMAGE
             + cv2.CALIB_CB_FAST_CHECK)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    found, corners = cv2.findChessboardCorners(gray, board_size, flags)
    if found:
        return True, corners

    # Try CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray_clahe = clahe.apply(gray)
    found, corners = cv2.findChessboardCorners(gray_clahe, board_size, flags)
    return found, corners


class CameraReader:
    """Threaded RTSP reader to avoid lag."""
    def __init__(self, src, name):
        self.src = src
        self.name = name
        self.cap = cv2.VideoCapture(src)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.ret, self.frame = self.cap.read()
        self.running = True
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()

    def _update(self):
        while self.running:
            if self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret:
                    with self.lock:
                        self.ret, self.frame = ret, frame
                else:
                    time.sleep(0.5)
                    self.cap.open(self.src)
            else:
                time.sleep(0.5)
                self.cap.open(self.src)

    def read(self):
        with self.lock:
            return self.ret, self.frame.copy() if self.frame is not None else (False, None)

    def release(self):
        self.running = False
        self.thread.join(timeout=3)
        self.cap.release()


# ── Capture Mode ─────────────────────────────────────────────────────────────

def draw_coverage_heatmap(display, coverage_grid, grid_rows=3, grid_cols=3):
    """Draw a semi-transparent 3x3 coverage heatmap overlay on the display frame."""
    h, w = display.shape[:2]
    cell_h = h // grid_rows
    cell_w = w // grid_cols
    overlay = display.copy()

    for r in range(grid_rows):
        for c in range(grid_cols):
            count = coverage_grid[r][c]
            x1, y1 = c * cell_w, r * cell_h
            x2, y2 = (c + 1) * cell_w, (r + 1) * cell_h

            if count >= 2:
                color = (0, 180, 0)     # green = good coverage
            elif count == 1:
                color = (0, 200, 255)   # yellow = needs more
            else:
                color = (0, 0, 200)     # red = no coverage

            cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
            cv2.putText(overlay, str(count), (x1 + cell_w // 2 - 10, y1 + cell_h // 2 + 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

    cv2.addWeighted(overlay, 0.25, display, 0.75, 0, display)

    # Draw grid lines
    for r in range(1, grid_rows):
        cv2.line(display, (0, r * cell_h), (w, r * cell_h), (255, 255, 255), 1)
    for c in range(1, grid_cols):
        cv2.line(display, (c * cell_w, 0), (c * cell_w, h), (255, 255, 255), 1)


def get_checkerboard_zone(corners, frame_shape, grid_rows=3, grid_cols=3):
    """Determine which 3x3 grid zone(s) a detected checkerboard falls into."""
    h, w = frame_shape[:2]
    cell_h = h // grid_rows
    cell_w = w // grid_cols
    # Use center of the chessboard corners
    cx = np.mean(corners[:, 0, 0])
    cy = np.mean(corners[:, 0, 1])
    col = min(int(cx // cell_w), grid_cols - 1)
    row = min(int(cy // cell_h), grid_rows - 1)
    return row, col


def run_capture(args):
    board_size = (args.cols, args.rows)
    cameras = []
    if args.camera in ("left", "both"):
        cameras.append(("left", args.left_src))
    if args.camera in ("right", "both"):
        cameras.append(("right", args.right_src))

    for cam_name, src in cameras:
        save_dir = os.path.join(CAPTURE_DIR, cam_name)
        os.makedirs(save_dir, exist_ok=True)

        log.info("=== Capturing %s camera (src=%s) ===", cam_name.upper(), src)
        log.info("Press SPACE to capture when chessboard is detected. Press Q when done.")
        log.info("Coverage heatmap: GREEN=good (2+), YELLOW=needs more (1), RED=no coverage (0)")
        log.info("TIP: Move the checkerboard to RED/YELLOW zones for best calibration!")

        reader = CameraReader(src, cam_name)
        time.sleep(2)

        win = f"Capture - {cam_name.upper()}"
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)

        saved = 0
        coverage_grid = [[0]*3 for _ in range(3)]  # 3x3 coverage tracker

        while saved < args.num_frames:
            ret, frame = reader.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue

            found, corners = find_chessboard(frame, board_size)
            display = frame.copy()

            # Draw coverage heatmap
            draw_coverage_heatmap(display, coverage_grid)

            if found:
                cv2.drawChessboardCorners(display, board_size, corners, found)
                row, col = get_checkerboard_zone(corners, frame.shape)
                zone_count = coverage_grid[row][col]
                zone_status = "GOOD" if zone_count >= 2 else ("OK" if zone_count >= 1 else "NEEDED!")
                label = f"[{saved}/{args.num_frames}] FOUND (zone {row},{col}: {zone_status}) - SPACE to save"
                color = (0, 220, 0)
            else:
                label = "Chessboard NOT detected"
                color = (0, 0, 220)

            cv2.putText(display, label, (10, 36),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

            # Show total coverage status
            total_covered = sum(1 for r in coverage_grid for c in r if c >= 2)
            cv2.putText(display, f"Coverage: {total_covered}/9 zones ready", (10, 65),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

            cv2.imshow(win, display)

            key = cv2.waitKey(30) & 0xFF
            if key == ord('q'):
                break
            elif key == ord(' ') and found:
                fname = os.path.join(save_dir, f"{cam_name}_{saved:03d}.png")
                cv2.imwrite(fname, frame)
                saved += 1
                # Update coverage grid
                row, col = get_checkerboard_zone(corners, frame.shape)
                coverage_grid[row][col] += 1
                log.info("[%s] Saved %d/%d -> %s (zone %d,%d)", cam_name, saved, args.num_frames, fname, row, col)

        reader.release()
        cv2.destroyAllWindows()

        total_covered = sum(1 for r in coverage_grid for c in r if c >= 2)
        if total_covered < 5:
            log.warning("[%s] Only %d/9 zones have good coverage. Consider recapturing with better spread!", cam_name, total_covered)
        else:
            log.info("[%s] Good coverage: %d/9 zones.", cam_name, total_covered)
        log.info("[%s] Capture complete: %d frames saved to '%s'", cam_name, saved, save_dir)

    log.info("Run `python calibrate.py calibrate` next.")


# ── Calibrate Mode ───────────────────────────────────────────────────────────

def run_calibrate(args):
    cameras = []
    if args.camera in ("left", "both"):
        cameras.append(("left", os.path.join(CALIB_DIR, "left_calib.json")))
    if args.camera in ("right", "both"):
        cameras.append(("right", os.path.join(CALIB_DIR, "right_calib.json")))

    board_size = (args.cols, args.rows)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)

    # 3D object points
    objp = np.zeros((args.rows * args.cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:args.cols, 0:args.rows].T.reshape(-1, 2) * args.square_mm

    for cam_name, out_path in cameras:
        img_folder = os.path.join(CAPTURE_DIR, cam_name)
        exts = {".png", ".jpg", ".jpeg", ".bmp"}
        paths = sorted(p for p in Path(img_folder).iterdir() if p.suffix.lower() in exts)

        if not paths:
            log.error("[%s] No images in '%s'. Run capture first.", cam_name, img_folder)
            continue

        log.info("[%s] Detecting chessboard in %d images...", cam_name, len(paths))

        obj_points = []
        img_points = []
        img_size = None

        for i, p in enumerate(paths):
            img = cv2.imread(str(p))
            if img is None:
                continue
            if img_size is None:
                img_size = (img.shape[1], img.shape[0])

            found, corners = find_chessboard(img, board_size)
            if found:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                corners_refined = cv2.cornerSubPix(
                    gray, corners, (11, 11), (-1, -1), criteria)
                obj_points.append(objp)
                img_points.append(corners_refined)
                log.info("[%s] Image %d/%d: chessboard detected", cam_name, i+1, len(paths))
            else:
                log.warning("[%s] Image %d/%d: chessboard NOT detected", cam_name, i+1, len(paths))

        if len(obj_points) < 5:
            log.error("[%s] Only %d usable images, need at least 5.", cam_name, len(obj_points))
            continue

        log.info("[%s] Running calibrateCamera() on %d frames (with CALIB_FIX_K3)...", cam_name, len(obj_points))
        calib_flags = cv2.CALIB_FIX_K3  # Prevent overfitting of k3
        rms, camera_matrix, dist_coeffs, rvecs, tvecs = cv2.calibrateCamera(
            obj_points, img_points, img_size, None, None, flags=calib_flags)
        log.info("[%s] Overall RMS: %.4f px", cam_name, rms)

        # Per-image reprojection error
        log.info("[%s] Per-image reprojection errors:", cam_name)
        per_image_errors = []
        for i in range(len(obj_points)):
            img_pts_proj, _ = cv2.projectPoints(obj_points[i], rvecs[i], tvecs[i], camera_matrix, dist_coeffs)
            err = cv2.norm(img_points[i], img_pts_proj, cv2.NORM_L2) / len(img_pts_proj)
            per_image_errors.append(round(err, 4))
            status = "OK" if err < 1.0 else "HIGH"
            log.info("  Image %d: %.4f px [%s]", i, err, status)

        high_error_count = sum(1 for e in per_image_errors if e >= 1.0)
        if high_error_count > 0:
            log.warning("[%s] %d images have high reprojection error (>1.0 px). Consider re-capturing those.", cam_name, high_error_count)

        # Save calibration
        data = {
            "camera_matrix": camera_matrix.tolist(),
            "dist_coeffs": dist_coeffs.flatten().tolist(),
            "image_width_px": img_size[0],
            "image_height_px": img_size[1],
            "rms": round(rms, 6),
            "per_image_rms": per_image_errors,
            "calib_flags": "CALIB_FIX_K3",
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        log.info("[%s] Calibration saved -> %s", cam_name, out_path)
        log.info("[%s] dist_coeffs: k1=%.4f, k2=%.4f, p1=%.4f, p2=%.4f, k3=%.4f (fixed=0)",
                 cam_name, *dist_coeffs.flatten()[:5])

    log.info("Calibration complete. Files saved in '%s/'.", CALIB_DIR)


# ── Test Intrinsic Calibration ───────────────────────────────────────────────

def run_test(args):
    """
    Shows live feed from cameras: Original vs Undistorted side-by-side.
    Allows user to visually verify if the calibration is working perfectly.
    """
    cameras = []
    if args.camera in ("left", "both"):
        cameras.append(("left", args.left_src, os.path.join(CALIB_DIR, "left_calib.json")))
    if args.camera in ("right", "both"):
        cameras.append(("right", args.right_src, os.path.join(CALIB_DIR, "right_calib.json")))

    for cam_name, src, calib_path in cameras:
        log.info("=== Testing Intrinsic Calibration for %s camera ===", cam_name.upper())

        mapx, mapy = None, None
        w, h = 0, 0
        if os.path.exists(calib_path):
            with open(calib_path, 'r') as f:
                data = json.load(f)
                mtx = np.array(data["camera_matrix"])
                dist = np.array(data["dist_coeffs"])
                w = data.get("image_width_px", 1280)
                h = data.get("image_height_px", 720)
                new_mtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 0, (w, h))
                mapx, mapy = cv2.initUndistortRectifyMap(mtx, dist, None, new_mtx, (w, h), cv2.CV_32FC1)
        else:
            log.warning("Lens calibration not found at %s. Please run calibrate first.", calib_path)
            continue

        reader = CameraReader(src, cam_name)
        time.sleep(1.5)
        
        win = f"Test Calibration - {cam_name.upper()} (Left: Original, Right: Undistorted)"
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)
        log.info("Press 'q' or ESC to proceed or close.")

        while True:
            ret, frame = reader.read()
            if not ret or frame is None:
                time.sleep(0.01)
                continue
                
            undistorted = cv2.remap(frame, mapx, mapy, cv2.INTER_LINEAR)
            
            # Put both side by side
            vis = np.concatenate((frame, undistorted), axis=1)
            
            # Show a grid of lines to help see straightness
            h_v, w_v = vis.shape[:2]
            for grid_y in range(0, h_v, h_v // 10):
                cv2.line(vis, (0, grid_y), (w_v, grid_y), (0, 0, 255), 1)
            for grid_x in range(0, w_v, w_v // 20):
                cv2.line(vis, (grid_x, 0), (grid_x, h_v), (0, 0, 255), 1)

            cv2.imshow(win, vis)
            k = cv2.waitKey(20) & 0xFF
            if k == 27 or k == ord('q'):
                break
                
        reader.release()
        cv2.destroyAllWindows()


# ── Perspective Mode ─────────────────────────────────────────────────────────

def run_perspective(args):
    """
    Computes a homography matrix turning the fabric plane into a flat, 
    top-down orthographic view to correct perspective scaling distortion.
    """
    cameras = []
    if args.camera in ("left", "both"):
        cameras.append(("left", args.left_src, os.path.join(CALIB_DIR, "left_calib.json"), os.path.join(CALIB_DIR, "left_homography.json")))
    if args.camera in ("right", "both"):
        cameras.append(("right", args.right_src, os.path.join(CALIB_DIR, "right_calib.json"), os.path.join(CALIB_DIR, "right_homography.json")))

    for cam_name, src, calib_path, out_path in cameras:
        log.info("=== Perspective Calibration %s camera ===", cam_name.upper())

        # Load lens calibration for undistortion
        mapx, mapy = None, None
        w, h = 0, 0
        if os.path.exists(calib_path):
            with open(calib_path, 'r') as f:
                data = json.load(f)
                mtx = np.array(data["camera_matrix"])
                dist = np.array(data["dist_coeffs"])
                w = data.get("image_width_px", 1280)
                h = data.get("image_height_px", 720)
                new_mtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 0, (w, h))
                mapx, mapy = cv2.initUndistortRectifyMap(mtx, dist, None, new_mtx, (w, h), cv2.CV_32FC1)
        else:
            log.warning("Lens calibration not found at %s. Please run calibrate first.", calib_path)

        reader = CameraReader(src, cam_name)
        time.sleep(1.5)
        
        log.info("[%s] Reading a stable frame...", cam_name)
        frame = None
        for _ in range(10):
            ret, tmp = reader.read()
            if ret:
                frame = tmp
            time.sleep(0.1)
            
        reader.release()
        
        if frame is None:
            log.error("[%s] Failed to capture frame. Skipping.", cam_name)
            continue
            
        # Apply lens undistortion first
        if mapx is not None and mapy is not None:
            frame = cv2.remap(frame, mapx, mapy, cv2.INTER_LINEAR)
            
        pts = []
        win = f"Perspective - {cam_name.upper()}"
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)
        
        def mouse_cb(event, x, y, flags, param):
            if event == cv2.EVENT_LBUTTONDOWN:
                if len(pts) < 4:
                    pts.append([x, y])
            if event == cv2.EVENT_RBUTTONDOWN:
                if pts:
                    pts.pop()

        cv2.setMouseCallback(win, mouse_cb)
        
        log.info("1) Place a known rectangle (e.g. A4 paper %dx%d mm) on the fabric bed.", args.rect_width_mm, args.rect_height_mm)
        log.info("2) Click the 4 corners of the rectangle IN ORDER: Top-Left, Top-Right, Bottom-Right, Bottom-Left.")
        log.info("3) Right-click to undo a point.")
        log.info("4) Press ENTER when all 4 points are selected.")

        while True:
            disp = frame.copy()
            for i, p in enumerate(pts):
                cv2.circle(disp, tuple(p), 5, (0, 255, 0), -1)
                cv2.putText(disp, f"{i+1}", (p[0]+10, p[1]-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                if i > 0:
                    cv2.line(disp, tuple(pts[i-1]), tuple(pts[i]), (255, 0, 0), 2)
            if len(pts) == 4:
                cv2.line(disp, tuple(pts[3]), tuple(pts[0]), (255, 0, 0), 2)
                cv2.putText(disp, "Press ENTER to confirm", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

            cv2.imshow(win, disp)
            k = cv2.waitKey(20) & 0xFF
            if k == 13 or k == ord('\r'): # Enter key
                if len(pts) == 4:
                    break
        
        cv2.destroyAllWindows()
        
        if len(pts) != 4:
            log.warning("[%s] Need 4 points! Skipping.", cam_name)
            continue
            
        src_rect = np.array(pts, dtype="float32")
        
        out_w = w if w > 0 else frame.shape[1]
        out_h = h if h > 0 else frame.shape[0]
        
        phys_w = args.rect_width_mm
        phys_h = args.rect_height_mm
        
        px_scale = args.px_per_mm
        tw = int(phys_w * px_scale)
        th = int(phys_h * px_scale)
        
        cx, cy = out_w / 2, out_h / 2
        
        dst_rect = np.array([
            [cx - tw/2, cy - th/2],  # TL
            [cx + tw/2, cy - th/2],  # TR
            [cx + tw/2, cy + th/2],  # BR
            [cx - tw/2, cy + th/2]   # BL
        ], dtype="float32")
        
        M = cv2.getPerspectiveTransform(src_rect, dst_rect)
        
        data = {
            "homography": M.tolist(),
            "scale_px_per_mm": px_scale,
            "out_width": out_w,
            "out_height": out_h
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            
        log.info("[%s] Saved homography to %s", cam_name, out_path)

    log.info("Perspective calibration done.")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Camera Calibration Utility")
    sub = p.add_subparsers(dest="mode", required=True)

    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument('--left-src', default="rtsp://172.32.0.94:554/live/0")
    shared.add_argument('--right-src', default="rtsp://172.32.0.93:554/live/0")
    shared.add_argument('--cols', type=int, default=10, help='Chessboard inner corner columns')
    shared.add_argument('--rows', type=int, default=9, help='Chessboard inner corner rows')
    shared.add_argument('--camera', choices=["left", "right", "both"], default="both")

    cap_p = sub.add_parser("capture", parents=[shared],
                           help="Capture checkerboard frames from live cameras")
    cap_p.add_argument('--num-frames', type=int, default=20, help='Frames to capture per camera')

    cal_p = sub.add_parser("calibrate", parents=[shared],
                           help="Calibrate from saved images")
    cal_p.add_argument('--square-mm', type=float, default=25.0, help='Checkerboard square size in mm')

    persp_p = sub.add_parser("perspective", parents=[shared],
                             help="Calibrate perspective (homography) to get top-down view")
    persp_p.add_argument('--rect-width-mm', type=float, default=500.0, help='Physical width of the calibration rectangle in mm')
    persp_p.add_argument('--rect-height-mm', type=float, default=200.0, help='Physical height of the calibration rectangle in mm')
    persp_p.add_argument('--px-per-mm', type=float, default=1.0, help='Scaling factor in the output top-down image')

    test_p = sub.add_parser("test", parents=[shared],
                            help="Test intrinsic calibration by viewing side-by-side original and undistorted streams")

    args = p.parse_args()
    if args.mode == "capture":
        run_capture(args)
    elif args.mode == "calibrate":
        run_calibrate(args)
    elif args.mode == "perspective":
        run_perspective(args)
    elif args.mode == "test":
        run_test(args)


if __name__ == "__main__":
    main()
