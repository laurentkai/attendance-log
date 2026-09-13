const { pool } = require('./db/client');

const DESIGN_VERSION = 1;
const MAX_LAYOUT_BYTES = 16 * 1024;
const ELEMENT_NAMES = Object.freeze([
  'qr', 'code', 'title', 'name', 'activity', 'logo', 'disclaimer',
]);
const TEXT_ELEMENTS = new Set(['code', 'title', 'name', 'activity', 'disclaimer']);
const ALIGNABLE_ELEMENTS = new Set(['title', 'name', 'activity', 'disclaimer']);
const ALLOWED_ALIGNMENTS = new Set(['left', 'center', 'right']);
const ALLOWED_ROTATIONS = new Set([-90, 0, 90]);
const MINIMUM_QR_MM = 24;
const MINIMUM_TEXT_ELEMENT_HEIGHT_MM = 2;

function profileSupportsDisclaimer(profile) {
  return (profile.labelHeightMm >= 52 && profile.labelWidthMm >= 80)
    || (profile.labelHeightMm >= 68 && profile.labelWidthMm >= 60);
}

class PrintDesignValidationError extends Error {
  constructor(translationKey, translationParams = {}) {
    super(translationKey);
    this.name = 'PrintDesignValidationError';
    this.code = 'PRINT_DESIGN_INVALID';
    this.translationKey = translationKey;
    this.translationParams = translationParams;
  }
}

function finiteNumber(value, label) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new PrintDesignValidationError('print.design.validation.number', { field: label });
  return Math.round(number * 1000) / 1000;
}

function ownKeysAre(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validateElement(name, raw, profile) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PrintDesignValidationError('print.design.validation.element', { element: name });
  }
  const allowed = new Set(['x', 'y', 'width', 'height', 'enabled']);
  if (TEXT_ELEMENTS.has(name)) allowed.add('fontSize');
  if (ALIGNABLE_ELEMENTS.has(name)) allowed.add('align');
  if (name === 'code') allowed.add('rotation');
  if (!ownKeysAre(raw, allowed)) {
    throw new PrintDesignValidationError('print.design.validation.property', { element: name });
  }

  const element = {
    x: finiteNumber(raw.x, `${name}.x`),
    y: finiteNumber(raw.y, `${name}.y`),
    width: finiteNumber(raw.width, `${name}.width`),
    height: finiteNumber(raw.height, `${name}.height`),
    enabled: raw.enabled !== false,
  };
  const minimumWidth = name === 'qr' ? MINIMUM_QR_MM : name === 'logo' ? 10 : name === 'code' ? 3 : 2;
  const minimumHeight = name === 'qr' ? MINIMUM_QR_MM
    : name === 'logo' ? 5
      : name === 'code' ? 10
        : MINIMUM_TEXT_ELEMENT_HEIGHT_MM;
  if (element.x < 0 || element.y < 0 || element.width < minimumWidth || element.height < minimumHeight
      || element.x + element.width > profile.labelWidthMm + 0.001
      || element.y + element.height > profile.labelHeightMm + 0.001) {
    throw new PrintDesignValidationError('print.design.validation.bounds', { element: name });
  }
  if (name === 'qr' && Math.abs(element.width - element.height) > 0.001) {
    throw new PrintDesignValidationError('print.design.validation.qr_square');
  }
  if (TEXT_ELEMENTS.has(name)) {
    const minimum = name === 'disclaimer' ? 5 : 6;
    const maximum = ['title', 'name'].includes(name) ? 24 : 14;
    element.fontSize = finiteNumber(raw.fontSize, `${name}.fontSize`);
    if (element.fontSize < minimum || element.fontSize > maximum) {
      throw new PrintDesignValidationError('print.design.validation.font_size', { element: name });
    }
  }
  if (ALIGNABLE_ELEMENTS.has(name)) {
    if (!ALLOWED_ALIGNMENTS.has(raw.align)) {
      throw new PrintDesignValidationError('print.design.validation.alignment', { element: name });
    }
    element.align = raw.align;
  }
  if (name === 'code') {
    const rotation = finiteNumber(raw.rotation, 'code.rotation');
    if (!ALLOWED_ROTATIONS.has(rotation)) {
      throw new PrintDesignValidationError('print.design.validation.rotation');
    }
    element.rotation = rotation;
  }
  return element;
}

function validatePrintDesign(profile, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !ownKeysAre(raw, new Set(['version', 'elements']))
      || raw.version !== DESIGN_VERSION
      || !raw.elements || typeof raw.elements !== 'object' || Array.isArray(raw.elements)
      || !ownKeysAre(raw.elements, new Set(ELEMENT_NAMES))
      || ELEMENT_NAMES.some((name) => !Object.hasOwn(raw.elements, name))) {
    throw new PrintDesignValidationError('print.design.validation.layout');
  }
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_LAYOUT_BYTES) {
    throw new PrintDesignValidationError('print.design.validation.size');
  }
  const elements = Object.fromEntries(
    ELEMENT_NAMES.map((name) => [name, Object.freeze(validateElement(name, raw.elements[name], profile))]),
  );
  if (!elements.qr.enabled) throw new PrintDesignValidationError('print.design.validation.qr_visible');
  if (elements.disclaimer.enabled && !profileSupportsDisclaimer(profile)) {
    throw new PrintDesignValidationError('print.design.validation.disclaimer');
  }
  const overlaps = (left, right) => left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
  if (ELEMENT_NAMES.some((name) => name !== 'qr' && elements[name].enabled && overlaps(elements.qr, elements[name]))) {
    throw new PrintDesignValidationError('print.design.validation.qr_overlap');
  }
  return Object.freeze({ version: DESIGN_VERSION, elements: Object.freeze(elements) });
}

async function getSavedPrintDesign(profileReference, client = pool) {
  const result = await client.query(
    'SELECT layout_data FROM avery_print_designs WHERE profile_reference = $1',
    [profileReference],
  );
  return result.rowCount ? result.rows[0].layout_data : null;
}

async function savePrintDesign(profile, design, actorId, client = pool) {
  const validated = validatePrintDesign(profile, design);
  await client.query(
    `INSERT INTO avery_print_designs (profile_reference, layout_data, updated_by_admin_user_id)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (profile_reference) DO UPDATE
       SET layout_data = EXCLUDED.layout_data,
           updated_by_admin_user_id = EXCLUDED.updated_by_admin_user_id,
           updated_at = CURRENT_TIMESTAMP`,
    [profile.reference, JSON.stringify(validated), actorId || null],
  );
  return validated;
}

async function resetPrintDesign(profileReference, client = pool) {
  const result = await client.query(
    'DELETE FROM avery_print_designs WHERE profile_reference = $1',
    [profileReference],
  );
  return result.rowCount > 0;
}

module.exports = {
  DESIGN_VERSION,
  ELEMENT_NAMES,
  MAX_LAYOUT_BYTES,
  MINIMUM_QR_MM,
  MINIMUM_TEXT_ELEMENT_HEIGHT_MM,
  PrintDesignValidationError,
  profileSupportsDisclaimer,
  getSavedPrintDesign,
  resetPrintDesign,
  savePrintDesign,
  validatePrintDesign,
};
