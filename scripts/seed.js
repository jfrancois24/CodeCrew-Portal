// Loads demo accounts, programs, and courses so you can try every role.
// Usage: npm run seed            (adds demo data to an empty database)
//        npm run seed -- --reset (deletes the existing database first)
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, transaction } = require('../src/db');
const { createUser } = require('../src/lib/users');

const DEMO_PASSWORD = 'codecrew123';

function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
    throw new Error('The database already has users. Run with --reset to start over.');
  }
  return transaction(db, () => {
    const user = (fields) => createUser(db, { email: null, grade_level: null, school: null, phone: null, password: DEMO_PASSWORD, ...fields });

    const admin = user({ username: 'admin', email: 'admin@example.org', first_name: 'Avery', last_name: 'Admin', role: 'admin' });
    const rivera = user({ username: 'mrivera', email: 'mrivera@example.org', first_name: 'Maria', last_name: 'Rivera', role: 'instructor' });
    const chen = user({ username: 'dchen', email: 'dchen@example.org', first_name: 'David', last_name: 'Chen', role: 'instructor' });
    const parent = user({ username: 'pjohnson', email: 'pjohnson@example.org', first_name: 'Pat', last_name: 'Johnson', role: 'parent' });
    const jordan = user({ username: 'jordan.j', first_name: 'Jordan', last_name: 'Johnson', role: 'student', grade_level: '7', school: 'Lincoln Middle School' });
    const sam = user({ username: 'sam.j', first_name: 'Sam', last_name: 'Johnson', role: 'student', grade_level: '10', school: 'Central High School' });
    const taylor = user({ username: 'taylor.k', first_name: 'Taylor', last_name: 'Kim', role: 'student', grade_level: '8', school: 'Lincoln Middle School' });

    const link = db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)');
    link.run(parent, jordan);
    link.run(parent, sam);

    const program = db.prepare('INSERT INTO programs (name, description, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)');
    const spring = Number(program.run('Spring After-School Coding (Demo)', 'Weekly after-school computer science sessions. Demo data — replace with real programs.', 'open', '2027-02-01', '2027-05-14').lastInsertRowid);
    const summer = Number(program.run('Summer AI Camp (Demo)', 'A two-week introduction to AI concepts. Demo data.', 'draft', '2027-06-21', '2027-07-02').lastInsertRowid);

    const course = db.prepare('INSERT INTO courses (program_id, title, description, schedule, location, capacity, instructor_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const scratch = Number(course.run(spring, 'Creative Coding with Scratch (Grades 5–8)', 'Build games and animations while learning loops, events, and variables.', 'Tuesdays 3:30–5:00 PM', 'Lincoln Middle School, Room 112', 20, rivera).lastInsertRowid);
    const python = Number(course.run(spring, 'Intro to Python (Grades 9–12)', 'Variables, conditionals, loops, and functions through small projects.', 'Thursdays 4:00–5:30 PM', 'Online (Zoom)', 15, chen).lastInsertRowid);
    course.run(summer, 'AI Explorers', 'What AI is, how it learns from data, and how to use it responsibly.', 'Weekdays 9:00 AM–12:00 PM', 'TBD', 25, null);

    const enroll = db.prepare('INSERT INTO enrollments (student_id, course_id, enrolled_by) VALUES (?, ?, ?)');
    enroll.run(jordan, scratch, parent);
    enroll.run(taylor, scratch, taylor);
    enroll.run(sam, python, parent);

    return { admin };
  });
}

if (require.main === module) {
  const file = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'portal.db');
  if (process.argv.includes('--reset')) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  }
  try {
    seed(openDatabase(file));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Demo data loaded into ${file}.`);
  console.log(`Every demo account uses the password "${DEMO_PASSWORD}":`);
  console.log('  admin     (admin)');
  console.log('  mrivera   (instructor, Scratch course)   dchen (instructor, Python course)');
  console.log('  pjohnson  (parent of jordan.j and sam.j)');
  console.log('  jordan.j, sam.j, taylor.k (students)');
}

module.exports = { seed, DEMO_PASSWORD };
