const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgresql://unit:unit@127.0.0.1:1/unit';

const {
  DEFAULT_TERMINOLOGY,
  TERMINOLOGY_CONCEPTS,
  TERMINOLOGY_FORMS,
  copyTerminology,
  getTerm,
  getTerminology,
  validateTerminology,
  valuesFromBody,
} = require('../src/terminology');
const terminologyRouter = require('../src/terminology-settings');

test('all established terminology concepts have complete independent EN and FR defaults', () => {
  assert.deepEqual(TERMINOLOGY_CONCEPTS, [
    'student', 'class', 'session', 'attendance', 'instructor', 'membership',
  ]);
  for (const language of ['en', 'fr']) {
    for (const concept of TERMINOLOGY_CONCEPTS) {
      for (const form of TERMINOLOGY_FORMS) {
        assert.equal(typeof DEFAULT_TERMINOLOGY[language][concept][form], 'string');
        assert.ok(DEFAULT_TERMINOLOGY[language][concept][form]);
      }
    }
  }
  assert.equal(getTerm('en', 'student', 'plural'), 'Students');
  assert.equal(getTerm('fr', 'student', 'plural'), 'Participants');
});

test('terminology lookup uses explicit language with English-only fallback and no cross-language bleed', () => {
  const values = copyTerminology();
  values.en.student.singular = 'Learner';
  values.fr.student.singular = 'Navigateur';
  assert.equal(getTerm('en', 'student', 'singular', values), 'Learner');
  assert.equal(getTerm('fr', 'student', 'singular', values), 'Navigateur');
  assert.equal(getTerm('de', 'student', 'singular', values), 'Learner');
  assert.equal(getTerm(null, 'student', 'singular', values), 'Learner');
  values.fr.student.singular = '';
  assert.equal(getTerm('fr', 'student', 'singular', values), 'Learner');
  values.en.student.singular = '';
  assert.throws(
    () => getTerm('fr', 'student', 'singular', values),
    (error) => error.code === 'TERMINOLOGY_MISSING_VALUE',
  );
  assert.throws(
    () => getTerminology({ fr: values.fr }, 'en'),
    (error) => error.code === 'TERMINOLOGY_MISSING_CANONICAL',
  );
});

test('both terminology form sets parse and validate independently', () => {
  const body = {};
  for (const language of ['en', 'fr']) {
    for (const concept of TERMINOLOGY_CONCEPTS) {
      for (const form of TERMINOLOGY_FORMS) {
        body[`${language}_${concept}_${form}`] = ` ${language}-${concept}-${form} `;
      }
    }
  }
  const english = valuesFromBody(body, 'en');
  const french = valuesFromBody(body, 'fr');
  assert.equal(english.student.singular, 'en-student-singular');
  assert.equal(french.student.singular, 'fr-student-singular');
  assert.equal(validateTerminology(english, 'en'), '');
  french.class.plural = '';
  assert.equal(validateTerminology(french, 'en'), 'All terms are required.');
  assert.throws(() => valuesFromBody(body, 'de'));
});

test('Terminology Settings renders compact accessible per-concept language blocks', () => {
  const values = copyTerminology();
  values.en.student.singular = 'Learner';
  values.fr.student.singular = 'Navigateur';
  values.en.membership.plural = 'X'.repeat(40);
  values.fr.membership.plural = '<Affectations & archives>';
  const english = terminologyRouter.renderTerminologyPage({ values, language: 'en' });
  const french = terminologyRouter.renderTerminologyPage({ values, language: 'fr' });
  assert.match(english, /<form class="d-grid gap-3" method="post" action="\/settings\/terminology">/);
  assert.match(english, /<div class="terminology-concepts">/);
  assert.equal((english.match(/<section class="card terminology-concept"/g) || []).length, TERMINOLOGY_CONCEPTS.length);
  assert.match(english, /<h2 class="terminology-concept-title" id="terminology-student-title">Student<\/h2>/);
  assert.match(english, /data-terminology-language="en">\s*<p class="terminology-language-label">English<\/p>/);
  assert.match(english, /data-terminology-language="fr">\s*<p class="terminology-language-label">French<\/p>/);
  assert.match(english, /name="en_student_singular"[^>]+value="Learner"/);
  assert.match(english, /name="fr_student_singular"[^>]+value="Navigateur"/);
  assert.match(english, /<label class="form-label mb-0" for="en_student_singular"><span aria-hidden="true">Singular<\/span><span class="visually-hidden">Student — English, Singular<\/span><\/label>/);
  assert.match(english, /<label class="form-label mb-0" for="fr_student_plural"><span aria-hidden="true">Plural<\/span><span class="visually-hidden">Student — French, Plural<\/span><\/label>/);
  assert.match(english, new RegExp(`value="${'X'.repeat(40)}"`));
  assert.match(english, /value="&lt;Affectations &amp; archives&gt;"/);
  assert.equal((english.match(/class="form-label mb-0" for="(?:en|fr)_[^"]+"/g) || []).length, 24);
  assert.match(english, /method="post" action="\/settings\/terminology\/reset"/);
  assert.match(french, /Terminologie localisée de l’application/);
  assert.match(french, /<h2 class="terminology-concept-title" id="terminology-class-title">Activité<\/h2>/);
  assert.match(french, /data-terminology-language="en">\s*<p class="terminology-language-label">Anglais<\/p>/);
  assert.match(french, /data-terminology-language="fr">\s*<p class="terminology-language-label">Français<\/p>/);
  assert.match(french, /<label class="form-label mb-0" for="fr_class_plural"><span aria-hidden="true">Pluriel<\/span><span class="visually-hidden">Activité — Français, Pluriel<\/span><\/label>/);
  assert.doesNotMatch(english, /<table|table-responsive|overflow-x/);
  assert.doesNotMatch(french, /<table|table-responsive|overflow-x/);
});

test('Terminology Settings keeps language fields inline on desktop and stacks without horizontal overflow on mobile', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.terminology-language-row\s*\{[^}]*grid-template-columns:\s*6\.5rem minmax\(0, 1fr\) minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(max-width: 575\.98px\)[\s\S]*?\.terminology-language-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.terminology-field \.form-control\s*\{[^}]*min-width:\s*0/s);
  assert.doesNotMatch(css, /\.terminology-table/);
});
