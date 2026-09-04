require('dotenv').config({ quiet: true });

const { createBreakGlassUser } = require('./admin-users');
const { pool } = require('./db/client');

async function main() {
  const name = process.env.CREATE_ADMIN_NAME;
  const username = process.env.CREATE_ADMIN_USERNAME;
  const password = process.env.CREATE_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'CREATE_ADMIN_USERNAME and CREATE_ADMIN_PASSWORD are required. CREATE_ADMIN_NAME is optional.',
    );
  }

  const user = await createBreakGlassUser({ name, username, password });
  console.log(`Break-glass administrator created: ${user.username}`);
}

main()
  .catch((error) => {
    console.error('Unable to create administrator:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
