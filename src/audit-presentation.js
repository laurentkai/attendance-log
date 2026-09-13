const { DEFAULT_LANGUAGE, t } = require('./i18n');
const { getTerm } = require('./terminology');

function terminologyParams(language, terminology) {
  return {
    student: getTerm(language, 'student', 'singular', terminology),
    students: getTerm(language, 'student', 'plural', terminology),
    class: getTerm(language, 'class', 'singular', terminology),
    classes: getTerm(language, 'class', 'plural', terminology),
    session: getTerm(language, 'session', 'singular', terminology),
    sessions: getTerm(language, 'session', 'plural', terminology),
    attendance: getTerm(language, 'attendance', 'singular', terminology),
    membership: getTerm(language, 'membership', 'singular', terminology),
    instructor: getTerm(language, 'instructor', 'singular', terminology),
  };
}

function auditFieldLabel(field, language = DEFAULT_LANGUAGE, terminology) {
  try { return t(language, `audit.field.${field}`, terminologyParams(language, terminology)); } catch (_error) { return String(field).replaceAll('_', ' '); }
}

function displayAuditValue(value, language = DEFAULT_LANGUAGE, terminology) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return t(language, value ? 'common.yes' : 'common.no');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${auditFieldLabel(key, language, terminology)}: ${displayAuditValue(item, language, terminology)}`)
      .join(', ');
  }
  if (typeof value === 'string') {
    if (['active', 'inactive', 'present', 'absent', 'pending', 'open', 'closed', 'scheduled', 'success', 'failed', 'denied', 'anonymized'].includes(value)) {
      return t(language, `status.${value}`);
    }
    if (['en', 'fr'].includes(value)) return t(language, `language.${value}`);
    if (['administrator', 'manager', 'attendance_operator'].includes(value)) return t(language, `role.${value}`);
    return value;
  }
  return String(value);
}

function auditCategoryLabel(category, language = DEFAULT_LANGUAGE, terminology) {
  try { return t(language, `audit.category.${category}`, terminologyParams(language, terminology)); } catch (_error) { return String(category); }
}

function auditResultLabel(result, language = DEFAULT_LANGUAGE) {
  try { return t(language, `status.${result}`); } catch (_error) { return String(result); }
}

function auditActionLabel(action, language = DEFAULT_LANGUAGE, terminology) {
  try { return t(language, `audit.action.${action}`, terminologyParams(language, terminology)); } catch (_error) {
    return String(action).split('.').map((part) => part.replaceAll('_', ' ')).join(' · ');
  }
}

function auditSummaryLabel(row, language = DEFAULT_LANGUAGE, terminology) {
  try { return t(language, `audit.action.${row.action}`, terminologyParams(language, terminology)); } catch (_error) { return row.summary || ''; }
}

function auditChanges(row, language = DEFAULT_LANGUAGE, terminology) {
  const before = row.before_data || {};
  const after = row.after_data || {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((field) => ({
    field,
    label: auditFieldLabel(field, language, terminology),
    before: displayAuditValue(before[field], language, terminology),
    after: displayAuditValue(after[field], language, terminology),
  })).filter((change) => change.before !== change.after);
}

module.exports = {
  auditActionLabel,
  auditCategoryLabel,
  auditChanges,
  auditFieldLabel,
  auditResultLabel,
  auditSummaryLabel,
  displayAuditValue,
};
