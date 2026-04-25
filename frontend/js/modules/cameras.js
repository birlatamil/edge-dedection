/**
 * cameras.js — Live camera feed module
 */

const Cameras = (() => {
  let refreshIntervals = [];

  function render() {
    return `
      <div class="page-header">
        <h1 class="page-title">Camera Feeds</h1>
        <p class="page-subtitle">Live RTSP camera streams with edge overlay</p>
      </div>

      <div class="grid-2">
        <!-- Left Camera -->
        <div class="card">
          <div class="card-header">
            <span class="card-title"><span class="card-icon">📷</span> Left Camera</span>
            <div class="btn-group">
              <button class="btn btn-sm btn-secondary" onclick="Cameras.toggleAnnotation('left')">Toggle Edge</button>
              <button class="btn btn-sm btn-secondary" onclick="Cameras.refreshSnapshot('left')">↻ Refresh</button>
            </div>
          </div>
          <div id="cam-left-container">
            <div class="camera-placeholder" id="cam-left-placeholder">
              <span class="placeholder-icon">📷</span>
              <span class="placeholder-text">Loading left camera...</span>
            </div>
            <img class="camera-feed" id="cam-left-feed" style="display:none" alt="Left camera feed" />
          </div>
          <div class="mt-md flex-between">
            <span class="status-tag online" id="cam-left-status">Connecting</span>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" onclick="Cameras.startStream('left')">▶ Stream</button>
              <button class="btn btn-sm btn-secondary" onclick="Cameras.stopStream('left')">⏸ Stop</button>
            </div>
          </div>
        </div>

        <!-- Right Camera -->
        <div class="card">
          <div class="card-header">
            <span class="card-title"><span class="card-icon">📷</span> Right Camera</span>
            <div class="btn-group">
              <button class="btn btn-sm btn-secondary" onclick="Cameras.toggleAnnotation('right')">Toggle Edge</button>
              <button class="btn btn-sm btn-secondary" onclick="Cameras.refreshSnapshot('right')">↻ Refresh</button>
            </div>
          </div>
          <div id="cam-right-container">
            <div class="camera-placeholder" id="cam-right-placeholder">
              <span class="placeholder-icon">📷</span>
              <span class="placeholder-text">Loading right camera...</span>
            </div>
            <img class="camera-feed" id="cam-right-feed" style="display:none" alt="Right camera feed" />
          </div>
          <div class="mt-md flex-between">
            <span class="status-tag online" id="cam-right-status">Connecting</span>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" onclick="Cameras.startStream('right')">▶ Stream</button>
              <button class="btn btn-sm btn-secondary" onclick="Cameras.stopStream('right')">⏸ Stop</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Quality control -->
      <div class="card mt-lg">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">⚙️</span> Feed Settings</span>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">JPEG Quality <span class="form-sublabel">Higher = better image, more bandwidth</span></label>
            <div class="form-range-row">
              <input type="range" class="form-range" id="cam-quality" min="10" max="100" value="70" oninput="Cameras.updateQualityLabel()" />
              <span class="form-range-value" id="cam-quality-val">70</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Refresh Interval <span class="form-sublabel">For snapshot mode (ms)</span></label>
            <div class="form-range-row">
              <input type="range" class="form-range" id="cam-interval" min="200" max="5000" step="100" value="1000" oninput="Cameras.updateIntervalLabel()" />
              <span class="form-range-value" id="cam-interval-val">1000ms</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const state = {
    left: { annotated: false, mode: 'snapshot', interval: null },
    right: { annotated: false, mode: 'snapshot', interval: null },
  };

  function init() {
    refreshSnapshot('left');
    refreshSnapshot('right');
  }

  function destroy() {
    clearAllIntervals();
  }

  function clearAllIntervals() {
    refreshIntervals.forEach(id => clearInterval(id));
    refreshIntervals = [];
    if (state.left.interval) { clearInterval(state.left.interval); state.left.interval = null; }
    if (state.right.interval) { clearInterval(state.right.interval); state.right.interval = null; }
  }

  function getQuality() {
    const el = document.getElementById('cam-quality');
    return el ? parseInt(el.value) : 70;
  }

  function refreshSnapshot(side) {
    const feed = document.getElementById(`cam-${side}-feed`);
    const placeholder = document.getElementById(`cam-${side}-placeholder`);
    const statusEl = document.getElementById(`cam-${side}-status`);

    if (!feed) return;

    const url = API.snapshotUrl(side, getQuality(), state[side].annotated);
    feed.onload = () => {
      feed.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
      if (statusEl) { statusEl.textContent = 'Connected'; statusEl.className = 'status-tag online'; }
    };
    feed.onerror = () => {
      feed.style.display = 'none';
      if (placeholder) {
        placeholder.style.display = 'flex';
        placeholder.querySelector('.placeholder-text').textContent = 'Camera offline';
      }
      if (statusEl) { statusEl.textContent = 'Offline'; statusEl.className = 'status-tag offline'; }
    };
    feed.src = url;
  }

  function startStream(side) {
    const feed = document.getElementById(`cam-${side}-feed`);
    const placeholder = document.getElementById(`cam-${side}-placeholder`);
    const statusEl = document.getElementById(`cam-${side}-status`);

    if (!feed) return;

    // Stop any existing snapshot polling
    if (state[side].interval) {
      clearInterval(state[side].interval);
      state[side].interval = null;
    }

    state[side].mode = 'stream';
    feed.src = API.streamUrl(side, getQuality(), state[side].annotated);
    feed.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    if (statusEl) { statusEl.textContent = 'Streaming'; statusEl.className = 'status-tag online'; }
  }

  function stopStream(side) {
    const feed = document.getElementById(`cam-${side}-feed`);
    const statusEl = document.getElementById(`cam-${side}-status`);

    if (!feed) return;
    state[side].mode = 'snapshot';
    feed.src = '';
    refreshSnapshot(side);
    if (statusEl) { statusEl.textContent = 'Snapshot'; statusEl.className = 'status-tag pending'; }
  }

  function toggleAnnotation(side) {
    state[side].annotated = !state[side].annotated;
    if (state[side].mode === 'stream') {
      // Restart stream with updated annotated flag
      startStream(side);
    } else {
      refreshSnapshot(side);
    }
    App.toast(state[side].annotated ? 'Edge overlay enabled' : 'Edge overlay disabled', 'info');
  }

  function updateQualityLabel() {
    const el = document.getElementById('cam-quality');
    const val = document.getElementById('cam-quality-val');
    if (el && val) val.textContent = el.value;
  }

  function updateIntervalLabel() {
    const el = document.getElementById('cam-interval');
    const val = document.getElementById('cam-interval-val');
    if (el && val) val.textContent = el.value + 'ms';
  }

  return { render, init, destroy, refreshSnapshot, startStream, stopStream, toggleAnnotation, updateQualityLabel, updateIntervalLabel };
})();
