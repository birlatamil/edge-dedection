/**
 * calibration.js — Calibration management module
 * Includes: Stitch, Runtime Scale, Chessboard Lens, and Homography/Perspective calibration
 */

const Calibration = (() => {

  function render() {
    return `
      <div class="page-header">
        <h1 class="page-title">Calibration</h1>
        <p class="page-subtitle">Configure stitch offset, pixel-to-millimeter conversion, lens correction, and perspective calibration</p>
      </div>

      <!-- Chessboard Lens Calibration -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">♟️</span> Chessboard Lens Calibration</span>
          <span class="card-badge" id="cal-chess-badge">Loading...</span>
        </div>
        <p class="page-subtitle mb-md">
          Capture multiple images of a chessboard pattern from the camera, then run calibration to compute
          lens distortion coefficients. This corrects barrel/pincushion distortion for accurate measurements.
        </p>

        <!-- Board config -->
        <div class="calib-step-group">
          <div class="calib-step-header">
            <span class="calib-step-num">1</span>
            <span>Configure Board Parameters</span>
          </div>
          <div class="grid-4">
            <div class="form-group">
              <label class="form-label">Camera</label>
              <select class="form-input" id="cal-chess-side">
                <option value="left">Left Camera</option>
                <option value="right">Right Camera</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Inner Columns</label>
              <input type="number" class="form-input" id="cal-chess-cols" value="10" min="3" max="20" />
            </div>
            <div class="form-group">
              <label class="form-label">Inner Rows</label>
              <input type="number" class="form-input" id="cal-chess-rows" value="9" min="3" max="20" />
            </div>
            <div class="form-group">
              <label class="form-label">Square Size <span class="form-sublabel">mm</span></label>
              <input type="number" class="form-input" id="cal-chess-square" value="25.0" step="0.1" min="1" />
            </div>
          </div>
        </div>

        <!-- Capture -->
        <div class="calib-step-group">
          <div class="calib-step-header">
            <span class="calib-step-num">2</span>
            <span>Capture Chessboard Frames</span>
          </div>
          <div class="calib-capture-row">
            <button class="btn btn-primary" onclick="Calibration.captureFrame()" id="cal-chess-capture-btn">📸 Capture Frame</button>
            <button class="btn btn-danger" onclick="Calibration.clearImages()" id="cal-chess-clear-btn">🗑️ Clear Images</button>
          </div>
          <div id="cal-chess-capture-result" class="mt-md"></div>
        </div>

        <!-- Status per camera -->
        <div class="calib-step-group">
          <div class="calib-step-header">
            <span class="calib-step-num">3</span>
            <span>Captured Images & Calibration Status</span>
          </div>
          <div class="grid-2" id="cal-chess-status">
            <div class="empty-state" style="padding: var(--space-lg)">
              <span class="spinner"></span>
            </div>
          </div>
        </div>

        <!-- Run calibration -->
        <div class="calib-step-group">
          <div class="calib-step-header">
            <span class="calib-step-num">4</span>
            <span>Run Lens Calibration</span>
          </div>
          <p class="page-subtitle mb-md">Requires at least 5 captured images with detected chessboard patterns.</p>
          <button class="btn btn-primary" onclick="Calibration.runChessboardCalibration()" id="cal-chess-run-btn">⚡ Run Calibration</button>
          <div id="cal-chess-run-result" class="mt-md"></div>
        </div>
      </div>

      <!-- Homography / Perspective -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">🔬</span> Lens & Perspective Data</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="Calibration.loadLensData('left')">Left Lens</button>
            <button class="btn btn-sm btn-secondary" onclick="Calibration.loadLensData('right')">Right Lens</button>
            <button class="btn btn-sm btn-secondary" onclick="Calibration.loadHomography('left')">Left Homography</button>
            <button class="btn btn-sm btn-secondary" onclick="Calibration.loadHomography('right')">Right Homography</button>
          </div>
        </div>
        <div id="cal-data-viewer">
          <div class="empty-state">
            <span class="empty-icon">🔬</span>
            <p class="empty-text">Click a button above to view calibration data</p>
          </div>
        </div>
      </div>

      <!-- Stitch Calibration -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">🔗</span> Stitch Calibration</span>
          <span class="card-badge" id="cal-stitch-badge">Loading...</span>
        </div>
        <p class="page-subtitle mb-md">
          The stitch offset links the two camera views together for accurate total width measurement.
          Place a cloth of <strong>known width</strong> so both edges are visible, then enter the width and calibrate.
        </p>

        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Known Cloth Width</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="number" class="form-input" id="cal-cloth-width" placeholder="1240" step="0.1" style="max-width:200px" />
              <span style="color:var(--text-tertiary); font-size:0.85rem">mm</span>
            </div>
          </div>
          <div class="form-group" style="display:flex; align-items:flex-end; gap:8px; padding-bottom:2px">
            <button class="btn btn-primary" onclick="Calibration.doStitchCalibration()">⚡ Calibrate Stitch</button>
            <button class="btn btn-danger" onclick="Calibration.clearStitch()">Clear</button>
          </div>
        </div>

        <hr class="section-divider" />

        <!-- Stitch data display -->
        <div id="cal-stitch-data">
          <div class="empty-state">
            <span class="empty-icon">🔗</span>
            <p class="empty-text">Loading stitch calibration data...</p>
          </div>
        </div>
      </div>

      <!-- Runtime mm/px Calibration -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">📐</span> Runtime Scale Calibration</span>
          <span class="card-badge" id="cal-runtime-badge">—</span>
        </div>
        <p class="page-subtitle mb-md">
          Compute the mm/px ratio by averaging measurements over multiple frames.
          The cloth must be steady at the known width during calibration.
        </p>

        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Cloth Width</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="number" class="form-input" id="cal-runtime-width" placeholder="1240" step="0.1" style="max-width:180px" />
              <span style="color:var(--text-tertiary); font-size:0.85rem">mm</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Frames to Average</label>
            <input type="number" class="form-input" id="cal-runtime-frames" value="60" min="10" max="300" style="max-width:120px" />
          </div>
          <div class="form-group" style="display:flex; align-items:flex-end; padding-bottom:2px">
            <button class="btn btn-primary" onclick="Calibration.doRuntimeCalibration()" id="cal-runtime-btn">📐 Calibrate</button>
          </div>
        </div>

        <div id="cal-runtime-result"></div>
      </div>
    `;
  }

  async function init() {
    await Promise.all([
      loadStitchData(),
      loadChessboardStatus(),
    ]);
  }

  function destroy() {}

  // ── Chessboard Calibration ──────────────────────────────────────────

  async function loadChessboardStatus() {
    const container = document.getElementById('cal-chess-status');
    const badge = document.getElementById('cal-chess-badge');
    if (!container) return;

    try {
      const data = await API.chessboardStatus();
      let bothCalibrated = true;
      let html = '';

      for (const side of ['left', 'right']) {
        const info = data[side];
        const hasCalib = info.calibration_exists;
        if (!hasCalib) bothCalibrated = false;

        html += `
          <div class="calib-camera-status">
            <div class="calib-camera-header">
              <span class="calib-camera-label">${side === 'left' ? '📷 Left' : '📷 Right'} Camera</span>
              <span class="status-tag ${hasCalib ? 'online' : 'pending'}">${hasCalib ? 'Calibrated' : 'Not Calibrated'}</span>
            </div>
            <div class="calib-camera-stats">
              <div class="calib-stat">
                <span class="calib-stat-value">${info.captured_images}</span>
                <span class="calib-stat-label">Images Captured</span>
              </div>
              <div class="calib-stat">
                <span class="calib-stat-value">${hasCalib ? '✅' : '—'}</span>
                <span class="calib-stat-label">Lens Calibration</span>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;
      if (badge) {
        if (bothCalibrated) {
          badge.textContent = 'Both Calibrated';
          badge.className = 'card-badge success';
        } else {
          badge.textContent = 'Setup Required';
          badge.className = 'card-badge warning';
        }
      }
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state" style="padding: var(--space-lg)">
          <span class="empty-icon">🔌</span>
          <p class="empty-text">Cannot connect to backend</p>
          <p class="empty-sub">${err.detail || 'Check that the API server is running'}</p>
        </div>
      `;
      if (badge) { badge.textContent = 'Offline'; badge.className = 'card-badge error'; }
    }
  }

  async function captureFrame() {
    const side = document.getElementById('cal-chess-side')?.value || 'left';
    const cols = parseInt(document.getElementById('cal-chess-cols')?.value) || 10;
    const rows = parseInt(document.getElementById('cal-chess-rows')?.value) || 9;
    const btn = document.getElementById('cal-chess-capture-btn');
    const resultDiv = document.getElementById('cal-chess-capture-result');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Capturing...'; }

    try {
      const result = await API.chessboardCapture(side, cols, rows);
      if (result.success) {
        App.toast(`Frame captured! ${result.total_images} total images.`, 'success');
        if (resultDiv) {
          resultDiv.innerHTML = `
            <div class="calib-capture-feedback success">
              ✅ Chessboard detected — ${result.corners_found} corners found. ${result.message}
            </div>
          `;
        }
      } else {
        App.toast('Chessboard not detected in frame', 'error');
        if (resultDiv) {
          resultDiv.innerHTML = `
            <div class="calib-capture-feedback error">
              ❌ ${result.message}
            </div>
          `;
        }
      }
      await loadChessboardStatus();
    } catch (err) {
      App.toast(`Capture failed: ${err.detail}`, 'error');
      if (resultDiv) {
        resultDiv.innerHTML = `
          <div class="calib-capture-feedback error">
            ❌ ${err.detail || 'Capture failed'}
          </div>
        `;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '📸 Capture Frame'; }
    }
  }

  async function clearImages() {
    const side = document.getElementById('cal-chess-side')?.value || 'left';

    if (!confirm(`Clear all captured chessboard images for the ${side} camera?`)) return;

    try {
      await API.chessboardClearImages(side);
      App.toast(`Cleared images for ${side} camera`, 'success');
      const resultDiv = document.getElementById('cal-chess-capture-result');
      if (resultDiv) resultDiv.innerHTML = '';
      await loadChessboardStatus();
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  async function runChessboardCalibration() {
    const side = document.getElementById('cal-chess-side')?.value || 'left';
    const cols = parseInt(document.getElementById('cal-chess-cols')?.value) || 10;
    const rows = parseInt(document.getElementById('cal-chess-rows')?.value) || 9;
    const squareMm = parseFloat(document.getElementById('cal-chess-square')?.value) || 25.0;
    const btn = document.getElementById('cal-chess-run-btn');
    const resultDiv = document.getElementById('cal-chess-run-result');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Calibrating...'; }

    try {
      const result = await API.chessboardRun(side, cols, rows, squareMm);
      App.toast(`Lens calibration complete! RMS: ${result.rms}`, 'success');

      if (resultDiv) {
        const errRows = result.per_image_rms.map((e, i) => {
          const status = e < 0.5 ? 'excellent' : e < 1.0 ? 'good' : 'poor';
          return `<tr>
            <td>Image ${i + 1}</td>
            <td><span class="calib-rms-badge ${status}">${e.toFixed(4)} px</span></td>
          </tr>`;
        }).join('');

        resultDiv.innerHTML = `
          <hr class="section-divider" />
          <div class="grid-3">
            <div class="stat-card">
              <div class="stat-label">Overall RMS</div>
              <div class="stat-value accent">${result.rms.toFixed(4)}</div>
              <div class="stat-sub">px</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Images Used</div>
              <div class="stat-value">${result.images_used}</div>
              <div class="stat-sub">of ${result.total_images}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Result</div>
              <div class="stat-value">${result.rms < 1.0 ? '✅' : '⚠️'}</div>
              <div class="stat-sub">${result.rms < 0.5 ? 'Excellent' : result.rms < 1.0 ? 'Good' : 'Needs Improvement'}</div>
            </div>
          </div>
          <details class="calib-details mt-md">
            <summary>Per-Image Reprojection Errors</summary>
            <table class="data-table">
              <tr><th>Image</th><th>RMS Error</th></tr>
              ${errRows}
            </table>
          </details>
        `;
      }
      await loadChessboardStatus();
    } catch (err) {
      App.toast(`Calibration failed: ${err.detail}`, 'error');
      if (resultDiv) {
        resultDiv.innerHTML = `
          <div class="calib-capture-feedback error">
            ❌ ${err.detail || 'Calibration failed'}
          </div>
        `;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '⚡ Run Calibration'; }
    }
  }

  // ── Stitch Calibration ──────────────────────────────────────────────

  async function loadStitchData() {
    const badge = document.getElementById('cal-stitch-badge');
    const container = document.getElementById('cal-stitch-data');
    if (!container) return;

    try {
      const data = await API.getStitchCalibration();
      if (data.calibrated && data.data) {
        if (badge) { badge.textContent = 'Calibrated'; badge.className = 'card-badge success'; }
        container.innerHTML = `
          <div class="grid-4">
            <div class="stat-card">
              <div class="stat-label">Stitch Offset</div>
              <div class="stat-value accent">${data.stitch_offset.toFixed(1)}</div>
              <div class="stat-sub">px</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Cloth Width</div>
              <div class="stat-value">${data.data.calibrated_cloth_width_mm}</div>
              <div class="stat-sub">mm</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Left Edge @ Cal</div>
              <div class="stat-value">${data.data.left_edge_at_calibration.toFixed(1)}</div>
              <div class="stat-sub">px</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Right Edge @ Cal</div>
              <div class="stat-value">${data.data.right_edge_at_calibration.toFixed(1)}</div>
              <div class="stat-sub">px</div>
            </div>
          </div>
        `;
        // Pre-fill the cloth width field
        const widthInput = document.getElementById('cal-cloth-width');
        if (widthInput && !widthInput.value) widthInput.value = data.data.calibrated_cloth_width_mm;
      } else {
        if (badge) { badge.textContent = 'Not Calibrated'; badge.className = 'card-badge warning'; }
        container.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">⚠️</span>
            <p class="empty-text">Stitch not calibrated</p>
            <p class="empty-sub">Enter cloth width and click "Calibrate Stitch" above</p>
          </div>
        `;
      }
    } catch (err) {
      if (badge) { badge.textContent = 'Offline'; badge.className = 'card-badge error'; }
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔌</span>
          <p class="empty-text">Cannot connect to backend</p>
          <p class="empty-sub">${err.detail || 'Check that the API server is running'}</p>
        </div>
      `;
    }
  }

  async function doStitchCalibration() {
    const widthInput = document.getElementById('cal-cloth-width');
    const width = parseFloat(widthInput?.value);
    if (!width || width <= 0) {
      App.toast('Enter a valid cloth width in mm', 'error');
      return;
    }
    try {
      const result = await API.calibrateStitch(width);
      App.toast(`Stitch calibrated! Offset: ${result.stitch_offset} px`, 'success');
      await loadStitchData();
    } catch (err) {
      App.toast(`Stitch calibration failed: ${err.detail}`, 'error');
    }
  }

  async function clearStitch() {
    try {
      await API.clearStitchCalibration();
      App.toast('Stitch calibration cleared', 'success');
      await loadStitchData();
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  // ── Runtime Calibration ─────────────────────────────────────────────

  async function doRuntimeCalibration() {
    const widthInput = document.getElementById('cal-runtime-width');
    const framesInput = document.getElementById('cal-runtime-frames');
    const btn = document.getElementById('cal-runtime-btn');
    const resultDiv = document.getElementById('cal-runtime-result');

    const width = parseFloat(widthInput?.value);
    const frames = parseInt(framesInput?.value) || 60;

    if (!width || width <= 0) {
      App.toast('Enter a valid cloth width in mm', 'error');
      return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Calibrating...'; }

    try {
      const result = await API.runtimeCalibration(width, frames);
      App.toast('Runtime calibration complete!', 'success');

      const badge = document.getElementById('cal-runtime-badge');
      if (badge) { badge.textContent = `${result.mm_per_px.toFixed(4)} mm/px`; badge.className = 'card-badge success'; }

      if (resultDiv) {
        resultDiv.innerHTML = `
          <hr class="section-divider" />
          <div class="grid-4">
            <div class="stat-card">
              <div class="stat-label">mm/px</div>
              <div class="stat-value accent">${result.mm_per_px.toFixed(4)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Avg Width</div>
              <div class="stat-value">${result.avg_width_px.toFixed(1)}</div>
              <div class="stat-sub">px</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Cloth Width</div>
              <div class="stat-value">${result.cloth_width_mm}</div>
              <div class="stat-sub">mm</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Samples</div>
              <div class="stat-value">${result.samples_used}</div>
            </div>
          </div>
        `;
      }
    } catch (err) {
      App.toast(`Runtime calibration failed: ${err.detail}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '📐 Calibrate'; }
    }
  }

  // ── Lens & Homography Data Viewer ───────────────────────────────────

  async function loadLensData(side) {
    const viewer = document.getElementById('cal-data-viewer');
    if (!viewer) return;
    viewer.innerHTML = `<div class="text-center"><span class="spinner"></span></div>`;

    try {
      const data = await API.getLensCalibration(side);
      viewer.innerHTML = `
        <h4 style="font-size:0.85rem; font-weight:600; margin-bottom:12px">${side.charAt(0).toUpperCase() + side.slice(1)} Camera — Lens Calibration</h4>
        <table class="data-table">
          <tr><th>Parameter</th><th>Value</th></tr>
          <tr><td>Image Size</td><td>${data.image_width_px} × ${data.image_height_px} px</td></tr>
          <tr><td>RMS Error</td><td><span class="calib-rms-badge ${data.rms < 0.5 ? 'excellent' : data.rms < 1.0 ? 'good' : 'poor'}">${data.rms.toFixed(4)} px</span></td></tr>
          <tr><td>Calibration Flags</td><td>${data.calib_flags || '—'}</td></tr>
          <tr><td>Distortion (k1…k3, p1, p2)</td><td class="text-mono">${data.dist_coeffs.map(c => c.toFixed(6)).join(', ')}</td></tr>
        </table>
        ${data.per_image_rms ? `
          <details class="calib-details mt-md">
            <summary>Per-Image Reprojection Errors</summary>
            <table class="data-table">
              <tr><th>Image</th><th>RMS Error</th></tr>
              ${data.per_image_rms.map((e, i) => `<tr><td>Image ${i + 1}</td><td><span class="calib-rms-badge ${e < 0.5 ? 'excellent' : e < 1.0 ? 'good' : 'poor'}">${e.toFixed(4)} px</span></td></tr>`).join('')}
            </table>
          </details>
        ` : ''}
      `;
    } catch (err) {
      viewer.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p class="empty-text">${err.detail || 'Failed to load'}</p></div>`;
    }
  }

  async function loadHomography(side) {
    const viewer = document.getElementById('cal-data-viewer');
    if (!viewer) return;
    viewer.innerHTML = `<div class="text-center"><span class="spinner"></span></div>`;

    try {
      const data = await API.getHomography(side);
      const method = data.method || '—';
      const methodLabel = method === 'auto_checkerboard_RANSAC' ? 'Auto (Chessboard RANSAC)' : method === 'manual_4point' ? 'Manual (4-Point)' : method;

      viewer.innerHTML = `
        <h4 style="font-size:0.85rem; font-weight:600; margin-bottom:12px">${side.charAt(0).toUpperCase() + side.slice(1)} Camera — Homography / Perspective</h4>
        <table class="data-table">
          <tr><th>Parameter</th><th>Value</th></tr>
          <tr><td>Output Size</td><td>${data.out_width} × ${data.out_height} px</td></tr>
          <tr><td>Scale</td><td>${data.scale_px_per_mm} px/mm</td></tr>
          <tr><td>Method</td><td>${methodLabel}</td></tr>
          ${data.num_points ? `<tr><td>Points Used</td><td>${data.inliers || '—'} / ${data.num_points} inliers</td></tr>` : ''}
          ${data.reproj_error_mean_px !== undefined ? `<tr><td>Reprojection Error</td><td>mean: ${data.reproj_error_mean_px} px, max: ${data.reproj_error_max_px} px</td></tr>` : ''}
          <tr><td>Matrix Row 1</td><td class="text-mono">[${data.homography[0].map(v => v.toFixed(6)).join(', ')}]</td></tr>
          <tr><td>Matrix Row 2</td><td class="text-mono">[${data.homography[1].map(v => v.toFixed(6)).join(', ')}]</td></tr>
          <tr><td>Matrix Row 3</td><td class="text-mono">[${data.homography[2].map(v => v.toFixed(6)).join(', ')}]</td></tr>
        </table>
      `;
    } catch (err) {
      viewer.innerHTML = `<div class="empty-state"><span class="empty-icon">❌</span><p class="empty-text">${err.detail || 'Failed to load'}</p></div>`;
    }
  }

  return {
    render, init, destroy,
    doStitchCalibration, clearStitch,
    doRuntimeCalibration,
    loadLensData, loadHomography,
    captureFrame, clearImages, runChessboardCalibration,
  };
})();
