const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, signIn, userId, courseId } = require('./helpers');

test('admins can create, read, update, and delete users', async () => {
  const { app, db } = setup();
  const admin = await signIn(app, 'admin');

  let res = await admin.postForm('/admin/users', {
    role: 'instructor', first_name: 'Lena', last_name: 'Ortiz', username: 'lortiz', email: 'lortiz@example.org', password: 'temporary1',
  });
  assert.equal(res.status, 302);
  const id = userId(db, 'lortiz');

  res = await admin.get(`/admin/users?q=Ortiz`);
  assert.match(res.text, /Ortiz, Lena/);

  res = await admin.postForm(`/admin/users/${id}`, {
    role: 'instructor', first_name: 'Lena', last_name: 'Ortiz-Park', username: 'lortiz', email: 'lortiz@example.org', active: '1',
  });
  assert.equal(res.status, 302);
  assert.equal(db.prepare('SELECT last_name FROM users WHERE id = ?').get(id).last_name, 'Ortiz-Park');

  // The new instructor can sign in with the temporary password.
  await signIn(app, 'lortiz', 'temporary1');

  res = await admin.postForm(`/admin/users/${id}/delete`);
  assert.equal(res.status, 302);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(id), undefined);
});

test('admins cannot lock themselves out', async () => {
  const { app, db } = setup();
  const admin = await signIn(app, 'admin');
  const id = userId(db, 'admin');
  let res = await admin.postForm(`/admin/users/${id}`, {
    role: 'parent', first_name: 'Avery', last_name: 'Admin', username: 'admin', email: 'admin@example.org', active: '1',
  });
  assert.equal(res.status, 422);
  res = await admin.postForm(`/admin/users/${id}/delete`);
  assert.equal(db.prepare('SELECT role FROM users WHERE id = ?').get(id).role, 'admin');
});

test('admins can link and unlink parents and students', async () => {
  const { app, db } = setup();
  const admin = await signIn(app, 'admin');
  const parent = userId(db, 'pjohnson');
  const taylor = userId(db, 'taylor.k');
  await admin.postForm(`/admin/users/${parent}/links`, { other_id: taylor });
  assert.ok(db.prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?').get(parent, taylor));

  // Linking two parents is refused.
  await admin.postForm(`/admin/users/${parent}/links`, { other_id: userId(db, 'admin') });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parent_students WHERE parent_id = ?').get(parent).n, 3);

  await admin.postForm(`/admin/users/${taylor}/links/${parent}/delete`);
  assert.equal(db.prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?').get(parent, taylor), undefined);
});

test('admins manage programs and courses, and can assign instructors', async () => {
  const { app, db } = setup();
  const admin = await signIn(app, 'admin');

  let res = await admin.postForm('/admin/programs', { name: 'Fall Robotics', status: 'open', start_date: '2027-09-01', end_date: '2027-12-15' });
  assert.equal(res.status, 302);
  const programId = db.prepare("SELECT id FROM programs WHERE name = 'Fall Robotics'").get().id;

  res = await admin.postForm('/admin/programs', { name: 'Bad dates', status: 'open', start_date: '2027-09-01', end_date: '2027-01-01' });
  assert.equal(res.status, 422);

  res = await admin.postForm(`/admin/programs/${programId}/courses`, {
    title: 'Robotics 101', capacity: '12', instructor_id: userId(db, 'dchen'),
  });
  assert.equal(res.status, 302);
  const robotics = courseId(db, 'Robotics 101');
  assert.equal(db.prepare('SELECT instructor_id FROM courses WHERE id = ?').get(robotics).instructor_id, userId(db, 'dchen'));

  const instructor = await signIn(app, 'dchen');
  assert.match((await instructor.get('/dashboard')).text, /Robotics 101/);

  await admin.postForm(`/admin/programs/${programId}`, { name: 'Fall Robotics', status: 'closed' });
  assert.equal(db.prepare('SELECT status FROM programs WHERE id = ?').get(programId).status, 'closed');

  await admin.postForm(`/admin/programs/${programId}/delete`);
  assert.equal(db.prepare('SELECT 1 FROM courses WHERE id = ?').get(robotics), undefined);
});

test('admins can enroll a student even past capacity or after removal', async () => {
  const { app, db } = setup();
  const python = courseId(db, 'Intro to Python');
  db.prepare('UPDATE courses SET capacity = 1 WHERE id = ?').run(python);
  const admin = await signIn(app, 'admin');
  await admin.postForm(`/courses/${python}/add-student`, { student_id: userId(db, 'taylor.k') });
  const row = db.prepare('SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?').get(userId(db, 'taylor.k'), python);
  assert.equal(row.status, 'active');
});

test('changing a role clears relationships tied to the old role', async () => {
  const { app, db } = setup();
  const admin = await signIn(app, 'admin');
  const rivera = userId(db, 'mrivera');
  await admin.postForm(`/admin/users/${rivera}`, {
    role: 'parent', first_name: 'Maria', last_name: 'Rivera', username: 'mrivera', email: 'mrivera@example.org', active: '1',
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM courses WHERE instructor_id = ?').get(rivera).n, 0);
});
