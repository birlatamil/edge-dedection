/**
 * dashboard.js — Real-time measurement dashboard module
 */

const Dashboard = (() => {
  let sseSource = null;
  let trendData = [];
  const MAX_TREND_POINTS = 100;
  let trendCanvas = null;
  let trendCtx = null;

  function render() {
    return `
      <div class="page-header">
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Real-time fabric width measurement</p>
      </div>

      <!-- Main gauge -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">📏</span> Live Measurement</span>
          <span class="card-badge" id="dash-connection-badge">Connecting...</span>
        </div>
        <div class="gauge-container">
          <div>
            <span class="gauge-value" id="dash-width-value">—</span>
            <span class="gauge-unit" id="dash-width-unit">mm</span>
          </div>
          <div class="gauge-bar">
            <div class="gauge-fill" id="dash-gauge-fill" style="width: 50%"></div>
          </div>
          <div class="gauge-labels">
            <span>0</span>
            <span id="dash-gauge-max">2000 mm</span>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div class="grid-4" id="dash-stats">
        <div class="stat-card">
          <div class="stat-label">Left Edge</div>
          <div class="stat-value" id="dash-left-edge">—</div>
          <div class="stat-sub">px</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Right Edge</div>
          <div class="stat-value" id="dash-right-edge">—</div>
          <div class="stat-sub">px</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Raw Width</div>
          <div class="stat-value" id="dash-raw-width">—</div>
          <div class="stat-sub">px</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Stable Width</div>
          <div class="stat-value accent" id="dash-stable-width">—</div>
          <div class="stat-sub">px</div>
        </div>
      </div>

      <!-- Trend -->
      <div class="card mt-lg">
        <div class="card-header">
          <span class="card-title"><span class="card-icon">📈</span> Width Trend</span>
          <span class="card-badge" id="dash-trend-count">0 samples</span>
        </div>
        <div class="trend-container">
          <canvas class="trend-canvas" id="dash-trend-canvas"></canvas>
        </div>
      </div>
    `;
  }

  function init() {
    trendData = [];
    setupCanvas();
    startSSE();
  }

  function destroy() {
    if (sseSource) {
      sseSource.close();
      sseSource = null;
    }
  }

  function setupCanvas() {
    trendCanvas = document.getElementById('dash-trend-canvas');
    if (!trendCanvas) return;
    trendCtx = trendCanvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!trendCanvas) return;
    const rect = trendCanvas.parentElement.getBoundingClientRect();
    trendCanvas.width = rect.width * window.devicePixelRatio;
    trendCanvas.height = rect.height * window.devicePixelRatio;
    trendCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    drawTrend();
  }

  function startSSE() {
    const badge = document.getElementById('dash-connection-badge');

    // Try SSE first, fall back to polling
    try {
      sseSource = new EventSource(API.measurementStreamUrl());

      sseSource.onopen = () => {
        if (badge) { badge.textContent = 'Live'; badge.className = 'card-badge success'; }
      };

      sseSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        updateDisplay(data);
      };

      sseSource.onerror = () => {
        if (badge) { badge.textContent = 'Reconnecting...'; badge.className = 'card-badge warning'; }
        // SSE will auto-reconnect
      };
    } catch {
      // Fallback: polling
      if (badge) { badge.textContent = 'Polling'; badge.className = 'card-badge'; }
      pollMeasurement();
    }
  }

  async function pollMeasurement() {
    while (true) {
      try {
        const data = await API.measurement();
        updateDisplay(data);
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  function updateDisplay(data) {
    const widthVal = document.getElementById('dash-width-value');
    const widthUnit = document.getElementById('dash-width-unit');
    const gaugeFill = document.getElementById('dash-gauge-fill');
    const leftEdge = document.getElementById('dash-left-edge');
    const rightEdge = document.getElementById('dash-right-edge');
    const rawWidth = document.getElementById('dash-raw-width');
    const stableWidth = document.getElementById('dash-stable-width');
    const trendCount = document.getElementById('dash-trend-count');

    if (data.width_mm !== null && data.width_mm !== undefined) {
      if (widthVal) widthVal.textContent = data.width_mm.toFixed(1);
      if (widthUnit) widthUnit.textContent = 'mm';
    } else {
      if (widthVal) widthVal.textContent = data.stable_width_px.toFixed(1);
      if (widthUnit) widthUnit.textContent = 'px';
    }

    if (leftEdge) leftEdge.textContent = data.left_edge_px.toFixed(1);
    if (rightEdge) rightEdge.textContent = data.right_edge_px.toFixed(1);
    if (rawWidth) rawWidth.textContent = data.raw_width_px.toFixed(1);
    if (stableWidth) stableWidth.textContent = data.stable_width_px.toFixed(1);

    // Gauge fill (assume max 2000mm or 2000px)
    const maxVal = data.width_mm !== null ? 2000 : 2000;
    const displayVal = data.width_mm !== null ? data.width_mm : data.stable_width_px;
    const pct = Math.min(100, Math.max(0, (displayVal / maxVal) * 100));
    if (gaugeFill) gaugeFill.style.width = pct + '%';

    // Trend
    trendData.push(displayVal);
    if (trendData.length > MAX_TREND_POINTS) trendData.shift();
    if (trendCount) trendCount.textContent = `${trendData.length} samples`;
    drawTrend();
  }

  function drawTrend() {
    if (!trendCtx || !trendCanvas || trendData.length < 2) return;

    const w = trendCanvas.width / window.devicePixelRatio;
    const h = trendCanvas.height / window.devicePixelRatio;
    const padding = { top: 10, right: 10, bottom: 10, left: 10 };

    trendCtx.clearRect(0, 0, w, h);

    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    const min = Math.min(...trendData) * 0.995;
    const max = Math.max(...trendData) * 1.005;
    const range = max - min || 1;

    // Grid lines
    trendCtx.strokeStyle = '#F0EEEB';
    trendCtx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padding.top + (plotH / 3) * i;
      trendCtx.beginPath();
      trendCtx.moveTo(padding.left, y);
      trendCtx.lineTo(w - padding.right, y);
      trendCtx.stroke();
    }

    // Fill gradient
    const gradient = trendCtx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
    gradient.addColorStop(0, 'rgba(42, 157, 143, 0.12)');
    gradient.addColorStop(1, 'rgba(42, 157, 143, 0.0)');

    trendCtx.beginPath();
    trendData.forEach((val, i) => {
      const x = padding.left + (i / (trendData.length - 1)) * plotW;
      const y = padding.top + plotH - ((val - min) / range) * plotH;
      if (i === 0) trendCtx.moveTo(x, y);
      else trendCtx.lineTo(x, y);
    });
    const lastX = padding.left + plotW;
    trendCtx.lineTo(lastX, h - padding.bottom);
    trendCtx.lineTo(padding.left, h - padding.bottom);
    trendCtx.closePath();
    trendCtx.fillStyle = gradient;
    trendCtx.fill();

    // Line
    trendCtx.beginPath();
    trendData.forEach((val, i) => {
      const x = padding.left + (i / (trendData.length - 1)) * plotW;
      const y = padding.top + plotH - ((val - min) / range) * plotH;
      if (i === 0) trendCtx.moveTo(x, y);
      else trendCtx.lineTo(x, y);
    });
    trendCtx.strokeStyle = '#2A9D8F';
    trendCtx.lineWidth = 2;
    trendCtx.lineJoin = 'round';
    trendCtx.stroke();

    // Latest point dot
    const lastVal = trendData[trendData.length - 1];
    const lx = padding.left + plotW;
    const ly = padding.top + plotH - ((lastVal - min) / range) * plotH;
    trendCtx.beginPath();
    trendCtx.arc(lx, ly, 4, 0, Math.PI * 2);
    trendCtx.fillStyle = '#2A9D8F';
    trendCtx.fill();
    trendCtx.strokeStyle = '#fff';
    trendCtx.lineWidth = 2;
    trendCtx.stroke();
  }

  return { render, init, destroy };
})();
