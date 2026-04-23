/**
 * status.js — System status overview module
 */

const Status = (() => {
  let pollInterval = null;

  function render() {
    return `
      <div class="page-header">
        <h1 class="page-title">System Status</h1>
        <p class="page-subtitle">Backend health, camera connections, and calibration state</p>
      </div>

      <!-- Health -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">💚</span> System Health</span>
          <span class="card-badge" id="sys-health-badge">Checking...</span>
        </div>
        <div id="sys-status-rows">
          <div class="empty-state">
            <span class="spinner"></span>
            <p class="empty-text mt-md">Connecting to backend...</p>
          </div>
        </div>
      </div>

      <!-- Configuration Overview -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">⚙️</span> Runtime Configuration</span>
          <button class="btn btn-sm btn-secondary" onclick="Status.refreshConfig()">↻ Refresh</button>
        </div>
        <div id="sys-config">
          <div class="empty-state">
            <span class="spinner"></span>
            <p class="empty-text mt-md">Loading configuration...</p>
          </div>
        </div>
      </div>
    `;
  }

  async function init() {
    await refresh();
    await refreshConfig();
    pollInterval = setInterval(refresh, 5000);
  }

  function destroy() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function refresh() {
    const badge = document.getElementById('sys-health-badge');
    const container = document.getElementById('sys-status-rows');
    if (!container) return;

    try {
      const data = await API.status();
      if (badge) { badge.textContent = 'Online'; badge.className = 'card-badge success'; }

      container.innerHTML = `
        <div class="status-row">
          <span class="status-row-label">🟢 System</span>
          <span class="status-tag ${data.running ? 'online' : 'offline'}">${data.running ? 'Running' : 'Stopped'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">📷 Left Camera</span>
          <span class="status-tag ${data.left_camera_connected ? 'online' : 'offline'}">${data.left_camera_connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">📷 Right Camera</span>
          <span class="status-tag ${data.right_camera_connected ? 'online' : 'offline'}">${data.right_camera_connected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">📐 Scale Calibration</span>
          <span class="status-tag ${data.calibration_done ? 'online' : 'pending'}">${data.calibration_done ? 'Done' : 'Needed'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">🔗 Stitch Calibration</span>
          <span class="status-tag ${data.stitch_calibrated ? 'online' : 'pending'}">${data.stitch_calibrated ? 'Calibrated' : 'Not Set'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">🔄 mm/px Ratio</span>
          <span class="status-row-value">${data.mm_per_px !== null ? data.mm_per_px.toFixed(4) + ' mm/px' : 'Not available'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">📏 Stitch Offset</span>
          <span class="status-row-value">${data.stitch_offset !== null ? data.stitch_offset.toFixed(1) + ' px' : 'Not set'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">⏱️ Uptime</span>
          <span class="status-row-value">${formatUptime(data.uptime_seconds)}</span>
        </div>
      `;
    } catch (err) {
      if (badge) { badge.textContent = 'Offline'; badge.className = 'card-badge error'; }
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔌</span>
          <p class="empty-text">Backend offline</p>
          <p class="empty-sub">${err.detail || 'Cannot connect to API server'}</p>
        </div>
      `;
    }
  }

  async function refreshConfig() {
    const container = document.getElementById('sys-config');
    if (!container) return;

    try {
      const cfg = await API.getConfig();
      container.innerHTML = `
        <div class="status-row">
          <span class="status-row-label">Left Camera URL</span>
          <span class="status-row-value text-mono" style="font-size:0.78rem">${cfg.left_src}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Right Camera URL</span>
          <span class="status-row-value text-mono" style="font-size:0.78rem">${cfg.right_src}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Canny Thresholds</span>
          <span class="status-row-value">${cfg.canny_low} / ${cfg.canny_high}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Smooth Window</span>
          <span class="status-row-value">${cfg.smooth_window} frames</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Max Deviation</span>
          <span class="status-row-value">${cfg.max_deviation_px} px</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Perspective</span>
          <span class="status-tag ${cfg.perspective_enabled ? 'online' : 'offline'}">${cfg.perspective_enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Left AOI</span>
          <span class="status-row-value text-mono">${cfg.left_aoi ? `${cfg.left_aoi.x}, ${cfg.left_aoi.y}, ${cfg.left_aoi.w}, ${cfg.left_aoi.h}` : 'Full frame'}</span>
        </div>
        <div class="status-row">
          <span class="status-row-label">Right AOI</span>
          <span class="status-row-value text-mono">${cfg.right_aoi ? `${cfg.right_aoi.x}, ${cfg.right_aoi.y}, ${cfg.right_aoi.w}, ${cfg.right_aoi.h}` : 'Full frame'}</span>
        </div>
      `;
    } catch {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">⚙️</span>
          <p class="empty-text">Cannot load configuration</p>
        </div>
      `;
    }
  }

  function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  return { render, init, destroy, refreshConfig };
})();
