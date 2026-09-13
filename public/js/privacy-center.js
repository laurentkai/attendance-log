window.AttendanceLogI18n.ready.then(() => {
  const t = (key, params) => window.AttendanceLogI18n.t(key, params);
  const drawerElement = document.getElementById('privacy-participant-detail');
  if (!drawerElement || typeof bootstrap === 'undefined') return;

  const drawer = bootstrap.Offcanvas.getOrCreateInstance(drawerElement);
  const fields = Object.fromEntries(
    [...drawerElement.querySelectorAll('[data-privacy-field]')]
      .map((element) => [element.dataset.privacyField, element]),
  );
  const exportLink = drawerElement.querySelector('[data-privacy-export]');
  const anonymizeButton = drawerElement.querySelector('[data-privacy-anonymize]');
  const anonymizationMessage = drawerElement.querySelector('[data-privacy-anonymization-message]');
  const modalElement = document.getElementById('privacy-anonymization-modal');
  const modal = modalElement ? bootstrap.Modal.getOrCreateInstance(modalElement) : null;
  const anonymizationForm = modalElement?.querySelector('[data-privacy-anonymization-form]');
  const anonymizationCounts = Object.fromEntries(
    [...(modalElement?.querySelectorAll('[data-privacy-anonymization-count]') || [])]
      .map((element) => [element.dataset.privacyAnonymizationCount, element]),
  );
  let requestGeneration = 0;

  function setField(name, value) {
    if (fields[name]) fields[name].textContent = value || '—';
  }

  function disableAnonymization(message = t('privacy.anonymization.checking')) {
    if (!anonymizeButton) return;
    anonymizeButton.hidden = false;
    anonymizeButton.disabled = true;
    anonymizeButton.classList.add('disabled');
    anonymizeButton.setAttribute('aria-disabled', 'true');
    delete anonymizeButton.dataset.previewUrl;
    if (anonymizationForm) anonymizationForm.removeAttribute('action');
    if (anonymizationMessage) anonymizationMessage.textContent = message;
  }

  function configureAnonymization(configuration) {
    if (!anonymizeButton) return;
    const alreadyAnonymized = Boolean(configuration?.alreadyAnonymized);
    if (configuration?.eligible && configuration.previewUrl) {
      anonymizeButton.disabled = false;
      anonymizeButton.classList.remove('disabled');
      anonymizeButton.removeAttribute('aria-disabled');
      anonymizeButton.dataset.previewUrl = configuration.previewUrl;
    } else {
      disableAnonymization(configuration?.message || t('privacy.anonymization.unavailable_generic'));
    }
    anonymizeButton.hidden = alreadyAnonymized;
    if (anonymizationMessage) anonymizationMessage.textContent = configuration?.message || t('privacy.anonymization.unavailable_generic');
  }

  async function openDetail(url) {
    const generation = ++requestGeneration;
    drawerElement.setAttribute('aria-busy', 'true');
    Object.keys(fields).forEach((name) => setField(name, t('common.loading')));
    exportLink?.classList.add('disabled');
    exportLink?.setAttribute('aria-disabled', 'true');
    exportLink?.setAttribute('tabindex', '-1');
    exportLink?.removeAttribute('href');
    disableAnonymization();
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
      configureAnonymization(detail.anonymization);
    } catch (_error) {
      if (generation !== requestGeneration) return;
      Object.keys(fields).forEach((name) => setField(name, '—'));
      setField('name', t('status.unavailable'));
    } finally {
      if (generation === requestGeneration) drawerElement.removeAttribute('aria-busy');
    }
  }

  async function openAnonymizationPreview(url) {
    if (!url || !modal || !anonymizationForm) return;
    const generation = requestGeneration;
    disableAnonymization(t('privacy.anonymization.final_check'));
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      const preview = await response.json().catch(() => ({}));
      if (generation !== requestGeneration) return;
      if (!response.ok) {
        disableAnonymization(preview.message || t('privacy.anonymization.no_longer_eligible'));
        return;
      }
      Object.entries(preview.counts || {}).forEach(([name, value]) => {
        if (anonymizationCounts[name]) anonymizationCounts[name].textContent = String(value);
      });
      anonymizationForm.action = preview.actionUrl;
      configureAnonymization({ eligible: true, previewUrl: url, message: t('privacy.anonymization.verified') });
      modal.show();
    } catch (_error) {
      if (generation === requestGeneration) disableAnonymization(t('privacy.anonymization.unavailable'));
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-retention-detail-url]');
    if (trigger) {
      event.preventDefault();
      openDetail(trigger.dataset.retentionDetailUrl);
      return;
    }
    const anonymizationTrigger = event.target.closest('[data-privacy-anonymize]');
    if (!anonymizationTrigger || anonymizationTrigger.disabled) return;
    openAnonymizationPreview(anonymizationTrigger.dataset.previewUrl);
  });
}).catch(() => {});
