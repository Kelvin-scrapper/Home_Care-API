// Prints a bcrypt hash for a password, for adding or changing an account in
// db/seed-users.js. Usage: npm run db:hash -- "the password"
const bcrypt = require('bcrypt');

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run db:hash -- "<password>"');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 10));
