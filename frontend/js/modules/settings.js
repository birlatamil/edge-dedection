/**
 * settings.js — Configuration module for Canny, Stabilisation, and AOI
 * AOI selection is done via a full-screen modal for precise drawing.
 */

const Settings = (() => {

  // AOI modal drawing state
  const aoiModal = {
    side: null,        // 'left' | 'right'
    drawing: false,
    startX: 0,
    startY: 0,
    imgW: 0,
    imgH: 0,
    confirmed: false,
  };

  // Small inline preview drawing state (read-only overlay, no interaction)
  const aoiPreview = {
    left:  { imgW: 0, imgH: 0 },
    right: { imgW: 0, imgH: 0 },
  };

  // ── HTML template ─────────────────────────────────────────────

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
        <p class="page-subtitle mb-md">
          Click <strong>"Select AOI"</strong> to open a large fullscreen selection window.
          Drag a rectangle on the camera image for a precise selection, then click <strong>Confirm</strong>.
        </p>

        <div class="grid-2">
          <!-- Left Camera AOI -->
          <div>
            <div class="aoi-cam-header">
              <h4 class="aoi-cam-title">Left Camera</h4>
              <div class="btn-group">
                <button class="btn btn-sm btn-primary" id="aoi-select-left-btn" onclick="Settings.openAoiModal('left')">✏️ Select AOI</button>
                <button class="btn btn-sm btn-secondary" onclick="Settings.refreshAoiPreview('left')">↻</button>
              </div>
            </div>
            <div class="aoi-preview-wrap" id="aoi-preview-wrap-left">
              <img class="aoi-preview-img" id="aoi-preview-img-left" alt="Left camera" />
              <canvas class="aoi-canvas" id="aoi-canvas-left"></canvas>
            </div>
            <div class="aoi-grid mt-sm">
              <div class="aoi-field"><label>X</label><input type="number" id="aoi-left-x" placeholder="0" oninput="Settings.drawExistingAoi('left')" /></div>
              <div class="aoi-field"><label>Y</label><input type="number" id="aoi-left-y" placeholder="0" oninput="Settings.drawExistingAoi('left')" /></div>
              <div class="aoi-field"><label>W</label><input type="number" id="aoi-left-w" placeholder="1280" oninput="Settings.drawExistingAoi('left')" /></div>
              <div class="aoi-field"><label>H</label><input type="number" id="aoi-left-h" placeholder="720" oninput="Settings.drawExistingAoi('left')" /></div>
            </div>
          </div>

          <!-- Right Camera AOI -->
          <div>
            <div class="aoi-cam-header">
              <h4 class="aoi-cam-title">Right Camera</h4>
              <div class="btn-group">
                <button class="btn btn-sm btn-primary" id="aoi-select-right-btn" onclick="Settings.openAoiModal('right')">✏️ Select AOI</button>
                <button class="btn btn-sm btn-secondary" onclick="Settings.refreshAoiPreview('right')">↻</button>
              </div>
            </div>
            <div class="aoi-preview-wrap" id="aoi-preview-wrap-right">
              <img class="aoi-preview-img" id="aoi-preview-img-right" alt="Right camera" />
              <canvas class="aoi-canvas" id="aoi-canvas-right"></canvas>
            </div>
            <div class="aoi-grid mt-sm">
              <div class="aoi-field"><label>X</label><input type="number" id="aoi-right-x" placeholder="0" oninput="Settings.drawExistingAoi('right')" /></div>
              <div class="aoi-field"><label>Y</label><input type="number" id="aoi-right-y" placeholder="0" oninput="Settings.drawExistingAoi('right')" /></div>
              <div class="aoi-field"><label>W</label><input type="number" id="aoi-right-w" placeholder="1280" oninput="Settings.drawExistingAoi('right')" /></div>
              <div class="aoi-field"><label>H</label><input type="number" id="aoi-right-h" placeholder="720" oninput="Settings.drawExistingAoi('right')" /></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Full-Screen AOI Modal ──────────────────────────────── -->
      <div class="aoi-modal-backdrop" id="aoi-modal-backdrop" onclick="Settings.closeAoiModal()"></div>
      <div class="aoi-modal" id="aoi-modal" role="dialog" aria-modal="true" aria-label="AOI Selection">
        <div class="aoi-modal-header">
          <div class="aoi-modal-title">
            <span class="aoi-modal-icon">🔲</span>
            <span id="aoi-modal-title-text">Select AOI — Left Camera</span>
          </div>
          <div class="aoi-modal-hint" id="aoi-modal-hint">Click and drag to draw a selection rectangle</div>
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" id="aoi-modal-confirm-btn" onclick="Settings.confirmAoiModal()" disabled>✓ Confirm</button>
            <button class="btn btn-sm btn-secondary" onclick="Settings.resetAoiModal()">↺ Reset</button>
            <button class="btn btn-sm btn-danger" onclick="Settings.closeAoiModal()">✕ Cancel</button>
          </div>
        </div>
        <div class="aoi-modal-body">
          <div class="aoi-modal-canvas-wrap" id="aoi-modal-canvas-wrap">
            <img class="aoi-modal-img" id="aoi-modal-img" alt="Camera snapshot" />
            <canvas class="aoi-modal-canvas" id="aoi-modal-canvas"></canvas>
            <div class="aoi-modal-size-badge" id="aoi-modal-size-badge"></div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

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

    // Load current AOI values from backend (which already read aoi.json on startup)
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
    closeAoiModal();
  }

  // ── Small Inline Preview (read-only) ──────────────────────────

  function refreshAoiPreview(side) {
    const img = document.getElementById(`aoi-preview-img-${side}`);
    if (!img) return;

    const url = API.snapshotUrl(side, 80, false);
    img.onload = () => {
      aoiPreview[side].imgW = img.naturalWidth;
      aoiPreview[side].imgH = img.naturalHeight;
      resizeCanvas(side);
      drawExistingAoi(side);
    };
    img.onerror = () => {
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
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function drawExistingAoi(side) {
    const canvas = document.getElementById(`aoi-canvas-${side}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const x = getInput(`aoi-${side}-x`);
    const y = getInput(`aoi-${side}-y`);
    const w = getInput(`aoi-${side}-w`);
    const h = getInput(`aoi-${side}-h`);

    if (x === null || y === null || w === null || h === null) return;

    const imgW = aoiPreview[side].imgW || 1280;
    const imgH = aoiPreview[side].imgH || 720;
    const scaleX = canvas.width / imgW;
    const scaleY = canvas.height / imgH;

    // Dimmed overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Punch hole for AOI region
    ctx.clearRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);

    // AOI border
    ctx.strokeStyle = '#2A9D8F';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);
    ctx.setLineDash([]);

    // Corner handles
    const hs = 8;
    ctx.fillStyle = '#2A9D8F';
    [[x * scaleX, y * scaleY], [(x+w)*scaleX, y*scaleY],
     [x*scaleX, (y+h)*scaleY], [(x+w)*scaleX, (y+h)*scaleY]].forEach(([cx, cy]) => {
      ctx.fillRect(cx - hs/2, cy - hs/2, hs, hs);
    });

    // Label
    ctx.fillStyle = '#2A9D8F';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`AOI: ${w}×${h} @ (${x},${y})`, x * scaleX + 4, y * scaleY - 6);
  }

  // ── Full-Screen AOI Modal ─────────────────────────────────────

  function openAoiModal(side) {
    aoiModal.side = side;
    aoiModal.drawing = false;
    aoiModal.confirmed = false;
    aoiModal.startX = 0;
    aoiModal.startY = 0;

    // Update title
    const titleEl = document.getElementById('aoi-modal-title-text');
    if (titleEl) titleEl.textContent = `Select AOI — ${side.charAt(0).toUpperCase() + side.slice(1)} Camera`;

    // Reset confirm button
    const confirmBtn = document.getElementById('aoi-modal-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    // Reset hint
    const hint = document.getElementById('aoi-modal-hint');
    if (hint) hint.textContent = 'Click and drag to draw a selection rectangle';

    // Load fresh high-res snapshot into modal
    const modalImg = document.getElementById('aoi-modal-img');
    if (modalImg) {
      modalImg.onload = () => {
        aoiModal.imgW = modalImg.naturalWidth;
        aoiModal.imgH = modalImg.naturalHeight;
        setupModalCanvas();
        // Draw any pre-existing AOI from inputs
        drawModalExistingAoi();
      };
      modalImg.onerror = () => {
        const hint = document.getElementById('aoi-modal-hint');
        if (hint) hint.textContent = '⚠ Camera offline — cannot load snapshot';
      };
      // Use highest quality for modal
      modalImg.src = API.snapshotUrl(side, 95, false);
    }

    // Show modal
    document.getElementById('aoi-modal-backdrop').classList.add('visible');
    document.getElementById('aoi-modal').classList.add('visible');
    document.body.style.overflow = 'hidden';

    // Keyboard shortcut: Escape to close
    document._aoiKeyHandler = (e) => { if (e.key === 'Escape') closeAoiModal(); };
    document.addEventListener('keydown', document._aoiKeyHandler);
  }

  function setupModalCanvas() {
    const img = document.getElementById('aoi-modal-img');
    const canvas = document.getElementById('aoi-modal-canvas');
    if (!img || !canvas) return;

    const rect = img.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.cursor = 'crosshair';
    canvas.style.pointerEvents = 'auto';

    // Bind mouse events
    canvas.onmousedown = modalMouseDown;
    canvas.onmousemove = modalMouseMove;
    canvas.onmouseup = modalMouseUp;
    canvas.onmouseleave = modalMouseUp;

    // Touch events
    canvas.ontouchstart = (e) => { e.preventDefault(); modalMouseDown(touchEvt(e, canvas)); };
    canvas.ontouchmove  = (e) => { e.preventDefault(); modalMouseMove(touchEvt(e, canvas)); };
    canvas.ontouchend   = (e) => { e.preventDefault(); modalMouseUp(touchEvt(e, canvas)); };
  }

  function touchEvt(e, canvas) {
    const t = e.touches[0] || e.changedTouches[0];
    const r = canvas.getBoundingClientRect();
    return { offsetX: t.clientX - r.left, offsetY: t.clientY - r.top };
  }

  function modalMouseDown(e) {
    aoiModal.drawing = true;
    aoiModal.startX = e.offsetX;
    aoiModal.startY = e.offsetY;
    // Clear size badge when starting a new draw
    const badge = document.getElementById('aoi-modal-size-badge');
    if (badge) badge.textContent = '';
  }

  function modalMouseMove(e) {
    if (!aoiModal.drawing) return;
    const canvas = document.getElementById('aoi-modal-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const x = Math.min(aoiModal.startX, e.offsetX);
    const y = Math.min(aoiModal.startY, e.offsetY);
    const w = Math.abs(e.offsetX - aoiModal.startX);
    const h = Math.abs(e.offsetY - aoiModal.startY);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dim outside selection
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(x, y, w, h);

    // Selection border
    ctx.strokeStyle = '#2A9D8F';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Corner handles
    const hs = 10;
    ctx.fillStyle = '#2A9D8F';
    [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].forEach(([cx, cy]) => {
      ctx.fillRect(cx - hs/2, cy - hs/2, hs, hs);
    });

    // Live size badge overlay
    const sX = aoiModal.imgW / canvas.width;
    const sY = aoiModal.imgH / canvas.height;
    const realW = Math.round(w * sX);
    const realH = Math.round(h * sY);
    const badge = document.getElementById('aoi-modal-size-badge');
    if (badge) {
      badge.textContent = `${realW} × ${realH} px`;
      badge.style.left = `${x + canvas.getBoundingClientRect().left - document.getElementById('aoi-modal-canvas-wrap').getBoundingClientRect().left + 4}px`;
      badge.style.top  = `${Math.max(y - 32, 4) + canvas.getBoundingClientRect().top - document.getElementById('aoi-modal-canvas-wrap').getBoundingClientRect().top}px`;
      badge.classList.add('visible');
    }
  }

  function modalMouseUp(e) {
    if (!aoiModal.drawing) return;
    aoiModal.drawing = false;

    const canvas = document.getElementById('aoi-modal-canvas');
    if (!canvas) return;

    let cx = Math.min(aoiModal.startX, e.offsetX);
    let cy = Math.min(aoiModal.startY, e.offsetY);
    let cw = Math.abs(e.offsetX - aoiModal.startX);
    let ch = Math.abs(e.offsetY - aoiModal.startY);

    // Ignore tiny accidental clicks
    if (cw < 10 || ch < 10) {
      const hint = document.getElementById('aoi-modal-hint');
      if (hint) hint.textContent = '⚠ Selection too small — drag a larger rectangle';
      return;
    }

    // Convert canvas coords → actual image pixel coords
    const scaleX = aoiModal.imgW / canvas.width;
    const scaleY = aoiModal.imgH / canvas.height;
    aoiModal.rect = {
      x: Math.max(0, Math.round(cx * scaleX)),
      y: Math.max(0, Math.round(cy * scaleY)),
      w: Math.min(aoiModal.imgW - Math.round(cx * scaleX), Math.round(cw * scaleX)),
      h: Math.min(aoiModal.imgH - Math.round(cy * scaleY), Math.round(ch * scaleY)),
    };

    // Update hint and enable confirm
    const hint = document.getElementById('aoi-modal-hint');
    if (hint) hint.textContent = `Selected: ${aoiModal.rect.w} × ${aoiModal.rect.h} px  @  (${aoiModal.rect.x}, ${aoiModal.rect.y})  — click Confirm to apply`;

    const confirmBtn = document.getElementById('aoi-modal-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = false;
  }

  function drawModalExistingAoi() {
    const side = aoiModal.side;
    const canvas = document.getElementById('aoi-modal-canvas');
    if (!canvas) return;

    const x = getInput(`aoi-${side}-x`);
    const y = getInput(`aoi-${side}-y`);
    const w = getInput(`aoi-${side}-w`);
    const h = getInput(`aoi-${side}-h`);
    if (x === null || y === null || w === null || h === null) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sX = canvas.width / (aoiModal.imgW || 1280);
    const sY = canvas.height / (aoiModal.imgH || 720);

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(x * sX, y * sY, w * sX, h * sY);

    ctx.strokeStyle = '#2A9D8F';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(x * sX, y * sY, w * sX, h * sY);
    ctx.setLineDash([]);

    // Pre-fill modal.rect so Confirm works even without re-drawing
    aoiModal.rect = { x, y, w, h };
    const confirmBtn = document.getElementById('aoi-modal-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = false;

    const hint = document.getElementById('aoi-modal-hint');
    if (hint) hint.textContent = `Existing AOI: ${w} × ${h} px @ (${x}, ${y}) — drag to replace or click Confirm to keep`;
  }

  function resetAoiModal() {
    const canvas = document.getElementById('aoi-modal-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    aoiModal.rect = null;
    aoiModal.drawing = false;
    const confirmBtn = document.getElementById('aoi-modal-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;
    const hint = document.getElementById('aoi-modal-hint');
    if (hint) hint.textContent = 'Click and drag to draw a selection rectangle';
    const badge = document.getElementById('aoi-modal-size-badge');
    if (badge) badge.classList.remove('visible');
  }

  function confirmAoiModal() {
    const side = aoiModal.side;
    const r = aoiModal.rect;
    if (!r || !side) return;

    setInput(`aoi-${side}-x`, r.x);
    setInput(`aoi-${side}-y`, r.y);
    setInput(`aoi-${side}-w`, r.w);
    setInput(`aoi-${side}-h`, r.h);

    closeAoiModal();

    // Refresh the small inline preview
    refreshAoiPreview(side);
    setTimeout(() => drawExistingAoi(side), 600);

    App.toast(`${side.charAt(0).toUpperCase() + side.slice(1)} AOI set: ${r.w}×${r.h} @ (${r.x},${r.y})`, 'success');
  }

  function closeAoiModal() {
    document.getElementById('aoi-modal-backdrop').classList.remove('visible');
    document.getElementById('aoi-modal').classList.remove('visible');
    document.body.style.overflow = '';
    aoiModal.drawing = false;

    // Remove keyboard listener
    if (document._aoiKeyHandler) {
      document.removeEventListener('keydown', document._aoiKeyHandler);
      document._aoiKeyHandler = null;
    }

    // Teardown canvas listeners
    const canvas = document.getElementById('aoi-modal-canvas');
    if (canvas) {
      canvas.onmousedown = null;
      canvas.onmousemove = null;
      canvas.onmouseup = null;
      canvas.onmouseleave = null;
      canvas.ontouchstart = null;
      canvas.ontouchmove = null;
      canvas.ontouchend = null;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────

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
    const low  = document.getElementById('set-canny-low');
    const high = document.getElementById('set-canny-high');
    const lowVal  = document.getElementById('set-canny-low-val');
    const highVal = document.getElementById('set-canny-high-val');
    if (low  && lowVal)  lowVal.textContent  = low.value;
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

  // ── API Actions ────────────────────────────────────────────────

  async function saveCanny() {
    const low  = parseInt(document.getElementById('set-canny-low').value);
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
    const leftAoi  = buildAoi('left');
    const rightAoi = buildAoi('right');
    try {
      await API.updateAoi(leftAoi, rightAoi);
      // Refresh inline previews to reflect saved state
      refreshAoiPreview('left');
      refreshAoiPreview('right');
      App.toast('AOI saved to aoi.json — will persist across restarts', 'success');
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
    openAoiModal, closeAoiModal, confirmAoiModal, resetAoiModal,
    refreshAoiPreview, drawExistingAoi,
  };
})();
