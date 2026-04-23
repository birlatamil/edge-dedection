/**
 * api.js — API Client for Fabric Edge Detection Backend
 * Centralises all HTTP requests to the FastAPI server.
 */

const API = (() => {
  let baseUrl = 'http://localhost:8000';

  function setBaseUrl(url) {
    baseUrl = url.replace(/\/+$/, '');
  }

  function getBaseUrl() {
    return baseUrl;
  }

  async function request(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const defaults = {
      headers: { 'Content-Type': 'application/json' },
    };
    const config = { ...defaults, ...options };

    try {
      const res = await fetch(url, config);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw { status: res.status, detail: body.detail || res.statusText };
      }
      return await res.json();
    } catch (err) {
      if (err.status) throw err;
      throw { status: 0, detail: 'Cannot connect to backend' };
    }
  }

  // ── System ──────────────────────────────────────────────────

  async function health() {
    return request('/health');
  }

  async function status() {
    return request('/api/status');
  }

  // ── Measurement ─────────────────────────────────────────────

  async function measurement() {
    return request('/api/measurement');
  }

  function measurementStreamUrl() {
    return `${baseUrl}/api/measurement/stream`;
  }

  // ── Camera ──────────────────────────────────────────────────

  function snapshotUrl(side, quality = 80, annotated = false) {
    return `${baseUrl}/api/camera/${side}/snapshot?quality=${quality}&annotated=${annotated}&t=${Date.now()}`;
  }

  function streamUrl(side, quality = 60) {
    return `${baseUrl}/api/camera/${side}/stream?quality=${quality}`;
  }

  // ── AOI ─────────────────────────────────────────────────────

  async function getAoi() {
    return request('/api/aoi');
  }

  async function updateAoi(leftAoi, rightAoi) {
    return request('/api/aoi', {
      method: 'PUT',
      body: JSON.stringify({ left_aoi: leftAoi, right_aoi: rightAoi }),
    });
  }

  async function clearAoi() {
    return request('/api/aoi', { method: 'DELETE' });
  }

  // ── Config: Canny ───────────────────────────────────────────

  async function getCanny() {
    return request('/api/config/canny');
  }

  async function updateCanny(low, high) {
    return request('/api/config/canny', {
      method: 'PUT',
      body: JSON.stringify({ canny_low: low, canny_high: high }),
    });
  }

  // ── Config: Stabilisation ───────────────────────────────────

  async function getStabilisation() {
    return request('/api/config/stabilisation');
  }

  async function updateStabilisation(window, deviation) {
    return request('/api/config/stabilisation', {
      method: 'PUT',
      body: JSON.stringify({ smooth_window: window, max_deviation_px: deviation }),
    });
  }

  // ── Calibration ─────────────────────────────────────────────

  async function getStitchCalibration() {
    return request('/api/calibration/stitch');
  }

  async function calibrateStitch(clothWidthMm) {
    return request('/api/calibration/stitch', {
      method: 'POST',
      body: JSON.stringify({ cloth_width_mm: clothWidthMm }),
    });
  }

  async function clearStitchCalibration() {
    return request('/api/calibration/stitch', { method: 'DELETE' });
  }

  async function runtimeCalibration(clothWidthMm, numFrames = 60) {
    return request('/api/calibration/runtime', {
      method: 'POST',
      body: JSON.stringify({ cloth_width_mm: clothWidthMm, num_frames: numFrames }),
    });
  }

  async function getLensCalibration(side) {
    return request(`/api/calibration/lens/${side}`);
  }

  async function getHomography(side) {
    return request(`/api/calibration/homography/${side}`);
  }

  // ── Full Config ─────────────────────────────────────────────

  async function getConfig() {
    return request('/api/config');
  }

  return {
    setBaseUrl,
    getBaseUrl,
    health,
    status,
    measurement,
    measurementStreamUrl,
    snapshotUrl,
    streamUrl,
    getAoi,
    updateAoi,
    clearAoi,
    getCanny,
    updateCanny,
    getStabilisation,
    updateStabilisation,
    getStitchCalibration,
    calibrateStitch,
    clearStitchCalibration,
    runtimeCalibration,
    getLensCalibration,
    getHomography,
    getConfig,
  };
})();
