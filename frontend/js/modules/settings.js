/**
 * settings.js — Configuration module for Canny, Stabilisation, and AOI
 */

const Settings = (() => {

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

      <!-- AOI -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">🔲</span> Area of Interest (AOI)</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" onclick="Settings.saveAoi()">Save</button>
            <button class="btn btn-sm btn-danger" onclick="Settings.clearAoi()">Clear All</button>
          </div>
        </div>
        <p class="page-subtitle mb-md">Restrict edge detection to a specific rectangular region. Leave fields empty to use the full frame.</p>

        <div class="grid-2">
          <div>
            <h4 style="font-size:0.85rem; font-weight:600; margin-bottom:12px; color:var(--text-secondary);">Left Camera AOI</h4>
            <div class="aoi-grid">
              <div class="aoi-field"><label>X</label><input type="number" id="aoi-left-x" placeholder="0" /></div>
              <div class="aoi-field"><label>Y</label><input type="number" id="aoi-left-y" placeholder="0" /></div>
              <div class="aoi-field"><label>W</label><input type="number" id="aoi-left-w" placeholder="1280" /></div>
              <div class="aoi-field"><label>H</label><input type="number" id="aoi-left-h" placeholder="720" /></div>
            </div>
          </div>
          <div>
            <h4 style="font-size:0.85rem; font-weight:600; margin-bottom:12px; color:var(--text-secondary);">Right Camera AOI</h4>
            <div class="aoi-grid">
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
    // Load current values
    try {
      const canny = await API.getCanny();
      setSlider('set-canny-low', canny.canny_low);
      setSlider('set-canny-high', canny.canny_high);
      updateCannyLabels();
    } catch { /* backend offline */ }

    try {
      const stab = await API.getStabilisation();
      setSlider('set-smooth-window', stab.smooth_window);
      setSlider('set-max-deviation', stab.max_deviation_px);
      updateStabLabels();
    } catch { /* backend offline */ }

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
  }

  function destroy() {}

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
      });
      App.toast('AOI cleared — using full frame', 'success');
    } catch (err) {
      App.toast(`Error: ${err.detail}`, 'error');
    }
  }

  return { render, init, destroy, saveCanny, saveStabilisation, saveAoi, clearAoi, updateCannyLabels, updateStabLabels };
})();
