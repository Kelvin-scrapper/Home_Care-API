// Accounts created by db/seed.js when NODE_ENV=production and the database has
// no users yet (a fresh install). After that this file is not consulted again:
// manage users in the app (Admin > Add User / Edit), and redeploys leave them alone.
// Passwords are stored as bcrypt hashes, so the repo doesn't reveal them.
//
// To change what a fresh install starts with: run `npm run db:hash -- "<password>"`
// and paste the hash below.

module.exports = [
  {
    name: 'System Admin',
    email: 'admin@bheco.org',
    role: 'Admin',
    passwordHash: '$2b$10$HH3iRoCaFMXRbOvLbknWwOONhlTUP8x2Muqxbc9iZvrVjtC7mlJXi',
  },
  {
    name: 'Programme Director',
    email: 'director@bheco.org',
    role: 'Management/Director',
    passwordHash: '$2b$10$l14UulgZEt0sRY6jdxQZ3ewUHBPtftVSq/3VH9XM.4wDCu56Q9iHK',
  },
  {
    name: 'Field Coordinator',
    email: 'coordinator@bheco.org',
    role: 'Coordinator/Field officer',
    passwordHash: '$2b$10$9n0lReZp2kEdgK2qR9aZ8uiINsAUhNusBtWL6WpQOKUGzepbKf.NC',
  },
  {
    name: 'Field Volunteer',
    email: 'volunteer@bheco.org',
    role: 'Volunteer/CHW',
    passwordHash: '$2b$10$.tXctp0JjhSWwShqz/Zk.OwyztgH3.Jdx8wckcmY4DnyZv/pT0FMu',
  },
];
