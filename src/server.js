require('dotenv').config({ quiet: true });

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { pool, verifyDatabaseConnection } = require('./db/client');
const { router: authRouter, requireAuthentication } = require('./auth');
const classesRouter = require('./classes');
const courseSessionsRouter = require('./course-sessions');
const studentImportRouter = require('./student-import');
const studentsRouter = require('./students');
const { renderPage } = require('./ui');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

for (const variableName of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET']) {
  if (!process.env[variableName]) {
    throw new Error(`${variableName} is required`);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters');
}

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (_error) {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

const PostgreSqlSessionStore = connectPgSimple(session);
app.use(session({
  name: 'attendance_log_session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new PostgreSqlSessionStore({ pool, tableName: 'user_sessions' }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use(authRouter);
app.use(requireAuthentication);
app.use('/classes', classesRouter);
app.use('/sessions', courseSessionsRouter);
app.use('/students/import', studentImportRouter);
app.use('/students', studentsRouter);

app.get('/', (_request, response) => {
  response.send(renderPage('Administration', `
    <header class="page-header">
      <div>
        <p class="eyebrow">Attendance Log</p>
        <h1>Administration</h1>
      </div>
    </header>
    <p>Utilisez le menu pour gérer les classes, les élèves et les sessions.</p>`));
});

async function start() {
  try {
    await verifyDatabaseConnection();
    app.listen(port, '0.0.0.0', () => {
      console.log(`Attendance Log listening on port ${port}`);
    });
  } catch (error) {
    console.error('Unable to connect to PostgreSQL:', error.message);
    await pool.end();
    process.exit(1);
  }
}

start();
