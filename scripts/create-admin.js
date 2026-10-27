// Creates an admin account from the command line, for setting up a new deployment.
// Usage: node scripts/create-admin.js <username> <email> <first name> <last name>
const readline = require('node:readline');
const { openDatabase } = require('../src/db');
const { validateUser, createUser } = require('../src/lib/users');

const [username, email, firstName, lastName] = process.argv.slice(2);
if (!lastName) {
  console.error('Usage: node scripts/create-admin.js <username> <email> <first name> <last name>');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Password (at least 8 characters): ', (password) => {
  rl.close();
  const db = openDatabase();
  const values = {
    username, email, first_name: firstName, last_name: lastName, role: 'admin',
    grade_level: null, school: null, phone: null, password,
  };
  const errors = validateUser(db, values, { passwordRequired: true });
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  createUser(db, values);
  console.log(`Admin "${username}" created. Sign in and add everyone else from Users.`);
});
