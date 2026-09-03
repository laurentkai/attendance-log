const providerSelect = document.querySelector('[data-backup-provider]');
const frequencySelect = document.querySelector('[data-backup-frequency]');
const weekdayField = document.querySelector('[data-weekday-field]');

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
  const weekly = frequencySelect?.value === 'weekly';
  weekdayField.hidden = !weekly;
  weekdayField.querySelectorAll('select').forEach((control) => {
    control.disabled = !weekly;
  });
}

providerSelect?.addEventListener('change', updateProviderFields);
frequencySelect?.addEventListener('change', updateFrequencyFields);
updateProviderFields();
updateFrequencyFields();
