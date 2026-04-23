"""
api.py
======
FastAPI REST API for the Fabric Edge Detection system.

Exposes all core features as HTTP endpoints so a frontend
application can consume edge-detection data, camera frames,
calibration info, and system configuration.

Run:
    uvicorn api:app --host 0.0.0.0 --port 8000 --reload
"""

import os
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

import cv2
import json
import time
import base64
import threading
import numpy as np

from io import BytesIO
from typing import Optional, Dict, Any, List
from collections import deque
from contextlib import asynccontextmanager
from concurrent.futures import ProcessPoolExecutor

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

# ─── Import core logic from main.py ────────────────────────────────────────────

from main import (
    RTSPCamera,
    find_fabric_edge_canny,
    crop_to_aoi,
    parse_aoi_string,
    StableWidthFilter,
    load_stitch_offset,
    save_stitch_offset,
    STITCH_OFFSET_FILE,
)


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic Models (Request / Response schemas)
# ═══════════════════════════════════════════════════════════════════════════════

class SystemStatus(BaseModel):
    running: bool
    left_camera_connected: bool
    right_camera_connected: bool
    calibration_done: bool
    stitch_calibrated: bool
    mm_per_px: Optional[float] = None
    stitch_offset: Optional[float] = None
    uptime_seconds: float


class EdgeMeasurement(BaseModel):
    left_edge_px: float
    right_edge_px: float
    raw_width_px: float
    stable_width_px: float
    width_mm: Optional[float] = None
    mm_per_px: Optional[float] = None
    stitch_calibrated: bool
    stitch_offset: Optional[float] = None
    timestamp: float


class AOIConfig(BaseModel):
    x: int
    y: int
    w: int
    h: int


class AOIUpdateRequest(BaseModel):
    left_aoi: Optional[AOIConfig] = None
    right_aoi: Optional[AOIConfig] = None


class CannyConfig(BaseModel):
    canny_low: int = Field(ge=0, le=500, default=50)
    canny_high: int = Field(ge=0, le=500, default=150)


class StitchCalibrateRequest(BaseModel):
    cloth_width_mm: float = Field(gt=0, description="Actual cloth width in mm")


class StitchOffsetResponse(BaseModel):
    stitch_offset: float
    calibrated_cloth_width_mm: float
    left_edge_at_calibration: float
    right_edge_at_calibration: float


class CalibrationData(BaseModel):
    camera_matrix: List[List[float]]
    dist_coeffs: List[float]
    image_width_px: int
    image_height_px: int
    rms: float


class HomographyData(BaseModel):
    homography: List[List[float]]
    scale_px_per_mm: float
    out_width: int
    out_height: int


class StabilisationConfig(BaseModel):
    smooth_window: int = Field(ge=1, le=200, default=30)
    max_deviation_px: float = Field(ge=1.0, le=500.0, default=50.0)


class RuntimeCalibrationRequest(BaseModel):
    cloth_width_mm: float = Field(gt=0, description="Known cloth width in mm")
    num_frames: int = Field(ge=10, le=300, default=60)


class ConfigResponse(BaseModel):
    left_src: str
    right_src: str
    canny_low: int
    canny_high: int
    smooth_window: int
    max_deviation_px: float
    left_aoi: Optional[Dict[str, int]] = None
    right_aoi: Optional[Dict[str, int]] = None
    mm_per_px: Optional[float] = None
    stitch_offset: Optional[float] = None
    perspective_enabled: bool


# ═══════════════════════════════════════════════════════════════════════════════
# Global State
# ═══════════════════════════════════════════════════════════════════════════════

class AppState:
    """Holds all mutable runtime state for the detection system."""

    def __init__(self):
        self.left_cam: Optional[RTSPCamera] = None
        self.right_cam: Optional[RTSPCamera] = None
        self.executor: Optional[ProcessPoolExecutor] = None
        self.width_filter: Optional[StableWidthFilter] = None

        # Config
        self.left_src = os.getenv("LEFT_CAM_SRC", "rtsp://172.32.0.94:554/live/0")
        self.right_src = os.getenv("RIGHT_CAM_SRC", "rtsp://172.32.0.93:554/live/0")
        self.canny_low = 50
        self.canny_high = 150
        self.smooth_window = 30
        self.max_deviation_px = 50.0
        self.use_perspective = True

        # AOI
        self.left_aoi: Optional[tuple] = None
        self.right_aoi: Optional[tuple] = None

        # Calibration
        self.mm_per_px: Optional[float] = None
        self.calibration_done = False

        # Stitch
        self.stitch_offset: Optional[float] = None
        self.stitch_calibrated = False

        # Runtime
        self.start_time = 0.0
        self.running = False

        # Latest measurement cache
        self.latest_measurement: Optional[EdgeMeasurement] = None
        self._measurement_lock = threading.Lock()

        # Background measurement thread
        self._bg_thread: Optional[threading.Thread] = None
        self._bg_running = False

    def initialize(self):
        """Start cameras, executor, and load saved calibration data."""
        self.start_time = time.time()

        # Initialize cameras
        self.left_cam = RTSPCamera(
            self.left_src, "LeftCam",
            calib_file="calibration_data/left_calib.json",
            homography_file="calibration_data/left_homography.json",
            use_perspective=self.use_perspective,
        )
        self.right_cam = RTSPCamera(
            self.right_src, "RightCam",
            calib_file="calibration_data/right_calib.json",
            homography_file="calibration_data/right_homography.json",
            use_perspective=self.use_perspective,
        )

        self.executor = ProcessPoolExecutor(max_workers=2)
        self.width_filter = StableWidthFilter(
            window_size=self.smooth_window,
            max_deviation_px=self.max_deviation_px,
        )

        # Load scale from homography if available
        if (self.use_perspective
                and self.left_cam.scale_px_per_mm
                and self.left_cam.scale_px_per_mm > 0):
            self.mm_per_px = 1.0 / self.left_cam.scale_px_per_mm
            self.calibration_done = True

        # Load stitch offset
        offset = load_stitch_offset()
        if offset is not None:
            self.stitch_offset = offset
            self.stitch_calibrated = True

        self.running = True

        # Start background measurement loop
        self._bg_running = True
        self._bg_thread = threading.Thread(target=self._measurement_loop, daemon=True)
        self._bg_thread.start()

    def shutdown(self):
        """Release all resources."""
        self._bg_running = False
        if self._bg_thread:
            self._bg_thread.join(timeout=3)
        self.running = False
        if self.left_cam:
            self.left_cam.release()
        if self.right_cam:
            self.right_cam.release()
        if self.executor:
            self.executor.shutdown(wait=False)

    def _measurement_loop(self):
        """Continuously compute edge measurements in background."""
        while self._bg_running:
            try:
                measurement = self._compute_measurement()
                if measurement:
                    with self._measurement_lock:
                        self.latest_measurement = measurement
            except Exception:
                pass
            time.sleep(0.05)  # ~20 Hz

    def _compute_measurement(self) -> Optional[EdgeMeasurement]:
        """Single measurement cycle."""
        if not self.left_cam or not self.right_cam:
            return None

        ret_l, frame_l = self.left_cam.read()
        ret_r, frame_r = self.right_cam.read()

        if not (ret_l and ret_r and frame_l is not None and frame_r is not None):
            return None

        # Edge detection
        left_frame = crop_to_aoi(frame_l, self.left_aoi) if self.left_aoi else frame_l
        right_frame = crop_to_aoi(frame_r, self.right_aoi) if self.right_aoi else frame_r

        left_edge_x = find_fabric_edge_canny(left_frame, self.canny_low, self.canny_high)
        right_edge_x = find_fabric_edge_canny(right_frame, self.canny_low, self.canny_high)

        # Adjust for AOI offset
        if self.left_aoi:
            left_edge_x += self.left_aoi[0]
        if self.right_aoi:
            right_edge_x += self.right_aoi[0]

        width_right_frame = frame_r.shape[1]

        # Width calculation
        if self.stitch_calibrated and self.stitch_offset is not None:
            raw_width_px = (right_edge_x + self.stitch_offset) - left_edge_x
        else:
            if self.mm_per_px and self.mm_per_px > 1e-6:
                overlap_px = int(round(100.0 / self.mm_per_px))
            else:
                overlap_px = 144
            raw_width_px = left_edge_x + (width_right_frame - right_edge_x) - overlap_px

        stable_width_px = self.width_filter.update(raw_width_px)
        width_mm = stable_width_px * self.mm_per_px if self.mm_per_px else None

        return EdgeMeasurement(
            left_edge_px=round(left_edge_x, 2),
            right_edge_px=round(right_edge_x, 2),
            raw_width_px=round(raw_width_px, 2),
            stable_width_px=round(stable_width_px, 2),
            width_mm=round(width_mm, 2) if width_mm else None,
            mm_per_px=round(self.mm_per_px, 6) if self.mm_per_px else None,
            stitch_calibrated=self.stitch_calibrated,
            stitch_offset=round(self.stitch_offset, 2) if self.stitch_offset else None,
            timestamp=time.time(),
        )


state = AppState()


# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI App
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start cameras on startup, release on shutdown."""
    print("[API] Initializing edge detection system...")
    state.initialize()
    print("[API] System ready.")
    yield
    print("[API] Shutting down...")
    state.shutdown()


app = FastAPI(
    title="Fabric Edge Detection API",
    description="REST API for real-time fabric edge detection, width measurement, "
                "and camera calibration management.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════════════════════════════════════
# Helper: encode frame as JPEG base64
# ═══════════════════════════════════════════════════════════════════════════════

def frame_to_base64(frame, quality: int = 80) -> str:
    """Encode an OpenCV frame to a base64 JPEG string."""
    encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
    _, buffer = cv2.imencode(".jpg", frame, encode_params)
    return base64.b64encode(buffer).decode("utf-8")


def frame_to_bytes(frame, quality: int = 80) -> bytes:
    """Encode an OpenCV frame to raw JPEG bytes."""
    encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
    _, buffer = cv2.imencode(".jpg", frame, encode_params)
    return buffer.tobytes()


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════


# ── 1. System Status ────────────────────────────────────────────────────────────

@app.get("/api/status", response_model=SystemStatus, tags=["System"])
async def get_status():
    """Get overall system health and configuration status."""
    left_ok = False
    right_ok = False
    if state.left_cam:
        ret, _ = state.left_cam.read()
        left_ok = ret
    if state.right_cam:
        ret, _ = state.right_cam.read()
        right_ok = ret

    return SystemStatus(
        running=state.running,
        left_camera_connected=left_ok,
        right_camera_connected=right_ok,
        calibration_done=state.calibration_done,
        stitch_calibrated=state.stitch_calibrated,
        mm_per_px=state.mm_per_px,
        stitch_offset=state.stitch_offset,
        uptime_seconds=round(time.time() - state.start_time, 1),
    )


# ── 2. Live Measurement ────────────────────────────────────────────────────────

@app.get("/api/measurement", response_model=EdgeMeasurement, tags=["Measurement"])
async def get_measurement():
    """
    Get the latest edge detection measurement.
    Returns cached result from the background measurement loop (~20 Hz).
    """
    with state._measurement_lock:
        m = state.latest_measurement
    if m is None:
        raise HTTPException(status_code=503, detail="No measurement available yet. Cameras may be initializing.")
    return m


@app.get("/api/measurement/stream", tags=["Measurement"])
async def stream_measurements():
    """
    Server-Sent Events (SSE) stream of live measurements.
    Frontend can use EventSource to receive real-time updates.
    """
    def event_generator():
        last_ts = 0.0
        while state.running:
            with state._measurement_lock:
                m = state.latest_measurement
            if m and m.timestamp != last_ts:
                last_ts = m.timestamp
                yield f"data: {m.model_dump_json()}\n\n"
            time.sleep(0.1)  # 10 Hz SSE push rate

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── 3. Camera Frames ───────────────────────────────────────────────────────────

@app.get("/api/camera/{side}/snapshot", tags=["Camera"])
async def get_snapshot(
    side: str,
    quality: int = Query(80, ge=10, le=100),
    annotated: bool = Query(False, description="Overlay edge detection line on frame"),
):
    """
    Get a single JPEG snapshot from the left or right camera.
    Set `annotated=true` to overlay the detected edge line.
    """
    if side not in ("left", "right"):
        raise HTTPException(status_code=400, detail="Side must be 'left' or 'right'")

    cam = state.left_cam if side == "left" else state.right_cam
    if cam is None:
        raise HTTPException(status_code=503, detail=f"{side} camera not initialized")

    ret, frame = cam.read()
    if not ret or frame is None:
        raise HTTPException(status_code=503, detail=f"{side} camera not returning frames")

    if annotated:
        aoi = state.left_aoi if side == "left" else state.right_aoi
        roi = crop_to_aoi(frame, aoi) if aoi else frame
        edge_x = find_fabric_edge_canny(roi, state.canny_low, state.canny_high)
        if aoi:
            edge_x += aoi[0]
        edge_x_int = int(round(edge_x))
        cv2.line(frame, (edge_x_int, 0), (edge_x_int, frame.shape[0]), (0, 0, 255), 3)
        cv2.putText(frame, f"Edge: {edge_x:.1f}px", (30, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)

    jpeg_bytes = frame_to_bytes(frame, quality)
    return StreamingResponse(BytesIO(jpeg_bytes), media_type="image/jpeg")


@app.get("/api/camera/{side}/stream", tags=["Camera"])
async def stream_camera(
    side: str,
    quality: int = Query(60, ge=10, le=100),
):
    """
    MJPEG stream from the specified camera.
    Use as an <img> src in the browser: <img src="/api/camera/left/stream" />
    """
    if side not in ("left", "right"):
        raise HTTPException(status_code=400, detail="Side must be 'left' or 'right'")

    cam = state.left_cam if side == "left" else state.right_cam
    if cam is None:
        raise HTTPException(status_code=503, detail=f"{side} camera not initialized")

    def mjpeg_generator():
        while state.running:
            ret, frame = cam.read()
            if ret and frame is not None:
                jpeg = frame_to_bytes(frame, quality)
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
                )
            time.sleep(0.05)

    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── 4. AOI (Area of Interest) ──────────────────────────────────────────────────

@app.get("/api/aoi", tags=["Configuration"])
async def get_aoi():
    """Get current AOI configuration for both cameras."""
    def to_dict(aoi):
        if aoi is None:
            return None
        return {"x": aoi[0], "y": aoi[1], "w": aoi[2], "h": aoi[3]}

    return {
        "left_aoi": to_dict(state.left_aoi),
        "right_aoi": to_dict(state.right_aoi),
    }


@app.put("/api/aoi", tags=["Configuration"])
async def update_aoi(req: AOIUpdateRequest):
    """Update AOI for left and/or right camera. Set to null to use full frame."""
    if req.left_aoi is not None:
        state.left_aoi = (req.left_aoi.x, req.left_aoi.y, req.left_aoi.w, req.left_aoi.h)
    else:
        state.left_aoi = None

    if req.right_aoi is not None:
        state.right_aoi = (req.right_aoi.x, req.right_aoi.y, req.right_aoi.w, req.right_aoi.h)
    else:
        state.right_aoi = None

    return {"message": "AOI updated", "left_aoi": req.left_aoi, "right_aoi": req.right_aoi}


@app.delete("/api/aoi", tags=["Configuration"])
async def clear_aoi():
    """Reset AOI to full frame for both cameras."""
    state.left_aoi = None
    state.right_aoi = None
    return {"message": "AOI cleared for both cameras"}


# ── 5. Canny Thresholds ────────────────────────────────────────────────────────

@app.get("/api/config/canny", response_model=CannyConfig, tags=["Configuration"])
async def get_canny():
    """Get current Canny edge detection thresholds."""
    return CannyConfig(canny_low=state.canny_low, canny_high=state.canny_high)


@app.put("/api/config/canny", tags=["Configuration"])
async def update_canny(config: CannyConfig):
    """Update Canny thresholds. Changes take effect immediately."""
    if config.canny_low >= config.canny_high:
        raise HTTPException(status_code=400, detail="canny_low must be less than canny_high")
    state.canny_low = config.canny_low
    state.canny_high = config.canny_high
    return {"message": "Canny thresholds updated", **config.model_dump()}


# ── 6. Stabilisation Config ────────────────────────────────────────────────────

@app.get("/api/config/stabilisation", response_model=StabilisationConfig, tags=["Configuration"])
async def get_stabilisation():
    """Get current width stabilisation parameters."""
    return StabilisationConfig(
        smooth_window=state.smooth_window,
        max_deviation_px=state.max_deviation_px,
    )


@app.put("/api/config/stabilisation", tags=["Configuration"])
async def update_stabilisation(config: StabilisationConfig):
    """Update stabilisation filter. Resets the smoothing window."""
    state.smooth_window = config.smooth_window
    state.max_deviation_px = config.max_deviation_px
    state.width_filter = StableWidthFilter(
        window_size=config.smooth_window,
        max_deviation_px=config.max_deviation_px,
    )
    return {"message": "Stabilisation config updated and filter reset", **config.model_dump()}


# ── 7. Stitch Calibration ──────────────────────────────────────────────────────

@app.get("/api/calibration/stitch", tags=["Calibration"])
async def get_stitch_calibration():
    """Get stitch calibration data. Returns null values if not calibrated."""
    if not state.stitch_calibrated or state.stitch_offset is None:
        return {"calibrated": False, "stitch_offset": None, "data": None}

    # Load full data from file
    if os.path.exists(STITCH_OFFSET_FILE):
        with open(STITCH_OFFSET_FILE, "r") as f:
            data = json.load(f)
        return {"calibrated": True, "stitch_offset": state.stitch_offset, "data": data}

    return {"calibrated": True, "stitch_offset": state.stitch_offset, "data": None}


@app.post("/api/calibration/stitch", tags=["Calibration"])
async def calibrate_stitch(req: StitchCalibrateRequest):
    """
    Perform stitch calibration using the current edge positions
    and the known cloth width. The cloth must be visible and steady.
    """
    m = None
    with state._measurement_lock:
        m = state.latest_measurement

    if m is None:
        raise HTTPException(status_code=503, detail="No measurement available. Ensure cameras are running and cloth is visible.")

    left_edge = m.left_edge_px
    right_edge = m.right_edge_px

    offset = req.cloth_width_mm + left_edge - right_edge
    state.stitch_offset = offset
    state.stitch_calibrated = True

    save_stitch_offset(offset, req.cloth_width_mm, left_edge, right_edge)

    return {
        "message": "Stitch calibration complete",
        "stitch_offset": round(offset, 2),
        "cloth_width_mm": req.cloth_width_mm,
        "left_edge_px": round(left_edge, 2),
        "right_edge_px": round(right_edge, 2),
    }


@app.delete("/api/calibration/stitch", tags=["Calibration"])
async def clear_stitch_calibration():
    """Clear stitch calibration. Falls back to overlap-based width calculation."""
    state.stitch_offset = None
    state.stitch_calibrated = False
    if os.path.exists(STITCH_OFFSET_FILE):
        os.remove(STITCH_OFFSET_FILE)
    return {"message": "Stitch calibration cleared"}


# ── 8. Lens Calibration Data ───────────────────────────────────────────────────

@app.get("/api/calibration/lens/{side}", tags=["Calibration"])
async def get_lens_calibration(side: str):
    """Get stored lens (intrinsic) calibration data for a camera."""
    if side not in ("left", "right"):
        raise HTTPException(status_code=400, detail="Side must be 'left' or 'right'")

    path = f"calibration_data/{side}_calib.json"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"No lens calibration found for {side} camera")

    with open(path, "r") as f:
        data = json.load(f)
    return data


# ── 9. Homography Data ─────────────────────────────────────────────────────────

@app.get("/api/calibration/homography/{side}", tags=["Calibration"])
async def get_homography(side: str):
    """Get stored homography (perspective correction) data for a camera."""
    if side not in ("left", "right"):
        raise HTTPException(status_code=400, detail="Side must be 'left' or 'right'")

    path = f"calibration_data/{side}_homography.json"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"No homography found for {side} camera")

    with open(path, "r") as f:
        data = json.load(f)
    return data


# ── 10. Runtime mm/px Calibration ──────────────────────────────────────────────

@app.post("/api/calibration/runtime", tags=["Calibration"])
async def runtime_calibration(req: RuntimeCalibrationRequest):
    """
    Perform runtime mm/px calibration by averaging measurements over N frames.
    The cloth must be steady and at the known width during this process.
    """
    samples = []
    for _ in range(req.num_frames):
        with state._measurement_lock:
            m = state.latest_measurement
        if m:
            samples.append(m.stable_width_px)
        time.sleep(0.05)

    if len(samples) < 10:
        raise HTTPException(status_code=503, detail="Not enough measurement samples collected")

    avg_px = float(np.mean(samples))
    state.mm_per_px = req.cloth_width_mm / avg_px
    state.calibration_done = True

    return {
        "message": "Runtime calibration complete",
        "mm_per_px": round(state.mm_per_px, 6),
        "avg_width_px": round(avg_px, 2),
        "cloth_width_mm": req.cloth_width_mm,
        "samples_used": len(samples),
    }


# ── 11. Full Configuration ─────────────────────────────────────────────────────

@app.get("/api/config", response_model=ConfigResponse, tags=["Configuration"])
async def get_full_config():
    """Get the full runtime configuration of the system."""
    def aoi_dict(aoi):
        if aoi is None:
            return None
        return {"x": aoi[0], "y": aoi[1], "w": aoi[2], "h": aoi[3]}

    return ConfigResponse(
        left_src=state.left_src,
        right_src=state.right_src,
        canny_low=state.canny_low,
        canny_high=state.canny_high,
        smooth_window=state.smooth_window,
        max_deviation_px=state.max_deviation_px,
        left_aoi=aoi_dict(state.left_aoi),
        right_aoi=aoi_dict(state.right_aoi),
        mm_per_px=state.mm_per_px,
        stitch_offset=state.stitch_offset,
        perspective_enabled=state.use_perspective,
    )


# ── 12. Health Check ───────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
async def health():
    """Simple health-check endpoint for load balancers / monitoring."""
    return {"status": "ok", "timestamp": time.time()}


# ═══════════════════════════════════════════════════════════════════════════════
# Run
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
