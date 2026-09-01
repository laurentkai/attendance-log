require('dotenv').config({ quiet: true });

const path = require('node:path');
const express = require('express');
const { pool, verifyDatabaseConnection } = require('./db/client');
const classesRouter = require('./classes');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/classes', classesRouter);

app.get('/', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

app.get('/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (_error) {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
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
