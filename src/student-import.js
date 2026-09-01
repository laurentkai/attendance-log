const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { pool } = require('./db/client');
const {
  insertStudent,
  normalizeStudentValues,
  validateStudentValues,
} = require('./student-data');
const { escapeHtml, renderMessagePage, renderPage } = require('./ui');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
});

async function loadClasses() {
  const result = await pool.query('SELECT id, name FROM classes ORDER BY LOWER(name), id');
  return result.rows;
}

function renderImportPage({ classes, selectedClassId = '', error = '', summary = null }) {
  const errorMessage = error
    ? `<p class="message message-error" role="alert">${escapeHtml(error)}</p>`
    : '';
  const summaryContent = summary
    ? `<section class="summary-card" aria-labelledby="import-summary-title">
        <h2 id="import-summary-title">Résumé de l’import</h2>
        <dl class="summary-list">
          <div><dt>Créés</dt><dd>${summary.created}</dd></div>
          <div><dt>Existants retrouvés</dt><dd>${summary.matchedExisting}</dd></div>
          <div><dt>Nouvelles affectations</dt><dd>${summary.newlyAssigned}</dd></div>
          <div><dt>Erreurs ou lignes ignorées</dt><dd>${summary.skipped}</dd></div>
        </dl>
      </section>`
    : '';
  const classOptions = classes.map((classRecord) => `
    <option value="${classRecord.id}"${classRecord.id === selectedClassId ? ' selected' : ''}>${escapeHtml(classRecord.name)}</option>`).join('');
  const selectedClass = classes.find((classRecord) => classRecord.id === selectedClassId);

  return renderPage('Importer des élèves', `
    <header class="page-header">
      <h1>Importer des élèves</h1>
      ${selectedClass
        ? `<a class="button button-secondary" href="/classes/${selectedClass.id}">Voir ${escapeHtml(selectedClass.name)}</a>`
        : ''}
    </header>
    ${errorMessage}
    ${summaryContent}
    <form class="form-card" method="post" action="/students/import" enctype="multipart/form-data">
      <label for="class_id">Classe cible <span aria-hidden="true">*</span></label>
      <select id="class_id" name="class_id" required>
        <option value="">Choisir une classe</option>
        ${classOptions}
      </select>

      <label for="csv_file">Fichier CSV <span aria-hidden="true">*</span></label>
      <input id="csv_file" name="csv_file" type="file" accept=".csv,text/csv" required>
      <p class="help-text">Colonnes requises : first_name, last_name, email. Taille maximale : 1 Mo.</p>

      <button class="button" type="submit"${classes.length === 0 ? ' disabled' : ''}>Importer</button>
    </form>`);
}

router.get('/', async (request, response) => {
  try {
    const classes = await loadClasses();
    const requestedClassId = typeof request.query.class_id === 'string'
      ? request.query.class_id
      : '';
    const selectedClassId = classes.some((classRecord) => classRecord.id === requestedClassId)
      ? requestedClassId
      : '';
    response.send(renderImportPage({ classes, selectedClassId }));
  } catch (error) {
    console.error('Unable to load import form:', error);
    const page = renderMessagePage('Import indisponible', 'Impossible de charger le formulaire d’import pour le moment.');
    response.status(page.status).send(page.html);
  }
});

function receiveCsvFile(request, response, next) {
  upload.single('csv_file')(request, response, async (error) => {
    if (!error) {
      next();
      return;
    }

    console.error('Unable to receive CSV file:', error);
    try {
      response.status(400).send(renderImportPage({
        classes: await loadClasses(),
        selectedClassId: request.body?.class_id || '',
        error: error.code === 'LIMIT_FILE_SIZE'
          ? 'Le fichier dépasse la taille maximale de 1 Mo.'
          : 'Le fichier n’a pas pu être envoyé.',
      }));
    } catch (databaseError) {
      console.error('Unable to load classes after upload error:', databaseError);
      const page = renderMessagePage('Import impossible', 'Impossible de traiter l’import pour le moment.');
      response.status(page.status).send(page.html);
    }
  });
}

router.post('/', receiveCsvFile, async (request, response) => {
  let classes;
  try {
    classes = await loadClasses();
  } catch (error) {
    console.error('Unable to load classes for import:', error);
    const page = renderMessagePage('Import impossible', 'Impossible de traiter l’import pour le moment.');
    response.status(page.status).send(page.html);
    return;
  }

  const selectedClassId = typeof request.body.class_id === 'string'
    ? request.body.class_id
    : '';
  const selectedClassExists = classes.some((classRecord) => classRecord.id === selectedClassId);
  if (!selectedClassExists || !request.file) {
    response.status(400).send(renderImportPage({
      classes,
      selectedClassId,
      error: !selectedClassExists
        ? 'Sélectionnez une classe valide.'
        : 'Sélectionnez un fichier CSV.',
    }));
    return;
  }

  let records;
  try {
    let validHeaders = false;
    records = parse(request.file.buffer, {
      bom: true,
      columns: (headers) => {
        const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
        validHeaders = ['first_name', 'last_name', 'email']
          .every((requiredHeader) => normalizedHeaders.includes(requiredHeader));
        return normalizedHeaders;
      },
      skip_empty_lines: true,
      trim: true,
    });
    if (!validHeaders) {
      throw new Error('Missing required CSV headers');
    }
    if (records.length > 2000) {
      throw new Error('CSV row limit exceeded');
    }
  } catch (error) {
    console.error('Unable to parse CSV file:', error.message);
    response.status(400).send(renderImportPage({
      classes,
      selectedClassId,
      error: 'Le fichier CSV est invalide ou ne contient pas les colonnes requises.',
    }));
    return;
  }

  const summary = { created: 0, matchedExisting: 0, newlyAssigned: 0, skipped: 0 };

  for (const record of records) {
    const values = normalizeStudentValues(record);
    if (validateStudentValues(values)) {
      summary.skipped += 1;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existingResult = await client.query(
        'SELECT id FROM students WHERE LOWER(email) = LOWER($1) FOR UPDATE',
        [values.email],
      );
      let studentId;
      if (existingResult.rowCount > 0) {
        studentId = existingResult.rows[0].id;
        summary.matchedExisting += 1;
      } else {
        const student = await insertStudent(client, values);
        studentId = student.id;
        summary.created += 1;
      }

      const membershipResult = await client.query(
        `INSERT INTO student_classes (student_id, class_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [studentId, selectedClassId],
      );
      summary.newlyAssigned += membershipResult.rowCount;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Unable to import CSV row:', error);
      summary.skipped += 1;
    } finally {
      client.release();
    }
  }

  response.send(renderImportPage({ classes, selectedClassId, summary }));
});

module.exports = router;
