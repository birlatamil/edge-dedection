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

        reader = CameraReader(src, cam_name)
        time.sleep(2)

        win = f"Capture - {cam_name.upper()}"
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)

        saved = 0
        while saved < args.num_frames:
            ret, frame = reader.read()
            if not ret or frame is None:
                time.sleep(0.05)
                continue

            found, corners = find_chessboard(frame, board_size)
            display = frame.copy()

            if found:
                cv2.drawChessboardCorners(display, board_size, corners, found)
                label = f"[{saved}/{args.num_frames}] FOUND - press SPACE to save"
                color = (0, 220, 0)
            else:
                label = "Chessboard NOT detected"
                color = (0, 0, 220)

            cv2.putText(display, label, (10, 36),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
            cv2.imshow(win, display)

            key = cv2.waitKey(30) & 0xFF
            if key == ord('q'):
                break
            elif key == ord(' ') and found:
                fname = os.path.join(save_dir, f"{cam_name}_{saved:03d}.png")
                cv2.imwrite(fname, frame)
                saved += 1
                log.info("[%s] Saved %d/%d -> %s", cam_name, saved, args.num_frames, fname)

        reader.release()
        cv2.destroyAllWindows()
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

        log.info("[%s] Running calibrateCamera() on %d frames...", cam_name, len(obj_points))
        rms, camera_matrix, dist_coeffs, rvecs, tvecs = cv2.calibrateCamera(
            obj_points, img_points, img_size, None, None)
        log.info("[%s] RMS: %.4f px", cam_name, rms)

        # Save calibration
        data = {
            "camera_matrix": camera_matrix.tolist(),
            "dist_coeffs": dist_coeffs.flatten().tolist(),
            "image_width_px": img_size[0],
            "image_height_px": img_size[1],
            "rms": round(rms, 6),
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        log.info("[%s] Calibration saved -> %s", cam_name, out_path)

    log.info("Calibration complete. Files saved in '%s/'.", CALIB_DIR)


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
                new_mtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 1, (w, h))
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

    args = p.parse_args()
    if args.mode == "capture":
        run_capture(args)
    elif args.mode == "calibrate":
        run_calibrate(args)
    elif args.mode == "perspective":
        run_perspective(args)


if __name__ == "__main__":
    main()
