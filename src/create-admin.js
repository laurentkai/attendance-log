require('dotenv').config({ quiet: true });

const { createAdminUser } = require('./admin-users');
const { pool } = require('./db/client');

async function main() {
  const name = process.env.CREATE_ADMIN_NAME;
  const email = process.env.CREATE_ADMIN_EMAIL;
  const password = process.env.CREATE_ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      'CREATE_ADMIN_NAME, CREATE_ADMIN_EMAIL and CREATE_ADMIN_PASSWORD are required.',
    );
  }

  const user = await createAdminUser({ name, email, password });
  console.log(`Administrator created: ${user.email}`);
}

main()
  .catch((error) => {
    console.error('Unable to create administrator:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
