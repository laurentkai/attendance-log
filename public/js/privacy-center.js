(() => {
  const drawerElement = document.getElementById('privacy-participant-detail');
  if (!drawerElement || typeof bootstrap === 'undefined') return;

  const drawer = bootstrap.Offcanvas.getOrCreateInstance(drawerElement);
  const fields = Object.fromEntries(
    [...drawerElement.querySelectorAll('[data-privacy-field]')]
      .map((element) => [element.dataset.privacyField, element]),
  );
  const exportLink = drawerElement.querySelector('[data-privacy-export]');
  let requestGeneration = 0;

  function setField(name, value) {
    if (fields[name]) fields[name].textContent = value || '—';
  }

  async function openDetail(url) {
    const generation = ++requestGeneration;
    drawerElement.setAttribute('aria-busy', 'true');
    Object.keys(fields).forEach((name) => setField(name, 'Chargement…'));
    exportLink?.classList.add('disabled');
    exportLink?.setAttribute('aria-disabled', 'true');
    exportLink?.setAttribute('tabindex', '-1');
    exportLink?.removeAttribute('href');
    drawer.show();
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('DETAIL_UNAVAILABLE');
      const detail = await response.json();
      if (generation !== requestGeneration) return;
      Object.entries(detail.fields).forEach(([name, value]) => setField(name, value));
      if (exportLink) {
        exportLink.href = detail.exportUrl;
        exportLink.classList.remove('disabled');
        exportLink.removeAttribute('aria-disabled');
        exportLink.removeAttribute('tabindex');
      }
    } catch (_error) {
      if (generation !== requestGeneration) return;
      Object.keys(fields).forEach((name) => setField(name, '—'));
      setField('name', 'Détails indisponibles');
    } finally {
      if (generation === requestGeneration) drawerElement.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-retention-detail-url]');
    if (!trigger) return;
    event.preventDefault();
    openDetail(trigger.dataset.retentionDetailUrl);
  });
})();
