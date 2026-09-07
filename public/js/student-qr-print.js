const qrPrintForm = document.querySelector('[data-qr-print-form]');

if (qrPrintForm) {
  const modeInputs = [...qrPrintForm.querySelectorAll('input[name="selection_mode"]')];
  const panels = [...qrPrintForm.querySelectorAll('[data-selection-panel]')];
  const classSelect = qrPrintForm.querySelector('[name="class_id"]');
  const activityOption = qrPrintForm.querySelector('[data-activity-option]');
  const activityCheckbox = qrPrintForm.querySelector('[name="include_activity"]');
  const manualSearch = qrPrintForm.querySelector('[data-manual-search]');
  const manualRows = [...qrPrintForm.querySelectorAll('[data-manual-participant]')];
  const manualCheckboxes = [...qrPrintForm.querySelectorAll('[data-manual-checkbox]')];
  const noManualResults = qrPrintForm.querySelector('[data-manual-no-results]');
  const selectAllButton = qrPrintForm.querySelector('[data-select-all]');
  const clearButton = qrPrintForm.querySelector('[data-clear-selection]');
  const selectedCount = qrPrintForm.querySelector('[data-selected-count]');
  const profileSelect = qrPrintForm.querySelector('[data-profile-select]');
  const warningOption = qrPrintForm.querySelector('[data-warning-option]');
  const warningHelp = qrPrintForm.querySelector('[data-warning-help]');
  const firstPosition = qrPrintForm.querySelector('[data-first-position]');
  const dimensions = qrPrintForm.querySelector('[data-profile-dimensions]');
  const capacityOutput = qrPrintForm.querySelector('[data-profile-capacity]');
  const participantOutput = qrPrintForm.querySelector('[data-participant-count]');
  const sheetsOutput = qrPrintForm.querySelector('[data-sheet-count]');

  function currentMode() {
    return modeInputs.find((input) => input.checked)?.value || 'all';
  }

  function currentParticipantCount() {
    if (currentMode() === 'class') {
      return Number.parseInt(classSelect?.selectedOptions[0]?.dataset.count || '0', 10);
    }
    if (currentMode() === 'manual') {
      return manualCheckboxes.filter((checkbox) => checkbox.checked).length;
    }
    return Number.parseInt(qrPrintForm.dataset.activeParticipantCount || '0', 10);
  }

  function updateSummary() {
    const profile = profileSelect?.selectedOptions[0];
    const capacity = Number.parseInt(profile?.dataset.capacity || '0', 10);
    const count = currentParticipantCount();
    const start = Math.min(
      capacity || 1,
      Math.max(1, Number.parseInt(firstPosition?.value || '1', 10) || 1),
    );
    if (firstPosition) {
      firstPosition.max = String(capacity || 1);
      if (Number.parseInt(firstPosition.value, 10) > capacity) firstPosition.value = String(capacity);
    }
    if (dimensions) dimensions.textContent = profile
      ? `${profile.dataset.width} × ${profile.dataset.height} mm`
      : '—';
    if (capacityOutput) capacityOutput.textContent = capacity ? String(capacity) : '—';
    if (participantOutput) participantOutput.textContent = String(count);
    if (selectedCount) selectedCount.textContent = String(manualCheckboxes.filter((checkbox) => checkbox.checked).length);
    if (sheetsOutput) sheetsOutput.textContent = count && capacity
      ? String(Math.ceil(((start - 1) + count) / capacity))
      : '0';
    const warningSupported = profile?.dataset.warningSupported === 'true';
    if (warningOption) {
      warningOption.disabled = !warningSupported;
      if (!warningSupported) warningOption.checked = false;
    }
    if (warningHelp) {
      warningHelp.textContent = warningSupported
        ? 'Option facultative. Le texte est composé à une taille adaptée à l’impression.'
        : 'Ce format est trop petit pour afficher cet avertissement de façon lisible.';
    }
  }

  function updateMode() {
    const mode = currentMode();
    panels.forEach((panel) => {
      const active = panel.dataset.selectionPanel === mode;
      panel.hidden = !active;
      panel.querySelectorAll('input, select, button').forEach((control) => {
        control.disabled = !active;
      });
    });
    if (activityOption) activityOption.hidden = mode !== 'class';
    if (activityCheckbox) activityCheckbox.disabled = mode !== 'class';
    updateSummary();
  }

  function filterManualRows() {
    const query = manualSearch.value.trim().toLocaleLowerCase('fr');
    let visible = 0;
    manualRows.forEach((row) => {
      const matches = row.dataset.search.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    if (noManualResults) noManualResults.hidden = visible > 0;
  }

  modeInputs.forEach((input) => input.addEventListener('change', updateMode));
  classSelect?.addEventListener('change', updateSummary);
  profileSelect?.addEventListener('change', updateSummary);
  firstPosition?.addEventListener('input', updateSummary);
  manualSearch?.addEventListener('input', filterManualRows);
  manualCheckboxes.forEach((checkbox) => checkbox.addEventListener('change', updateSummary));
  selectAllButton?.addEventListener('click', () => {
    manualCheckboxes.forEach((checkbox) => { checkbox.checked = true; });
    updateSummary();
  });
  clearButton?.addEventListener('click', () => {
    manualCheckboxes.forEach((checkbox) => { checkbox.checked = false; });
    updateSummary();
  });

  updateMode();
}
