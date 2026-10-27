# CodeCrew Portal

A web portal for CodeCrew programs. Students, parents/guardians, instructors, and admins each sign in to their own dashboard.

| Role | What they can do |
|---|---|
| **Student** | Create an account (email optional), browse open programs, sign up for courses, drop a course. |
| **Parent / Guardian** | Create an account, add each child (creates the child's student login, already linked), sign children up for courses, drop courses, message their children's instructors. |
| **Instructor** | See assigned courses, edit course details (title, description, schedule, location), view the roster with each student's linked parents, remove a student with a reason, message one parent or all parents in a course. |
| **Admin** | Everything: create, view, edit, turn off, and delete users of any role; reset passwords; link and unlink parents and students; create, edit, open, close, and delete programs; add courses, assign instructors, set capacity; add students to any course (even when full or closed); message parents, instructors, and other admins. |

## Running it

Requires **Node.js 22.13 or newer** (the portal uses Node's built-in SQLite, so there's no separate database to install).

```bash
npm install
npm run seed      # optional: loads demo accounts and programs
npm start         # http://localhost:3000
```

Demo accounts (all use the password `codecrew123`): `admin`, `mrivera` and `dchen` (instructors), `pjohnson` (parent of `jordan.j` and `sam.j`), and students `jordan.j`, `sam.j`, and `taylor.k`. Run `npm run seed -- --reset` to wipe the database and reload the demo data.

Run the tests with `npm test`.

### Settings

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000). |
| `DATABASE_FILE` | Path to the SQLite file (default `data/portal.db`). |
| `SESSION_SECRET` | Long random string used to sign sign-in cookies. **Required** when `NODE_ENV=production`. |
| `NODE_ENV=production` | Turns on secure (HTTPS-only) cookies and trusts one reverse proxy. |

### Creating the first admin on a real deployment

Don't run the demo seed in production. Instead, create the first admin from the command line, then sign in and add everyone else from **Users**:

```bash
node --disable-warning=ExperimentalWarning scripts/create-admin.js <username> <email> "<First>" "<Last>"
```

It prompts for a password.

## How it works

- **Programs and courses.** A program (e.g. "Spring After-School Coding") contains one or more courses. Each course has one instructor and an optional seat limit. Students and parents only see programs whose status is **Open**; **Draft** programs are hidden while you set them up, and **Closed** programs stop new sign-ups but keep their records.
- **Sign-ups.** Students sign themselves up; parents sign up their linked children. Full courses and closed programs refuse new sign-ups. A student an instructor removed can't re-enroll on their own; an admin can add them back.
- **Family links.** Parents who add a child from their dashboard are linked automatically. If a student already has an account, an admin links them from the student's or parent's page in **Users**.
- **Messaging.** Instructors can message parents of students currently in their courses; parents can message their children's current instructors; everyone can message admins. When a message goes to several parents, each gets a private copy, so families never see each other's names or replies. Students don't have messaging.
- **Turning off vs. deleting.** Turning an account off blocks sign-in but keeps its history. Deleting is permanent and also removes that person's enrollments and messages.

## Security notes

- Passwords are hashed with scrypt; sessions are stored in the database and rotated at sign-in.
- Every form carries a CSRF token, and pages send headers that block framing and outside scripts.
- Only students and parents can create their own accounts. Instructor and admin accounts are made by an admin.
- The portal always keeps at least one active admin, and admins can't remove their own admin access.

## Project layout

```
src/
  app.js              Express setup and middleware
  db.js               SQLite schema
  lib/                Auth, sessions, enrollment rules, access rules, form helpers
  routes/             auth, dashboard, programs (sign-ups), courses, parent, messages, admin
  views/              EJS page templates
public/               CSS and the small confirm-dialog script
scripts/              seed.js (demo data), create-admin.js
test/                 Automated tests (node --test)
```
