/**
 * BookWorm PWA Controller
 * Handles Service Worker lifecycle, install prompts, and connectivity monitoring
 */

export const PWA = {
  deferredPrompt: null,
  isInstalled: false,

  init() {
    this.registerServiceWorker();
    this.setupInstallPrompt();
    this.setupNetworkMonitor();
    this.checkStandaloneMode();
  },

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);

            // Listen for waiting worker (update available)
            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  this.showUpdateBanner();
                }
              });
            });
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }
  },

  setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent browser default mini-infobar
      e.preventDefault();
      this.deferredPrompt = e;

      // Show in-app install buttons
      const installBtn = document.getElementById('btnInstallApp');
      const installBanner = document.getElementById('pwaInstallBanner');
      if (installBtn) installBtn.classList.remove('hidden');
      if (installBanner) installBanner.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.deferredPrompt = null;
      console.log('[PWA] BookWorm installed successfully');

      const installBtn = document.getElementById('btnInstallApp');
      const installBanner = document.getElementById('pwaInstallBanner');
      if (installBtn) installBtn.classList.add('hidden');
      if (installBanner) installBanner.classList.add('hidden');

      if (window.app && window.app.toast) {
        window.app.toast('BookWorm app installed to your device!', 'success');
      }
    });
  },

  async promptInstall() {
    if (!this.deferredPrompt) {
      if (window.app && window.app.toast) {
        window.app.toast('App is already installed or your browser does not support installation.', 'info');
      }
      return;
    }

    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log('[PWA] Install prompt outcome:', outcome);
    this.deferredPrompt = null;

    const installBtn = document.getElementById('btnInstallApp');
    const installBanner = document.getElementById('pwaInstallBanner');
    if (installBtn) installBtn.classList.add('hidden');
    if (installBanner) installBanner.classList.add('hidden');
  },

  dismissInstallBanner() {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.classList.add('hidden');
    sessionStorage.setItem('dismissed_install_banner', 'true');
  },

  setupNetworkMonitor() {
    const updateStatus = () => {
      const isOnline = navigator.onLine;
      const offlineBar = document.getElementById('offlineNoticeBar');

      if (!isOnline) {
        if (offlineBar) offlineBar.classList.remove('hidden');
        if (window.app && window.app.toast) {
          window.app.toast('You are offline. Showing cached bookshelf.', 'error');
        }
      } else {
        if (offlineBar) offlineBar.classList.add('hidden');
        if (window.app && window.app.toast) {
          window.app.toast('Back online! Syncing latest reviews...', 'success');
        }
        // Auto sync queued offline reviews
        if (window.app && window.app.syncOfflineQueue) {
          window.app.syncOfflineQueue();
        }
      }
    };

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    // Initial check
    if (!navigator.onLine) {
      const offlineBar = document.getElementById('offlineNoticeBar');
      if (offlineBar) offlineBar.classList.remove('hidden');
    }
  },

  checkStandaloneMode() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone ||
                         document.referrer.includes('android-app://');

    if (isStandalone) {
      this.isInstalled = true;
      const installBtn = document.getElementById('btnInstallApp');
      if (installBtn) installBtn.classList.add('hidden');
    }
  },

  showUpdateBanner() {
    const banner = document.createElement('div');
    banner.className = 'fixed top-16 left-1/2 transform -translate-x-1/2 z-50 bg-stone-900 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-stone-700 text-xs font-semibold';
    banner.innerHTML = `
      <i class="fa-solid fa-arrows-rotate text-amber-400"></i>
      <span>A new version of BookWorm is available!</span>
      <button onclick="window.location.reload()" class="ml-2 px-3 py-1 bg-brand-500 rounded-lg hover:bg-brand-600 font-bold">Update</button>
    `;
    document.body.appendChild(banner);
  }
};
