import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

import cv2
import numpy as np
import argparse
import threading
import time
import json

from scipy.signal import find_peaks
from collections import deque
from concurrent.futures import ProcessPoolExecutor


class RTSPCamera:
    def __init__(self, src, name="Camera", calib_file=None, homography_file=None, use_perspective=True):
        self.src = src
        self.name = name
        self.cap = cv2.VideoCapture(self.src, cv2.CAP_FFMPEG)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 2)
        self.ret, self.frame = self.cap.read()
        self.running = True
        self.lock = threading.Lock()
        
        # Calibration map
        self.mapx = None
        self.mapy = None
        if calib_file and os.path.exists(calib_file):
            print(f"[{self.name}] Loading calibration from {calib_file}")
            with open(calib_file, 'r') as f:
                data = json.load(f)
                mtx = np.array(data["camera_matrix"])
                dist = np.array(data["dist_coeffs"])
                w = data["image_width_px"]
                h = data["image_height_px"]
                new_mtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 0, (w, h))
                self.mapx, self.mapy = cv2.initUndistortRectifyMap(mtx, dist, None, new_mtx, (w, h), cv2.CV_32FC1)
        else:
            if calib_file:
                print(f"[{self.name}] Warning: Calibration file {calib_file} not found. Skipping undistort.")

        # Homography (perspective correction)
        self.homography = None
        self.homography_size = None
        self.scale_px_per_mm = None
        if use_perspective and homography_file and os.path.exists(homography_file):
            print(f"[{self.name}] Loading homography from {homography_file}")
            with open(homography_file, 'r') as f:
                hdata = json.load(f)
                self.homography = np.array(hdata["homography"], dtype=np.float64)
                self.homography_size = (hdata["out_width"], hdata["out_height"])
                self.scale_px_per_mm = hdata.get("scale_px_per_mm", None)
        elif use_perspective and homography_file:
            print(f"[{self.name}] Warning: Homography file {homography_file} not found. Skipping perspective.")

        self.thread = threading.Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()

    def update(self):
        """Background thread to keep reading frames to avoid delay/lag."""
        while self.running:
            if self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret:
                    with self.lock:
                        self.ret = ret
                        self.frame = frame
                else:
                    print(f"[{self.name}] Connection lost. Reconnecting...")
                    time.sleep(1.0)
                    self.cap.open(self.src, cv2.CAP_FFMPEG)
            else:
                time.sleep(1.0)
                self.cap.open(self.src, cv2.CAP_FFMPEG)

    def read(self):
        with self.lock:
            ret, frame = self.ret, self.frame.copy() if self.frame is not None else None
            
        if ret and frame is not None:
            if self.mapx is not None and self.mapy is not None:
                frame = cv2.remap(frame, self.mapx, self.mapy, cv2.INTER_LINEAR)
            if self.homography is not None:
                frame = cv2.warpPerspective(frame, self.homography, self.homography_size)
        
        return ret, frame

    def release(self):
        self.running = False
        self.thread.join()
        self.cap.release()


# ─── AOI Helpers ────────────────────────────────────────────────────────────────

def select_aoi_interactive(frame, window_name="Select AOI"):
    """Let the user draw a rectangle on the frame to define the AOI."""
    print(f"[{window_name}] Draw a rectangle for AOI, then press ENTER or SPACE. Press 'c' to cancel (use full frame).")
    roi = cv2.selectROI(window_name, frame, fromCenter=False, showCrosshair=True)
    cv2.destroyWindow(window_name)
    x, y, w, h = roi
    if w == 0 or h == 0:
        h_frame, w_frame = frame.shape[:2]
        return (0, 0, w_frame, h_frame)
    return (x, y, w, h)


def parse_aoi_string(aoi_str):
    """Parse 'x,y,w,h' string into a tuple of ints."""
    parts = [int(v.strip()) for v in aoi_str.split(',')]
    if len(parts) != 4:
        raise ValueError(f"AOI must be 'x,y,w,h', got: {aoi_str}")
    return tuple(parts)


def crop_to_aoi(frame, aoi):
    """Crop the frame to the given AOI (x, y, w, h)."""
    x, y, w, h = aoi
    return frame[y:y+h, x:x+w]


# ─── Edge Detection (Sobel-X Gradient Projection) ─────────────────────────────

def _subpixel_refine(projection, peak_idx):
    """Refine a peak index to sub-pixel accuracy using parabola fitting."""
    if 1 <= peak_idx <= len(projection) - 2:
        y_left = projection[peak_idx - 1]
        y_center = projection[peak_idx]
        y_right = projection[peak_idx + 1]
        denom = 2.0 * (2.0 * y_center - y_left - y_right)
        if abs(denom) > 1e-6:
            offset = (y_left - y_right) / denom
            return peak_idx + offset
    return float(peak_idx)


def find_fabric_edges_sobel(frame, min_prominence_ratio=5.0, min_peak_distance=50,
                            gaussian_sigma=15):
    """
    Finds fabric edges using Sobel-X gradient projection.

    Positive horizontal gradients (dark→light) indicate LEFT edges of the cloth.
    Negative horizontal gradients (light→dark) indicate RIGHT edges.

    Uses prominence-based adaptive thresholding: a peak is only accepted if
    its value is > min_prominence_ratio × median(projection).

    Returns:
        dict with keys:
            'left_edges'  : list of float x-coordinates (positive-gradient edges)
            'right_edges' : list of float x-coordinates (negative-gradient edges)
        OR None if no cloth is detected in either direction.
    """
    if frame is None:
        return None

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Sobel-X: horizontal gradient (float64 to preserve sign)
    sobel_x = cv2.Sobel(blurred, cv2.CV_64F, 1, 0, ksize=5)

    # Split into positive (left/rising edges) and negative (right/falling edges)
    pos_gradient = np.clip(sobel_x, 0, None)   # dark → light transitions
    neg_gradient = np.clip(-sobel_x, 0, None)   # light → dark transitions

    # Vertical projection: sum each column
    pos_proj = np.sum(pos_gradient, axis=0)
    neg_proj = np.sum(neg_gradient, axis=0)

    # Smooth projections with Gaussian kernel to suppress texture noise
    ksize = int(gaussian_sigma * 6) | 1  # ensure odd
    pos_proj = cv2.GaussianBlur(pos_proj.reshape(1, -1), (ksize, 1), gaussian_sigma).flatten()
    neg_proj = cv2.GaussianBlur(neg_proj.reshape(1, -1), (ksize, 1), gaussian_sigma).flatten()

    # Zero out border margins to avoid false positives from frame edges
    margin = 20
    pos_proj[:margin] = 0
    pos_proj[-margin:] = 0
    neg_proj[:margin] = 0
    neg_proj[-margin:] = 0

    left_edges = []
    right_edges = []

    # --- Find LEFT edges (positive gradient peaks) ---
    pos_median = np.median(pos_proj[pos_proj > 0]) if np.any(pos_proj > 0) else 1.0
    pos_threshold = pos_median * min_prominence_ratio
    pos_peaks, pos_props = find_peaks(pos_proj, distance=min_peak_distance,
                                       prominence=pos_threshold)
    # Sort by prominence (strongest first), keep top 2
    if len(pos_peaks) > 0:
        order = np.argsort(pos_props['prominences'])[::-1]
        for idx in order[:2]:
            pk = pos_peaks[idx]
            refined = _subpixel_refine(pos_proj, pk)
            left_edges.append(refined)
        left_edges.sort()  # left-to-right order

    # --- Find RIGHT edges (negative gradient peaks) ---
    neg_median = np.median(neg_proj[neg_proj > 0]) if np.any(neg_proj > 0) else 1.0
    neg_threshold = neg_median * min_prominence_ratio
    neg_peaks, neg_props = find_peaks(neg_proj, distance=min_peak_distance,
                                       prominence=neg_threshold)
    if len(neg_peaks) > 0:
        order = np.argsort(neg_props['prominences'])[::-1]
        for idx in order[:2]:
            pk = neg_peaks[idx]
            refined = _subpixel_refine(neg_proj, pk)
            right_edges.append(refined)
        right_edges.sort()

    # If absolutely no edges found in either direction → no cloth
    if len(left_edges) == 0 and len(right_edges) == 0:
        return None

    return {'left_edges': left_edges, 'right_edges': right_edges}


def draw_vertical_guide(frame, x, label, color=(0, 255, 255), thickness=2):
    """Draw a vertical guide line with a circle marker and text label."""
    height, width = frame.shape[:2]
    x = int(round(x))
    if x < 0 or x >= width:
        return
    cv2.line(frame, (x, 0), (x, height), color, thickness)
    cv2.circle(frame, (x, height // 2), 8, color, -1)
    text_x = x + 10 if x + 210 < width else x - 210
    text_x = max(10, min(text_x, width - 210))
    cv2.putText(frame, label, (text_x, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)


def draw_overlap_guides(frame, mm_per_px, side, guide_distance_mm=100.0):
    """Draw an overlap guide pair per camera: left camera gets L-overlap and center, right camera gets center and R-overlap."""
    if frame is None:
        return
    height, width = frame.shape[:2]
    center_x = width // 2
    if mm_per_px and mm_per_px > 1e-6:
        offset_px = int(round(guide_distance_mm / mm_per_px))
    else:
        offset_px = int(round(guide_distance_mm * 0.5))
    offset_px = max(10, min(offset_px, center_x - 10))

    if side == 'left':
        points = [
            (center_x - offset_px, f"L overlap ({guide_distance_mm:.0f} mm)"),
            (center_x, "Center")
        ]
    else:
        points = [
            (center_x, "Center"),
            (center_x + offset_px, f"R overlap ({guide_distance_mm:.0f} mm)")
        ]

    for x, label in points:
        draw_vertical_guide(frame, x, label)


# ─── Custom Guides ─────────────────────────────────────────────────────────────

custom_guides = {'left': [], 'right': []}

def mouse_callback(event, x, y, flags, param):
    """Mouse callback to add/remove custom guide lines."""
    side = param
    if event == cv2.EVENT_LBUTTONDOWN:
        custom_guides[side].append(x)
    elif event == cv2.EVENT_RBUTTONDOWN:
        if custom_guides[side]:
            custom_guides[side].pop()


# ─── Multiprocessing wrapper ───────────────────────────────────────────────────

def _process_frame(args):
    """
    Top-level function for multiprocessing.
    Receives (frame, aoi_or_none) and returns an edge dict
    in the ORIGINAL frame coordinate system, or None if no cloth.
    """
    frame, aoi = args
    if frame is None:
        return None

    if aoi is not None:
        cropped = crop_to_aoi(frame, aoi)
        result = find_fabric_edges_sobel(cropped)
        if result is None:
            return None
        # Translate local AOI coordinates back to full-frame coordinates
        ox = aoi[0]
        result['left_edges'] = [e + ox for e in result['left_edges']]
        result['right_edges'] = [e + ox for e in result['right_edges']]
        return result
    else:
        return find_fabric_edges_sobel(frame)


# ─── Stable Width Filter ──────────────────────────────────────────────────────

class StableWidthFilter:
    """
    Smooths the pixel-width output:
      - Keeps a sliding window of recent readings.
      - Rejects outliers (readings that deviate from the median by more than
        `max_deviation_px` pixels are ignored).
      - Returns the mean of the remaining "good" readings.
    """

    def __init__(self, window_size=30, max_deviation_px=50):
        self.window = deque(maxlen=window_size)
        self.max_deviation_px = max_deviation_px
        self.last_stable = 0.0

    def update(self, raw_width_px):
        """Feed a new raw measurement. Returns the stabilised width, or None if input is None."""
        if raw_width_px is None:
            return None

        if len(self.window) >= 5:
            median = np.median(self.window)
            # Reject big jumps (outliers)
            if abs(raw_width_px - median) > self.max_deviation_px:
                # Ignore this reading, return last stable value
                return self.last_stable

        self.window.append(raw_width_px)

        if len(self.window) == 0:
            self.last_stable = raw_width_px
        else:
            # Average only the inliers (values within max_deviation of median)
            arr = np.array(self.window)
            median = np.median(arr)
            mask = np.abs(arr - median) <= self.max_deviation_px
            inliers = arr[mask]
            self.last_stable = float(np.mean(inliers)) if len(inliers) > 0 else float(median)

        return self.last_stable


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fabric Edge Detection from Dual RTSP Cameras")
    parser.add_argument('--left-src', type=str, default="rtsp://172.32.0.94:554/live/0",
                        help='RTSP stream for left camera')
    parser.add_argument('--right-src', type=str, default="rtsp://172.32.0.93:554/live/0",
                        help='RTSP stream for right camera')

    # AOI arguments
    parser.add_argument('--aoi-mode', type=str, default='full',
                        choices=['full', 'interactive', 'manual'],
                        help='AOI mode: full (entire frame), interactive (draw on first frame), manual (pass coordinates)')
    parser.add_argument('--aoi-left', type=str, default=None,
                        help='Manual AOI for left camera as "x,y,w,h"')
    parser.add_argument('--aoi-right', type=str, default=None,
                        help='Manual AOI for right camera as "x,y,w,h"')

    # Multiprocessing
    parser.add_argument('--workers', type=int, default=2,
                        help='Number of worker processes for edge detection (default: 2)')

    # Calibration: user measures actual cloth width and provides it
    parser.add_argument('--cloth-width-mm', type=float, default=None,
                        help='Actual cloth width in mm for calibration. The system captures '
                             'the first few frames to compute mm/px ratio, then displays width in mm.')
    parser.add_argument('--guide-overlap-mm', type=float, default=100.0,
                        help='Distance in mm from center to each overlap guide line (default: 100 mm)')

    # Stabilisation
    parser.add_argument('--smooth-window', type=int, default=30,
                        help='Number of frames for the moving-average smoothing window (default: 30)')
    parser.add_argument('--max-deviation', type=float, default=50.0,
                        help='Max allowed pixel deviation from median before a reading is rejected as outlier (default: 50)')

    # Perspective
    parser.add_argument('--no-perspective', action='store_true',
                        help='Disable perspective (homography) correction')

    args = parser.parse_args()

    # ── Initialize cameras ──────────────────────────────────────────────────
    use_persp = not args.no_perspective
    print(f"Perspective correction: {'ON' if use_persp else 'OFF'}")

    print(f"Initializing Left Camera: {args.left_src}")
    left_cam = RTSPCamera(args.left_src, "LeftCam",
                          calib_file="calibration_data/left_calib.json",
                          homography_file="calibration_data/left_homography.json",
                          use_perspective=use_persp)

    print(f"Initializing Right Camera: {args.right_src}")
    right_cam = RTSPCamera(args.right_src, "RightCam",
                           calib_file="calibration_data/right_calib.json",
                           homography_file="calibration_data/right_homography.json",
                           use_perspective=use_persp)

    time.sleep(2)
    print("Cameras initialized.")

    # ── Determine AOI for each camera ───────────────────────────────────────
    left_aoi = None
    right_aoi = None

    if args.aoi_mode == 'interactive':
        _, first_left = left_cam.read()
        _, first_right = right_cam.read()
        if first_left is not None:
            left_aoi = select_aoi_interactive(first_left, "Select AOI - Left Camera")
            print(f"Left AOI set to: {left_aoi}")
        if first_right is not None:
            right_aoi = select_aoi_interactive(first_right, "Select AOI - Right Camera")
            print(f"Right AOI set to: {right_aoi}")

    elif args.aoi_mode == 'manual':
        if args.aoi_left:
            left_aoi = parse_aoi_string(args.aoi_left)
            print(f"Left AOI (manual): {left_aoi}")
        if args.aoi_right:
            right_aoi = parse_aoi_string(args.aoi_right)
            print(f"Right AOI (manual): {right_aoi}")

    # ── Create process pool ─────────────────────────────────────────────────
    executor = ProcessPoolExecutor(max_workers=args.workers)

    # ── Stable width filter ─────────────────────────────────────────────────
    width_filter = StableWidthFilter(
        window_size=args.smooth_window,
        max_deviation_px=args.max_deviation
    )

    # ── Calibration state ───────────────────────────────────────────────────
    mm_per_px = None
    calibration_done = False
    calibration_samples = []
    CALIBRATION_FRAMES = 60  # collect 60 frames for initial calibration

    # If homography provides a known scale, use it directly
    if use_persp and left_cam.scale_px_per_mm and left_cam.scale_px_per_mm > 0:
        mm_per_px = 1.0 / left_cam.scale_px_per_mm
        calibration_done = True
        print(f"\n=== SCALE FROM HOMOGRAPHY ===")
        print(f"mm/px = {mm_per_px:.4f} (derived from perspective calibration)")
        print(f"NOTE: Use --cloth-width-mm to override with runtime calibration\n")

    if not calibration_done and args.cloth_width_mm is not None:
        print(f"\n=== CALIBRATION MODE ===")
        print(f"Cloth width: {args.cloth_width_mm:.1f} mm")
        print(f"Collecting {CALIBRATION_FRAMES} frames to compute mm/px ratio...")
        print(f"Keep the cloth steady during calibration!\n")
    else:
        calibration_done = True  # no calibration needed, output in px only

    print("Press 'q' to quit. Press 'c' to clear custom guide lines.")
    print("Left-click on video to add a custom guide, Right-click to remove last guide.")
    cv2.namedWindow("Edge Detection - Left", cv2.WINDOW_NORMAL)
    cv2.setMouseCallback("Edge Detection - Left", mouse_callback, 'left')
    cv2.namedWindow("Edge Detection - Right", cv2.WINDOW_NORMAL)
    cv2.setMouseCallback("Edge Detection - Right", mouse_callback, 'right')

    fps_tick = time.perf_counter()
    frame_count = 0

    try:
        while True:
            ret_l, frame_l = left_cam.read()
            ret_r, frame_r = right_cam.read()

            if ret_l and ret_r and frame_l is not None and frame_r is not None:
                # Dispatch both frames for parallel edge detection
                future_left = executor.submit(
                    _process_frame,
                    (frame_l, left_aoi)
                )
                future_right = executor.submit(
                    _process_frame,
                    (frame_r, right_aoi)
                )

                left_result = future_left.result()   # dict or None
                right_result = future_right.result()  # dict or None

<<<<<<< HEAD
                # Gather all detected edges per camera
                left_all = []   # all edge x-coords found in left camera
                right_all = []  # all edge x-coords found in right camera
                if left_result is not None:
                    left_all = sorted(left_result['left_edges'] + left_result['right_edges'])
                if right_result is not None:
                    right_all = sorted(right_result['left_edges'] + right_result['right_edges'])

                left_has_cloth = len(left_all) > 0
                right_has_cloth = len(right_all) > 0

                # ── Width Calculation (3 cases) ─────────────────────────────
                raw_width_px = None

                if left_has_cloth and right_has_cloth:
                    # CASE 1: Cloth spans both cameras
                    leftmost_edge = left_all[0]
                    rightmost_edge = right_all[-1]

                    # Save current edges for stitch calibration
                    current_left_edge = leftmost_edge
                    current_right_edge = rightmost_edge

                    if stitch_calibrated and stitch_offset is not None:
                        raw_width_px = (rightmost_edge + stitch_offset) - leftmost_edge
                    else:
                        width_right_frame = frame_r.shape[1]
                        if mm_per_px and mm_per_px > 1e-6:
                            overlap_px = int(round(args.guide_overlap_mm / mm_per_px))
                        else:
                            overlap_px = 144
                        raw_width_px = leftmost_edge + (width_right_frame - rightmost_edge) - overlap_px

                elif left_has_cloth and not right_has_cloth:
                    # CASE 2a: Cloth visible ONLY in left camera
                    # A cloth edge pair MUST be: rising gradient (dark→cloth) on left,
                    # falling gradient (cloth→dark) on right.
                    # We require at least one of each type to get a valid measurement.
                    l_rising  = left_result['left_edges']   # positive Sobel-X peaks
                    l_falling = left_result['right_edges']  # negative Sobel-X peaks
                    if len(l_rising) >= 1 and len(l_falling) >= 1:
                        cloth_left  = l_rising[0]    # leftmost rising edge = left cloth boundary
                        cloth_right = l_falling[-1]  # rightmost falling edge = right cloth boundary
                        if cloth_right > cloth_left:  # sanity: right must be to the right of left
                            raw_width_px = cloth_right - cloth_left
                        else:
                            raw_width_px = None  # inverted — likely false detections

                elif right_has_cloth and not left_has_cloth:
                    # CASE 2b: Cloth visible ONLY in right camera
                    r_rising  = right_result['left_edges']
                    r_falling = right_result['right_edges']
                    if len(r_rising) >= 1 and len(r_falling) >= 1:
                        cloth_left  = r_rising[0]
                        cloth_right = r_falling[-1]
                        if cloth_right > cloth_left:
                            raw_width_px = cloth_right - cloth_left
                        else:
                            raw_width_px = None

                else:
                    # CASE 3: No cloth detected / only 1 edge in 1 camera
                    raw_width_px = None
=======
                width_right_frame = frame_r.shape[1]

                # Width calculation
                if mm_per_px and mm_per_px > 1e-6:
                    overlap_px = int(round(args.guide_overlap_mm / mm_per_px))
                else:
                    overlap_px = 144
                raw_width_px = left_edge_x + (width_right_frame - right_edge_x) - overlap_px
>>>>>>> parent of a82513e (feat: add persistence and logic for stitch calibration using cloth width measurements)

                # Stabilise the width (smooth + reject outliers)
                stable_width_px = width_filter.update(raw_width_px)

                # ── Calibration phase ───────────────────────────────────────
                if not calibration_done and stable_width_px is not None:
                    calibration_samples.append(stable_width_px)
                    remaining = CALIBRATION_FRAMES - len(calibration_samples)
                    if remaining > 0:
                        print(f"Calibrating... {remaining} frames remaining    ", end='\r')
                    else:
                        avg_cal_px = np.mean(calibration_samples)
                        mm_per_px = args.cloth_width_mm / avg_cal_px
                        calibration_done = True
                        print(f"\n=== CALIBRATION COMPLETE ===")
                        print(f"Baseline: {avg_cal_px:.1f} px = {args.cloth_width_mm:.1f} mm")
                        print(f"Scale: {mm_per_px:.4f} mm/px\n")

                # ── Compute mm width ────────────────────────────────────────
                width_mm = stable_width_px * mm_per_px if (mm_per_px is not None and stable_width_px is not None) else None

                # ── Display Left Frame ──────────────────────────────────────
                disp_l = frame_l.copy()
                if not custom_guides['left']:
                    draw_overlap_guides(disp_l, mm_per_px, side='left', guide_distance_mm=args.guide_overlap_mm)
                else:
                    for i, cx in enumerate(custom_guides['left']):
                        draw_vertical_guide(disp_l, cx, f"Custom L{i+1}", color=(255, 100, 255))
<<<<<<< HEAD

                # Draw detected edges on left frame
                if left_result is not None:
                    for i, ex in enumerate(left_result['left_edges']):
                        ex_int = int(round(ex))
                        cv2.line(disp_l, (ex_int, 0), (ex_int, disp_l.shape[0]), (0, 255, 0), 3)
                        cv2.putText(disp_l, f"L-edge {i+1}: {ex:.1f}", (ex_int + 5, 80 + i * 30),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                    for i, ex in enumerate(left_result['right_edges']):
                        ex_int = int(round(ex))
                        cv2.line(disp_l, (ex_int, 0), (ex_int, disp_l.shape[0]), (255, 100, 0), 3)
                        cv2.putText(disp_l, f"R-edge {i+1}: {ex:.1f}", (ex_int + 5, 80 + (len(left_result['left_edges']) + i) * 30),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 100, 0), 2)
                else:
                    cv2.putText(disp_l, "NO CLOTH", (30, 80),
                                cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)

                # Width info on left frame
                if stable_width_px is not None:
                    if width_mm is not None:
                        cv2.putText(disp_l, f"Width: {stable_width_px:.1f} px | {width_mm:.1f} mm", (30, 50),
                                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                    else:
                        cv2.putText(disp_l, f"Width: {stable_width_px:.1f} px", (30, 50),
                                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                else:
                    cv2.putText(disp_l, "Width: N/A", (30, 50),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

                # Stitch status on left frame
                if stitch_calibrated:
                    cv2.putText(disp_l, f"STITCH: calibrated (offset={stitch_offset:.1f})",
                                (30, disp_l.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 0), 2)
                else:
                    cv2.putText(disp_l, "STITCH: NOT calibrated - press 's'",
                                (30, disp_l.shape[0] - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
=======
                edge_x_int_l = int(round(left_edge_x))
                cv2.line(disp_l, (edge_x_int_l, 0), (edge_x_int_l, disp_l.shape[0]), (0, 0, 255), 3)
                cv2.putText(disp_l, f"Left Edge X: {left_edge_x:.1f} px", (30, 50),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
>>>>>>> parent of a82513e (feat: add persistence and logic for stitch calibration using cloth width measurements)
                if left_aoi:
                    ax, ay, aw, ah = left_aoi
                    cv2.rectangle(disp_l, (ax, ay), (ax + aw, ay + ah), (255, 255, 0), 2)
                cv2.imshow("Edge Detection - Left", disp_l)

                # ── Display Right Frame ─────────────────────────────────────
                disp_r = frame_r.copy()
                if not custom_guides['right']:
                    draw_overlap_guides(disp_r, mm_per_px, side='right', guide_distance_mm=args.guide_overlap_mm)
                else:
                    for i, cx in enumerate(custom_guides['right']):
                        draw_vertical_guide(disp_r, cx, f"Custom R{i+1}", color=(255, 100, 255))

                # Draw detected edges on right frame
                if right_result is not None:
                    for i, ex in enumerate(right_result['left_edges']):
                        ex_int = int(round(ex))
                        cv2.line(disp_r, (ex_int, 0), (ex_int, disp_r.shape[0]), (0, 255, 0), 3)
                        cv2.putText(disp_r, f"L-edge {i+1}: {ex:.1f}", (ex_int + 5, 80 + i * 30),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                    for i, ex in enumerate(right_result['right_edges']):
                        ex_int = int(round(ex))
                        cv2.line(disp_r, (ex_int, 0), (ex_int, disp_r.shape[0]), (255, 100, 0), 3)
                        cv2.putText(disp_r, f"R-edge {i+1}: {ex:.1f}", (ex_int + 5, 80 + (len(right_result['left_edges']) + i) * 30),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 100, 0), 2)
                else:
                    cv2.putText(disp_r, "NO CLOTH", (30, 80),
                                cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 255), 3)

                if right_aoi:
                    ax, ay, aw, ah = right_aoi
                    cv2.rectangle(disp_r, (ax, ay), (ax + aw, ay + ah), (255, 255, 0), 2)
                cv2.imshow("Edge Detection - Right", disp_r)

                # ── FPS counter + output ────────────────────────────────────
                frame_count += 1
                elapsed = time.perf_counter() - fps_tick
                fps = frame_count / elapsed if elapsed > 0 else 0

                if stable_width_px is not None:
                    if width_mm is not None:
                        print(f"Width: {stable_width_px:07.1f} px | {width_mm:07.1f} mm | "
                              f"Raw: {raw_width_px:07.1f} px | FPS: {fps:.1f}    ", end='\r')
                    else:
                        print(f"Width: {stable_width_px:07.1f} px | "
                              f"Raw: {raw_width_px:07.1f} px | FPS: {fps:.1f}    ", end='\r')
                else:
                    print(f"Width: None (no cloth) | FPS: {fps:.1f}    ", end='\r')

            key = cv2.waitKey(1) & 0xFF
            if key == ord('q'):
                break
            elif key == ord('c'):
                custom_guides['left'].clear()
                custom_guides['right'].clear()
<<<<<<< HEAD
            elif key == ord('s'):
                # Stitch calibration: compute offset from known cloth width
                if args.cloth_width_mm is not None and args.cloth_width_mm > 0:
                    stitch_offset = args.cloth_width_mm + current_left_edge - current_right_edge
                    stitch_calibrated = True
                    save_stitch_offset(stitch_offset, args.cloth_width_mm,
                                       current_left_edge, current_right_edge)
                    print(f"\n=== STITCH CALIBRATION DONE ===")
                    print(f"Cloth width: {args.cloth_width_mm:.1f} mm")
                    print(f"Left edge: {current_left_edge:.1f} px, Right edge: {current_right_edge:.1f} px")
                    print(f"Offset: {stitch_offset:.2f} px\n")
                else:
                    print("\n[Stitch] ERROR: --cloth-width-mm is required for stitch calibration!")
                    print("Restart with: python main.py ... --cloth-width-mm <actual_width_in_mm>\n")
=======
>>>>>>> parent of a82513e (feat: add persistence and logic for stitch calibration using cloth width measurements)

    finally:
        print("\nShutting down...")
        executor.shutdown(wait=False)
        left_cam.release()
        right_cam.release()
        cv2.destroyAllWindows()


if __name__ == '__main__':
    main()
