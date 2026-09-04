(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => {
      // PWA support is progressive enhancement and must never block the application.
    });
  }, { once: true });
})();
