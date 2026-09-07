(() => {
  const drawer = document.querySelector('#audit-detail');
  if (!drawer || typeof bootstrap === 'undefined') return;
  const instance = bootstrap.Offcanvas.getOrCreateInstance(drawer);
  const fields = Object.fromEntries([...drawer.querySelectorAll('[data-audit-field]')].map((element) => [element.dataset.auditField, element]));
  const changes = drawer.querySelector('[data-audit-changes]');
  const metadata = drawer.querySelector('[data-audit-metadata]');

  function setText(field, value) {
    if (fields[field]) fields[field].textContent = value || '—';
  }

  async function openDetail(trigger) {
    if (trigger.getAttribute('aria-busy') === 'true') return;
    trigger.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(trigger.dataset.auditDetailUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('DETAIL_UNAVAILABLE');
      const detail = await response.json();
      for (const [field, value] of Object.entries(detail.fields)) setText(field, value);
      changes.replaceChildren();
      if (detail.changes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'text-body-secondary mb-0';
        empty.textContent = 'Aucune modification de champ enregistrée.';
        changes.append(empty);
      } else {
        const list = document.createElement('dl');
        list.className = 'audit-change-list mb-0';
        for (const change of detail.changes) {
          const term = document.createElement('dt');
          term.textContent = change.label;
          const description = document.createElement('dd');
          description.textContent = `${change.before} → ${change.after}`;
          list.append(term, description);
        }
        changes.append(list);
      }
      metadata.replaceChildren();
      for (const entry of detail.metadata) {
        const item = document.createElement('li');
        item.textContent = `${entry.label} : ${entry.value}`;
        metadata.append(item);
      }
      if (detail.metadata.length === 0) {
        const item = document.createElement('li');
        item.className = 'text-body-secondary';
        item.textContent = 'Aucune information complémentaire.';
        metadata.append(item);
      }
      instance.show();
    } catch (_error) {
      setText('timestamp', '—');
      setText('actor', '—');
      setText('role', '—');
      setText('action', 'Détail indisponible');
      setText('target', '—');
      setText('result', 'Échec');
      setText('summary', 'Impossible de charger le détail pour le moment.');
      setText('ipHash', '—');
      setText('userAgentHash', '—');
      changes.replaceChildren();
      metadata.replaceChildren();
      instance.show();
    } finally {
      trigger.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-audit-detail-url]');
    if (trigger) openDetail(trigger);
  });
})();
