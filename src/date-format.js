const frenchDateFormatter = new Intl.DateTimeFormat('fr-BE', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

function formatDateForInput(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
}

function formatDateForDisplay(value) {
  const dateValue = formatDateForInput(value);
  return dateValue
    ? frenchDateFormatter.format(new Date(`${dateValue}T00:00:00Z`))
    : '';
}

module.exports = { formatDateForDisplay, formatDateForInput };
