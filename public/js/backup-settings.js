const providerSelect = document.querySelector('[data-backup-provider]');
const enabledToggle = document.querySelector('[data-backup-enabled]');
const scheduleControls = document.querySelector('[data-backup-schedule-controls]');
const frequencySelect = document.querySelector('[data-backup-frequency]');
const weekdayField = document.querySelector('[data-weekday-field]');
const scheduleInputs = scheduleControls
  ? [...scheduleControls.querySelectorAll('input, select')]
  : [];

function updateProviderFields() {
  document.querySelectorAll('[data-provider-fields]').forEach((fieldset) => {
    const active = fieldset.dataset.providerFields === providerSelect?.value;
    fieldset.hidden = !active;
    fieldset.querySelectorAll('input, select').forEach((control) => {
      control.disabled = !active;
    });
  });
}

function updateFrequencyFields() {
  if (!weekdayField) return;
  const weekly = Boolean(enabledToggle?.checked) && frequencySelect?.value === 'weekly';
  weekdayField.hidden = !weekly;
  weekdayField.querySelectorAll('select').forEach((control) => {
    control.disabled = !weekly;
  });
}

function updateScheduleFields() {
  if (!enabledToggle || !scheduleControls) return;
  const enabled = enabledToggle.checked;
  scheduleControls.classList.toggle('is-disabled', !enabled);
  scheduleControls.setAttribute('aria-disabled', String(!enabled));

  scheduleInputs.forEach((control) => {
    if (!enabled) {
      if (!control.disabled && control.value) control.dataset.savedValue = control.value;
      control.value = '';
      control.disabled = true;
      return;
    }
    control.disabled = false;
    if (!control.value) control.value = control.dataset.savedValue || '';
  });
  updateFrequencyFields();
}

providerSelect?.addEventListener('change', updateProviderFields);
frequencySelect?.addEventListener('change', updateFrequencyFields);
enabledToggle?.addEventListener('change', updateScheduleFields);
updateProviderFields();
updateScheduleFields();
