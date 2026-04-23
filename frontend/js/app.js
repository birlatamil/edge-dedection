/**
 * app.js — Main application controller
 * Handles routing, module lifecycle, and global utilities.
 */

const App = (() => {
  const modules = {
    dashboard: Dashboard,
    cameras: Cameras,
    settings: Settings,
    calibration: Calibration,
    status: Status,
  };

  let currentModule = null;
  let currentModuleName = null;

  function init() {
    // Load saved API URL
    const savedUrl = localStorage.getItem('api_base_url');
    if (savedUrl) API.setBaseUrl(savedUrl);

    // Set initial page
    const hash = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(hash);

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      const page = window.location.hash.replace('#', '') || 'dashboard';
      navigateTo(page);
    });

    // Sidebar navigation
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.getAttribute('data-page');
        window.location.hash = page;
      });
    });

    // Mobile menu
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        document.querySelector('.sidebar').classList.toggle('open');
      });
    }

    // API URL config
    const urlInput = document.getElementById('api-url-input');
    if (urlInput) {
      urlInput.value = API.getBaseUrl();
      urlInput.addEventListener('change', () => {
        API.setBaseUrl(urlInput.value);
        localStorage.setItem('api_base_url', urlInput.value);
        toast('API URL updated — reloading module', 'info');
        navigateTo(currentModuleName);
      });
    }

    // Start connection status polling
    pollConnectionStatus();
  }

  function navigateTo(pageName) {
    // Destroy current module
    if (currentModule && currentModule.destroy) {
      currentModule.destroy();
    }

    const mod = modules[pageName];
    if (!mod) {
      navigateTo('dashboard');
      return;
    }

    currentModuleName = pageName;
    currentModule = mod;

    // Update sidebar active state
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-page') === pageName);
    });

    // Render module content
    const container = document.getElementById('page-content');
    if (container) {
      container.innerHTML = mod.render();
      // Add active class for animation
      const moduleEl = container.querySelector('.page-header')?.parentElement;
      if (moduleEl) moduleEl.classList.add('active');
    }

    // Initialize module
    if (mod.init) mod.init();

    // Close mobile sidebar
    document.querySelector('.sidebar')?.classList.remove('open');
  }

  async function pollConnectionStatus() {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');

    while (true) {
      try {
        await API.health();
        if (dot) dot.classList.add('connected');
        if (text) text.textContent = 'Backend connected';
      } catch {
        if (dot) dot.classList.remove('connected');
        if (text) text.textContent = 'Backend offline';
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // ── Toast Notifications ─────────────────────────────────────

  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(30px)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  return { init, navigateTo, toast };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);
