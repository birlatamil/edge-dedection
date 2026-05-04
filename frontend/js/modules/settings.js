/**
 * settings.js — Configuration module for Canny, Stabilisation, and AOI
 * Now includes interactive AOI drawing directly on the camera feed.
 */

const Settings = (() => {

  // AOI drawing state per camera
  const aoiDraw = {
    left: { active: false, drawing: false, startX: 0, startY: 0, rect: null, imgW: 0, imgH: 0 },
    right: { active: false, drawing: false, startX: 0, startY: 0, rect: null, imgW: 0, imgH: 0 },
  };

  function render() {
    return `
      <div class="page-header">
        <h1 class="page-title">Settings</h1>
        <p class="page-subtitle">Fine-tune edge detection parameters and regions of interest</p>
      </div>

      <!-- Canny Thresholds -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">🔍</span> Edge Detection — Canny Thresholds</span>
          <button class="btn btn-sm btn-primary" onclick="Settings.saveCanny()">Save</button>
        </div>
        <p class="page-subtitle mb-md">Controls the sensitivity of edge detection. Lower values detect weaker edges (more noise), higher values detect only strong edges.</p>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Low Threshold <span class="form-sublabel">Weak edge cutoff</span></label>
            <div class="form-range-row">
              <input type="range" class="form-range" id="set-canny-low" min="0" max="300" value="50" oninput="Settings.updateCannyLabels()" />
              <span class="form-range-value" id="set-canny-low-val">50</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">High Threshold <span class="form-sublabel">Strong edge cutoff</span></label>
            <div class="form-range-row">
              <input type="range" class="form-range" id="set-canny-high" min="0" max="500" value="150" oninput="Settings.updateCannyLabels()" />
              <span class="form-range-value" id="set-canny-high-val">150</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Stabilisation -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">📊</span> Measurement Stabilisation</span>
          <button class="btn btn-sm btn-primary" onclick="Settings.saveStabilisation()">Save</button>
        </div>
        <p class="page-subtitle mb-md">Controls how measurements are smoothed. A larger window gives more stable readings but slower reaction to changes.</p>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Smoothing Window <span class="form-sublabel">Number of frames to average</span></label>
            <div class="form-range-row">
              <input type="range" class="form-range" id="set-smooth-window" min="1" max="200" value="30" oninput="Settings.updateStabLabels()" />
              <span class="form-range-value" id="set-smooth-window-val">30</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Max Deviation <span class="form-sublabel">Outlier rejection threshold (px)</span></label>
            <div class="form-range-row">
              <input type="range" class="form-range" id="set-max-deviation" min="1" max="200" value="50" oninput="Settings.updateStabLabels()" />
              <span class="form-range-value" id="set-max-deviation-val">50</span>
            </div>
          </div>
        </div>
      </div>

      <!-- AOI — Interactive -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">🔲</span> Area of Interest (AOI)</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" onclick="Settings.saveAoi()">Save AOI</button>
            <button class="btn btn-sm btn-danger" onclick="Settings.clearAoi()">Clear All</button>
          </div>
        </div>
        <p class="page-subtitle mb-md">Draw a rectangle directly on the camera feed to set the AOI. Click <strong>"Select AOI"</strong> to start, then drag on the image.</p>

        <div class="grid-2">
          <!-- Left Camera AOI -->
          <div>
            <div class="aoi-cam-header">
              <h4 class="aoi-cam-title">Left Camera</h4>
              <div class="btn-group">
                <button class="btn btn-sm btn-primary" id="aoi-select-left-btn" onclick="Settings.startAoiDraw('left')">✏️ Select AOI</button>
                <button class="btn btn-sm btn-secondary" onclick="Settings.refreshAoiPreview('left')">↻</button>
              </div>
            </div>
            <div class="aoi-preview-wrap" id="aoi-preview-wrap-left">
              <img class="aoi-preview-img" id="aoi-preview-img-left" alt="Left camera" />
              <canvas class="aoi-canvas" id="aoi-canvas-left"></canvas>
              <div class="aoi-instructions" id="aoi-instructions-left">Click & drag to draw AOI</div>
            </div>
            <div class="aoi-grid mt-sm">
              <div class="aoi-field"><label>X</label><input type="number" id="aoi-left-x" placeholder="0" /></div>
              <div class="aoi-field"><label>Y</label><input type="number" id="aoi-left-y" placeholder="0" /></div>
              <div class="aoi-field"><label>W</label><input type="number" id="aoi-left-w" placeholder="1280" /></div>
              <div class="aoi-field"><label>H</label><input type="number" id="aoi-left-h" placeholder="720" /></div>
            </div>
          </div>

          <!-- Right Camera AOI -->
          <div>
            <div class="aoi-cam-header">
              <h4 class="aoi-cam-title">Right Camera</h4>
              <div class="btn-group">
                <button class="btn btn-sm btn-primary" id="aoi-select-right-btn" onclick="Settings.startAoiDraw('right')">✏️ Select AOI</button>
                <button class="btn btn-sm btn-secondary" onclick="Settings.refreshAoiPreview('right')">↻</button>
              </div>
            </div>
            <div class="aoi-preview-wrap" id="aoi-preview-wrap-right">
              <img class="aoi-preview-img" id="aoi-preview-img-right" alt="Right camera" />
              <canvas class="aoi-canvas" id="aoi-canvas-right"></canvas>
              <div class="aoi-instructions" id="aoi-instructions-right">Click & drag to draw AOI</div>
            </div>
            <div class="aoi-grid mt-sm">
              <div class="aoi-field"><label>X</label><input type="number" id="aoi-right-x" placeholder="0" /></div>
              <div class="aoi-field"><label>Y</label><input type="number" id="aoi-right-y" placeholder="0" /></div>
              <div class="aoi-field"><label>W</label><input type="number" id="aoi-right-w" placeholder="1280" /></div>
              <div class="aoi-field"><label>H</label><input type="number" id="aoi-right-h" placeholder="720" /></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function init() {
    // Load current Canny values
    try {
      const canny = await API.getCanny();
      setSlider('set-canny-low', canny.canny_low);
      setSlider('set-canny-high', canny.canny_high);
      updateCannyLabels();
    } catch { /* backend offline */ }

    // Load current stabilisation values
    try {
      const stab = await API.getStabilisation();
      setSlider('set-smooth-window', stab.smooth_window);
      setSlider('set-max-deviation', stab.max_deviation_px);
      updateStabLabels();
    } catch { /* backend offline */ }

    // Load current AOI values
    try {
      const aoi = await API.getAoi();
      if (aoi.left_aoi) {
        setInput('aoi-left-x', aoi.left_aoi.x);
        setInput('aoi-left-y', aoi.left_aoi.y);
        setInput('aoi-left-w', aoi.left_aoi.w);
        setInput('aoi-left-h', aoi.left_aoi.h);
      }
      if (aoi.right_aoi) {
        setInput('aoi-right-x', aoi.right_aoi.x);
        setInput('aoi-right-y', aoi.right_aoi.y);
        setInput('aoi-right-w', aoi.right_aoi.w);
        setInput('aoi-right-h', aoi.right_aoi.h);
      }
    } catch { /* backend offline */ }

    // Load camera preview snapshots and draw existing AOI
    refreshAoiPreview('left');
    refreshAoiPreview('right');
  }

  function destroy() {
    // Clean up canvas event listeners
    ['left', 'right'].forEach(side => {
      aoiDraw[side].active = false;
      aoiDraw[side].drawing = false;
    });
  }

  // ── AOI Preview & Interactive Drawing ─────────────────────────

  function refreshAoiPreview(side) {
    const img = document.getElementById(`aoi-preview-img-${side}`);
    if (!img) return;

    const url = API.snapshotUrl(side, 80, false);
    img.onload = () => {
      // Store actual image dimensions for coordinate mapping
      aoiDraw[side].imgW = img.naturalWidth;
      aoiDraw[side].imgH = img.naturalHeight;
      // Size canvas to match rendered image
      resizeCanvas(side);
      // Redraw any existing AOI
      drawExistingAoi(side);
    };
    img.onerror = () => {
      // Show fallback text
      const canvas = document.getElementById(`aoi-canvas-${side}`);
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Camera offline', canvas.width / 2, canvas.height / 2);
      }
    };
    img.src = url;
  }

  function resizeCanvas(side) {
    const img = document.getElementById(`aoi-preview-img-${side}`);
    const canvas = document.getElementById(`aoi-canvas-${side}`);
    if (!img || !canvas) return;
    // Match canvas size to the displayed image size
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function drawExistingAoi(side) {
    const canvas = document.getElementById(`aoi-canvas-${side}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Read current AOI values from inputs
    const x = getInput(`aoi-${side}-x`);
    const y = getInput(`aoi-${side}-y`);
    const w = getInput(`aoi-${side}-w`);
    const h = getInput(`aoi-${side}-h`);

    if (x === null || y === null || w === null || h === null) return;

    const imgW = aoiDraw[side].imgW || 1280;
    const imgH = aoiDraw[side].imgH || 720;
    const scaleX = canvas.width / imgW;
    const scaleY = canvas.height / imgH;

    // Draw dimmed overlay outside the AOI
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear the AOI region (punch a hole)
    ctx.clearRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);

    // Draw AOI border
    ctx.strokeStyle = '#2A9D8F';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);
    ctx.setLineDash([]);

    // Draw corner handles
    const handleSize = 8;
    ctx.fillStyle = '#2A9D8F';
    const corners = [
      [x * scaleX, y * scaleY],
      [(x + w) * scaleX, y * scaleY],
      [x * scaleX, (y + h) * scaleY],
      [(x + w) * scaleX, (y + h) * scaleY],
    ];
    corners.forEach(([cx, cy]) => {
      ctx.fillRect(cx - handleSize/2, cy - handleSize/2, handleSize, handleSize);
    });

    // Label
    ctx.fillStyle = '#2A9D8F';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`AOI: ${w}×${h} @ (${x},${y})`, x * scaleX + 4, y * scaleY - 6);
  }

  function startAoiDraw(side) {
    const ds = aoiDraw[side];
    const canvas = document.getElementById(`aoi-canvas-${side}`);
    const btn = document.getElementById(`aoi-select-${side}-btn`);
    const instructions = document.getElementById(`aoi-instructions-${side}`);

    if (!canvas) return;

    if (ds.active) {
      // Cancel mode
      ds.active = false;
      canvas.style.cursor = 'default';
      if (btn) { btn.textContent = '✏️ Select AOI'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); }
      if (instructions) instructions.classList.remove('visible');
      drawExistingAoi(side);
      return;
    }

    // Refresh the snapshot first so we draw on a fresh image
    refreshAoiPreview(side);

    ds.active = true;
    ds.drawing = false;
    canvas.style.cursor = 'crosshair';
    if (btn) { btn.textContent = '✕ Cancel'; btn.classList.remove('btn-primary'); btn.classList.add('btn-danger'); }
    if (instructions) instructions.classList.add('visible');

    // Remove old listeners before adding new ones
    canvas.onmousedown = (e) => onMouseDown(e, side);
    canvas.onmousemove = (e) => onMouseMove(e, side);
    canvas.onmouseup = (e) => onMouseUp(e, side);

    // Touch support
    canvas.ontouchstart = (e) => { e.preventDefault(); onMouseDown(touchToMouse(e, canvas), side); };
    canvas.ontouchmove = (e) => { e.preventDefault(); onMouseMove(touchToMouse(e, canvas), side); };
    canvas.ontouchend = (e) => { e.preventDefault(); onMouseUp(touchToMouse(e, canvas), side); };

    App.toast(`Draw a rectangle on the ${side} camera feed`, 'info');
  }

  function touchToMouse(touchEvent, canvas) {
    const touch = touchEvent.touches[0] || touchEvent.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    return { offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top };
  }

  function onMouseDown(e, side) {
    const ds = aoiDraw[side];
    if (!ds.active) return;
    ds.drawing = true;
    ds.startX = e.offsetX;
    ds.startY = e.offsetY;
  }

  function onMouseMove(e, side) {
    const ds = aoiDraw[side];
    if (!ds.active || !ds.drawing) return;

    const canvas = document.getElementById(`aoi-canvas-${side}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const x = Math.min(ds.startX, e.offsetX);
    const y = Math.min(ds.startY, e.offsetY);
    const w = Math.abs(e.offsetX - ds.startX);
    const h = Math.abs(e.offsetY - ds.startY);

    // Clear and redraw
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dim outside the selection
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(x, y, w, h);

    // Selection rectangle
    ctx.strokeStyle = '#2A9D8F';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Size label
    const imgW = ds.imgW || 1280;
    const imgH = ds.imgH || 720;
    const scaleX = imgW / canvas.width;
    const scaleY = imgH / canvas.height;
    const realW = Math.round(w * scaleX);
    const realH = Math.round(h * scaleY);

    ctx.fillStyle = 'rgba(42, 157, 143, 0.9)';
    ctx.fillRect(x, y - 22, Math.max(120, 10), 20);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${realW} × ${realH} px`, x + 4, y - 8);
  }

  function onMouseUp(e, side) {
    const ds = aoiDraw[side];
    if (!ds.active || !ds.drawing) return;
    ds.drawing = false;

    const canvas = document.getElementById(`aoi-canvas-${side}`);
    if (!canvas) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;

    // Canvas coordinates of the rectangle
    let cx = Math.min(ds.startX, e.offsetX);
    let cy = Math.min(ds.startY, e.offsetY);
    let cw = Math.abs(e.offsetX - ds.startX);
    let ch = Math.abs(e.offsetY - ds.startY);

    // Ignore tiny accidental clicks
    if (cw < 5 || ch < 5) {
      App.toast('Selection too small — drag a larger rectangle', 'error');
      return;
    }

    // Convert to actual image pixel coordinates
    const imgW = ds.imgW || 1280;
    const imgH = ds.imgH || 720;
    const scaleX = imgW / canvasW;
    const scaleY = imgH / canvasH;

    const realX = Math.max(0, Math.round(cx * scaleX));
    const realY = Math.max(0, Math.round(cy * scaleY));
    const realW = Math.min(imgW - realX, Math.round(cw * scaleX));
    const realH = Math.min(imgH - realY, Math.round(ch * scaleY));

    // Populate inputs
    setInput(`aoi-${side}-x`, realX);
    setInput(`aoi-${side}-y`, realY);
    setInput(`aoi-${side}-w`, realW);
    setInput(`aoi-${side}-h`, realH);

    // Exit drawing mode
    ds.active = false;
    canvas.style.cursor = 'default';
    const btn = document.getElementById(`aoi-select-${side}-btn`);
    if (btn) { btn.textContent = '✏️ Select AOI'; btn.classList.remove('btn-danger'); btn.classList.add('btn-primary'); }
    const instructions = document.getElementById(`aoi-instructions-${side}`);
    if (instructions) instructions.classList.remove('visible');

    // Redraw with finalized AOI
    drawExistingAoi(side);

    App.toast(`${side.charAt(0).toUpperCase() + side.slice(1)} AOI set: ${realW}×${realH} @ (${realX},${realY})`, 'success');
  }

  // ── Helpers ───────────────────────────────────────────────────

  function setSlider(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function setInput(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function getInput(id) {
    const el = document.getElementById(id);
    return el && el.value !== '' ? parseInt(el.value) : null;
  }

  function updateCannyLabels() {
    const low = document.getElementById('set-canny-low');
    const high = document.getElementById('set-canny-high');
    const lowVal = document.getElementById('set-canny-low-val');
    const highVal = document.getElementById('set-canny-high-val');
    if (low && lowVal) lowVal.textContent = low.value;
    if (high && highVal) highVal.textContent = high.value;
  }

  function updateStabLabels() {
    const win = document.getElementById('set-smooth-window');
    const dev = document.getElementById('set-max-deviation');
    const winVal = document.getElementById('set-smooth-window-val');
    const devVal = document.getElementById('set-max-deviation-val');
    if (win && winVal) winVal.textContent = win.value;
    if (dev && devVal) devVal.textContent = dev.value;
  }

  // ── API actions ───────────────────────────────────────────────

  async function saveCanny() {
    const low = parseInt(document.getElementById('set-canny-low').value);
    const high = parseInt(document.getElementById('set-canny-high').value);
    if (low >= high) {
      App.toast('Low threshold must be less than high threshold', 'error');
      return;
    }
    try {
      await API.updateCanny(low, high);
      App.toast('Canny thresholds updated', 'success');
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  async function saveStabilisation() {
    const win = parseInt(document.getElementById('set-smooth-window').value);
    const dev = parseFloat(document.getElementById('set-max-deviation').value);
    try {
      await API.updateStabilisation(win, dev);
      App.toast('Stabilisation updated & filter reset', 'success');
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  async function saveAoi() {
    const leftAoi = buildAoi('left');
    const rightAoi = buildAoi('right');
    try {
      await API.updateAoi(leftAoi, rightAoi);
      App.toast('AOI configuration saved', 'success');
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  function buildAoi(side) {
    const x = getInput(`aoi-${side}-x`);
    const y = getInput(`aoi-${side}-y`);
    const w = getInput(`aoi-${side}-w`);
    const h = getInput(`aoi-${side}-h`);
    if (x !== null && y !== null && w !== null && h !== null) {
      return { x, y, w, h };
    }
    return null;
  }

  async function clearAoi() {
    try {
      await API.clearAoi();
      ['left', 'right'].forEach(side => {
        ['x', 'y', 'w', 'h'].forEach(f => {
          const el = document.getElementById(`aoi-${side}-${f}`);
          if (el) el.value = '';
        });
        // Clear canvas overlays
        const canvas = document.getElementById(`aoi-canvas-${side}`);
        if (canvas) {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      });
      App.toast('AOI cleared — using full frame', 'success');
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  return {
    render, init, destroy,
    saveCanny, saveStabilisation, saveAoi, clearAoi,
    updateCannyLabels, updateStabLabels,
    startAoiDraw, refreshAoiPreview,
  };
})();
