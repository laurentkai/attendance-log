const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

// Geometry verified against Avery's official A4 Word templates. The templates
// are the source of truth for margins and pitch; product pages confirm label
// dimensions and labels per sheet.
const AVERY_PROFILES = Object.freeze({
  L7160: Object.freeze({
    reference: 'L7160',
    manufacturer: 'Avery',
    category: 'Étiquettes adresse',
    description: '63,5 × 38,1 mm — 21 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    columns: 3,
    rows: 7,
    leftMarginMm: 7.21,
    topMarginMm: 15.15,
    horizontalPitchMm: 66.04,
    verticalPitchMm: 38.1,
    sourceUrl: 'https://www.avery.co.uk/template-l7160',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L7160_WordTemplate.doc',
  }),
  L7162: Object.freeze({
    reference: 'L7162',
    manufacturer: 'Avery',
    category: 'Étiquettes adresse',
    description: '99,06 × 33,87 mm — 16 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 99.06,
    labelHeightMm: 33.87,
    columns: 2,
    rows: 8,
    leftMarginMm: 4.67,
    topMarginMm: 13.05,
    horizontalPitchMm: 101.6,
    verticalPitchMm: 33.87,
    sourceUrl: 'https://www.avery.co.uk/template-l7162',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L7162_WordTemplate.doc',
  }),
  L7163: Object.freeze({
    reference: 'L7163',
    manufacturer: 'Avery',
    category: 'Étiquettes adresse',
    description: '99,06 × 38,1 mm — 14 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 99.06,
    labelHeightMm: 38.1,
    columns: 2,
    rows: 7,
    leftMarginMm: 4.67,
    topMarginMm: 15.15,
    horizontalPitchMm: 101.6,
    verticalPitchMm: 38.1,
    sourceUrl: 'https://www.avery.co.uk/template-l7163',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L7163_WordTemplate.doc',
  }),
  L7164: Object.freeze({
    reference: 'L7164',
    manufacturer: 'Avery',
    category: 'Étiquettes grand format',
    description: '63,5 × 71,967 mm — 12 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 63.5,
    labelHeightMm: 71.967,
    columns: 3,
    rows: 4,
    leftMarginMm: 7.21,
    topMarginMm: 4.566,
    horizontalPitchMm: 66.04,
    verticalPitchMm: 71.967,
    sourceUrl: 'https://www.avery.co.uk/template-l7164',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L7164_Word_Template.doc',
  }),
  L7165: Object.freeze({
    reference: 'L7165',
    manufacturer: 'Avery',
    category: 'Étiquettes grand format',
    description: '99,06 × 67,73 mm — 8 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 99.06,
    labelHeightMm: 67.73,
    columns: 2,
    rows: 4,
    leftMarginMm: 4.67,
    topMarginMm: 13,
    horizontalPitchMm: 101.6,
    verticalPitchMm: 67.73,
    sourceUrl: 'https://www.avery.co.uk/template-l7165',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L7165_WordTemplate.docx',
  }),
  L4728: Object.freeze({
    reference: 'L4728',
    manufacturer: 'Avery',
    category: 'Inserts pour badges',
    description: '90 × 60 mm — 8 par feuille',
    compatibleReferences: Object.freeze(['4822', '4823', '4825', '4831']),
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 90,
    labelHeightMm: 60,
    columns: 2,
    rows: 4,
    leftMarginMm: 12.206,
    topMarginMm: 28.487,
    horizontalPitchMm: 100,
    verticalPitchMm: 60,
    sourceUrl: 'https://www.avery.fr/modele-l4728',
    templateUrl: 'https://www.avery.fr/sites/avery.fr/files/avery_importer/template/files/Avery_L4728_Modele_Word.doc',
  }),
  L4785: Object.freeze({
    reference: 'L4785',
    manufacturer: 'Avery',
    category: 'Badges nominatifs autocollants textile',
    description: '80 × 50 mm — 10 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 80,
    labelHeightMm: 50,
    columns: 2,
    rows: 5,
    leftMarginMm: 19.703,
    topMarginMm: 13.423,
    horizontalPitchMm: 95,
    verticalPitchMm: 55,
    sourceUrl: 'https://www.avery.co.uk/template-l4785',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L4785_WordTemplate.doc',
  }),
  L7418: Object.freeze({
    reference: 'L7418',
    manufacturer: 'Avery',
    category: 'Badges nominatifs',
    description: '86 × 55 mm — 8 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 86,
    labelHeightMm: 55,
    columns: 2,
    rows: 4,
    leftMarginMm: 19,
    topMarginMm: 38.5,
    horizontalPitchMm: 86,
    verticalPitchMm: 55,
    sourceUrl: 'https://www.avery.co.uk/template-l7418',
    templateUrl: 'https://www.avery.co.uk/sites/avery.co.uk/files/avery_importer/template/files/Avery_L7418_Word_Template.doc',
  }),
  L7427: Object.freeze({
    reference: 'L7427',
    manufacturer: 'Avery',
    category: 'Badges nominatifs textile',
    description: '88 × 52 mm — 10 par feuille',
    pageWidthMm: A4_WIDTH_MM,
    pageHeightMm: A4_HEIGHT_MM,
    labelWidthMm: 88,
    labelHeightMm: 52,
    columns: 2,
    rows: 5,
    leftMarginMm: 10.708,
    topMarginMm: 3.7,
    horizontalPitchMm: 104,
    verticalPitchMm: 59.4,
    sourceUrl: 'https://www.averyproducts.com.au/word-template-l7427',
    templateUrl: 'https://www.averyproducts.com.au/sites/avery.au/files/avery_importer/template/files/Avery_L7427_WordTemplate.docx',
  }),
});

function getAveryProfile(reference) {
  if (typeof reference !== 'string') return null;
  const normalizedReference = reference.toUpperCase();
  return AVERY_PROFILES[normalizedReference]
    || Object.values(AVERY_PROFILES).find(
      (profile) => profile.compatibleReferences?.includes(normalizedReference),
    )
    || null;
}

function getLabelsPerSheet(profile) {
  return profile.rows * profile.columns;
}

function getLabelBoxMm(profile, zeroBasedPosition) {
  const capacity = getLabelsPerSheet(profile);
  if (!Number.isInteger(zeroBasedPosition) || zeroBasedPosition < 0 || zeroBasedPosition >= capacity) {
    throw new RangeError('Label position is outside the selected Avery profile');
  }

  const row = Math.floor(zeroBasedPosition / profile.columns);
  const column = zeroBasedPosition % profile.columns;
  return Object.freeze({
    position: zeroBasedPosition + 1,
    row,
    column,
    x: profile.leftMarginMm + (column * profile.horizontalPitchMm),
    y: profile.topMarginMm + (row * profile.verticalPitchMm),
    width: profile.labelWidthMm,
    height: profile.labelHeightMm,
  });
}

function validateAveryProfile(profile) {
  if (!profile || profile.pageWidthMm !== A4_WIDTH_MM || profile.pageHeightMm !== A4_HEIGHT_MM) {
    throw new Error('Avery profile must use an exact A4 page');
  }
  const boxes = Array.from(
    { length: getLabelsPerSheet(profile) },
    (_value, position) => getLabelBoxMm(profile, position),
  );
  const last = boxes.at(-1);
  const tolerance = 0.001;
  if (boxes[0].x < -tolerance || boxes[0].y < -tolerance
      || last.x + last.width > profile.pageWidthMm + tolerance
      || last.y + last.height > profile.pageHeightMm + tolerance) {
    throw new Error(`Avery profile ${profile.reference} exceeds its A4 page`);
  }
  return boxes;
}

Object.values(AVERY_PROFILES).forEach(validateAveryProfile);

module.exports = {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  AVERY_PROFILES,
  getAveryProfile,
  getLabelBoxMm,
  getLabelsPerSheet,
  validateAveryProfile,
};
