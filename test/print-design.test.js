const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const { AVERY_PROFILES } = require('../src/avery-profiles');
const {
  canIncludeQrWarning,
  createDefaultPrintDesign,
} = require('../src/student-qr-label-pdf');
const {
  MINIMUM_TEXT_ELEMENT_HEIGHT_MM,
  PrintDesignValidationError,
  validatePrintDesign,
} = require('../src/print-design');

function validBalancedDesign() {
  return {
    version: 1,
    elements: {
      qr: { x: 8, y: 4, width: 24, height: 24, enabled: true },
      code: { x: 1, y: 4, width: 4, height: 30, enabled: true, fontSize: 7, rotation: -90 },
      title: { x: 34, y: 4, width: 30, height: 6, enabled: true, fontSize: 12, align: 'left' },
      name: { x: 8, y: 31, width: 74, height: 7, enabled: true, fontSize: 12, align: 'center' },
      activity: { x: 8, y: 39, width: 74, height: 4, enabled: true, fontSize: 8, align: 'center' },
      logo: { x: 66, y: 4, width: 16, height: 12, enabled: true },
      disclaimer: { x: 8, y: 48, width: 74, height: 8, enabled: true, fontSize: 5, align: 'center' },
    },
  };
}

function validWideDesign() {
  return {
    version: 1,
    elements: {
      qr: { x: 8, y: 7, width: 24, height: 24, enabled: true },
      code: { x: 1, y: 4, width: 4, height: 30, enabled: true, fontSize: 7, rotation: -90 },
      title: { x: 34, y: 3, width: 27, height: 5, enabled: true, fontSize: 10, align: 'left' },
      name: { x: 34, y: 10, width: 27, height: 5, enabled: true, fontSize: 10, align: 'left' },
      activity: { x: 34, y: 16, width: 27, height: 4, enabled: true, fontSize: 7, align: 'left' },
      logo: { x: 34, y: 21, width: 10, height: 5, enabled: true },
      disclaimer: { x: 34, y: 28, width: 27, height: 5, enabled: false, fontSize: 5, align: 'left' },
    },
  };
}

function invalid(mutator, design = validBalancedDesign(), profile = AVERY_PROFILES.L4728) {
  mutator(design.elements, design);
  assert.throws(() => validatePrintDesign(profile, design), PrintDesignValidationError);
}

test('a valid design is accepted and normalized', () => {
  const result = validatePrintDesign(AVERY_PROFILES.L4728, validBalancedDesign());
  assert.equal(result.elements.qr.width, 24);
  assert.equal(result.elements.disclaimer.enabled, true);
});

test('QR minimum, square, visibility, bounds, and collision rules are enforced', () => {
  invalid((elements) => { elements.qr.width = 23.999; elements.qr.height = 23.999; });
  invalid((elements) => { elements.qr.width = 25; });
  invalid((elements) => { elements.qr.enabled = false; });
  invalid((elements) => { elements.name.x = 89; });
  invalid((elements) => { elements.title.x = 10; elements.title.y = 5; });
});

test('arbitrary properties and invalid participant-code rotations are rejected', () => {
  invalid((elements) => { elements.title.html = '<b>unsafe</b>'; });
  invalid((elements) => { elements.code.rotation = 45; });
});

test('unsupported disclaimers are rejected even when geometrically contained', () => {
  const design = validWideDesign();
  design.elements.disclaimer.enabled = true;
  assert.throws(() => validatePrintDesign(AVERY_PROFILES.L7160, design), PrintDesignValidationError);
});

test('minimum text-element height uses the authoritative shared constant', () => {
  const accepted = validBalancedDesign();
  accepted.elements.activity.height = MINIMUM_TEXT_ELEMENT_HEIGHT_MM;
  assert.doesNotThrow(() => validatePrintDesign(AVERY_PROFILES.L4728, accepted));
  invalid((elements) => { elements.activity.height = MINIMUM_TEXT_ELEMENT_HEIGHT_MM - 0.001; });
});

test('every default Avery layout validates across title, activity, and warning options', () => {
  let combinations = 0;
  for (const profile of Object.values(AVERY_PROFILES)) {
    for (const hasTitle of [false, true]) {
      for (const hasActivity of [false, true]) {
        for (const includeWarning of [false, true]) {
          combinations += 1;
          const options = {
            title: hasTitle ? 'Carte étudiant 2027' : '',
            activityName: hasActivity ? 'Cours de navigation 2026-2027' : '',
            includeWarning,
          };
          const design = createDefaultPrintDesign(profile, options);
          assert.doesNotThrow(
            () => validatePrintDesign(profile, design),
            `${profile.reference} default must validate (${JSON.stringify(options)})`,
          );
          if (includeWarning && !canIncludeQrWarning(profile)) {
            assert.equal(design.elements.disclaimer.enabled, false, `${profile.reference} must omit its unsupported disclaimer`);
          }
        }
      }
    }
  }
  assert.equal(combinations, 72);
});

test('wide Avery defaults remain valid without activity content', () => {
  for (const reference of ['L7160', 'L7162', 'L7163']) {
    const design = createDefaultPrintDesign(AVERY_PROFILES[reference], {
      title: 'Carte étudiant',
      activityName: '',
      includeWarning: false,
    });
    assert.doesNotThrow(() => validatePrintDesign(AVERY_PROFILES[reference], design));
  }
});
