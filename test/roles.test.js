const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, signIn, userId, courseId } = require('./helpers');

function enrollmentStatus(db, studentId, course) {
  const row = db.prepare('SELECT status FROM enrollments WHERE student_id = ? AND course_id = ?').get(studentId, course);
  return row && row.status;
}

test('students can sign up for open programs and drop courses', async () => {
  const { app, db } = setup();
  const agent = await signIn(app, 'taylor.k');
  const python = courseId(db, 'Intro to Python');
  let res = await agent.postForm('/enrollments', { course_id: python });
  assert.equal(res.status, 302);
  assert.equal(enrollmentStatus(db, userId(db, 'taylor.k'), python), 'active');

  res = await agent.postForm('/enrollments/drop', { course_id: python });
  assert.equal(enrollmentStatus(db, userId(db, 'taylor.k'), python), 'dropped');
});

test('students cannot sign up for courses in programs that are not open', async () => {
  const { app, db } = setup();
  const agent = await signIn(app, 'taylor.k');
  await agent.postForm('/enrollments', { course_id: courseId(db, 'AI Explorers') });
  assert.equal(enrollmentStatus(db, userId(db, 'taylor.k'), courseId(db, 'AI Explorers')), undefined);
});

test('a student cannot sign up a different student', async () => {
  const { app, db } = setup();
  const agent = await signIn(app, 'taylor.k');
  const python = courseId(db, 'Intro to Python');
  await agent.postForm('/enrollments', { course_id: python, student_id: userId(db, 'jordan.j') });
  assert.equal(enrollmentStatus(db, userId(db, 'jordan.j'), python), undefined);
  assert.equal(enrollmentStatus(db, userId(db, 'taylor.k'), python), 'active');
});

test('full courses reject new sign-ups', async () => {
  const { app, db } = setup();
  const python = courseId(db, 'Intro to Python');
  db.prepare('UPDATE courses SET capacity = 1 WHERE id = ?').run(python); // sam.j already holds the one seat
  const agent = await signIn(app, 'taylor.k');
  await agent.postForm('/enrollments', { course_id: python });
  assert.equal(enrollmentStatus(db, userId(db, 'taylor.k'), python), undefined);
});

test('parents can add a child and sign up only their own children', async () => {
  const { app, db } = setup();
  const agent = await signIn(app, 'pjohnson');
  let res = await agent.postForm('/children', {
    first_name: 'Riley', last_name: 'Johnson', username: 'riley.j', grade_level: '5',
    password: 'kidpassword', password_confirm: 'kidpassword',
  });
  assert.equal(res.status, 302);
  const riley = userId(db, 'riley.j');
  assert.ok(db.prepare('SELECT 1 FROM parent_students WHERE parent_id = ? AND student_id = ?').get(userId(db, 'pjohnson'), riley));

  const scratch = courseId(db, 'Creative Coding');
  await agent.postForm('/enrollments', { course_id: scratch, student_id: riley });
  assert.equal(enrollmentStatus(db, riley, scratch), 'active');

  // taylor.k is not this parent's child.
  const python = courseId(db, 'Intro to Python');
  await agent.postForm('/enrollments', { course_id: python, student_id: userId(db, 'taylor.k') });
  assert.equal(enrollmentStatus(db, userId(db, 'taylor.k'), python), undefined);

  const dash = await agent.get('/dashboard');
  assert.match(dash.text, /Riley Johnson/);
  assert.match(dash.text, /Jordan Johnson/);
});

test('instructors can edit and manage only their own courses', async () => {
  const { app, db } = setup();
  const agent = await signIn(app, 'mrivera');
  const scratch = courseId(db, 'Creative Coding');
  const python = courseId(db, 'Intro to Python');

  assert.equal((await agent.get(`/courses/${scratch}`)).status, 200);
  assert.equal((await agent.get(`/courses/${python}`)).status, 403);

  await agent.postForm(`/courses/${scratch}`, { title: 'Scratch Studio', schedule: 'Wednesdays 3:30 PM', capacity: '99', instructor_id: '' });
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(scratch);
  assert.equal(course.title, 'Scratch Studio');
  assert.equal(course.schedule, 'Wednesdays 3:30 PM');
  assert.equal(course.capacity, 20, 'instructors cannot change capacity');
  assert.equal(course.instructor_id, userId(db, 'mrivera'), 'instructors cannot unassign themselves');

  const res = await agent.postForm(`/courses/${python}`, { title: 'Hijacked' });
  assert.equal(res.status, 403);
});

test('instructors can remove students, who then cannot re-enroll themselves', async () => {
  const { app, db } = setup();
  const scratch = courseId(db, 'Creative Coding');
  const taylor = userId(db, 'taylor.k');
  const instructor = await signIn(app, 'mrivera');
  await instructor.postForm(`/courses/${scratch}/remove-student`, { student_id: taylor, reason: 'Moved schools' });
  const row = db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?').get(taylor, scratch);
  assert.equal(row.status, 'removed');
  assert.equal(row.end_reason, 'Moved schools');

  const student = await signIn(app, 'taylor.k');
  await student.postForm('/enrollments', { course_id: scratch });
  assert.equal(enrollmentStatus(db, taylor, scratch), 'removed');

  // Another instructor cannot remove students from a course they do not teach.
  const other = await signIn(app, 'dchen');
  const res = await other.postForm(`/courses/${scratch}/remove-student`, { student_id: userId(db, 'jordan.j') });
  assert.equal(res.status, 403);
  assert.equal(enrollmentStatus(db, userId(db, 'jordan.j'), scratch), 'active');
});

test('role-restricted pages are blocked for other roles', async () => {
  const { app } = setup();
  const checks = [
    ['jordan.j', '/admin/users'],
    ['pjohnson', '/admin/programs'],
    ['mrivera', '/admin/users/new'],
    ['jordan.j', '/messages'],
    ['jordan.j', '/children/new'],
  ];
  for (const [username, path] of checks) {
    const agent = await signIn(app, username);
    assert.equal((await agent.get(path)).status, 403, `${username} -> ${path}`);
  }
});
