const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, signIn, userId, courseId } = require('./helpers');

test('an instructor can message all parents in a course, and parents can reply', async () => {
  const { app, db } = setup();
  const instructor = await signIn(app, 'mrivera');
  const scratch = courseId(db, 'Creative Coding');

  const compose = await instructor.get(`/messages/new?course=${scratch}`);
  assert.equal(compose.status, 200);
  assert.match(compose.text, /Pat Johnson/);

  const parent = userId(db, 'pjohnson');
  let res = await instructor.postForm('/messages', {
    recipient_ids: [parent], course_id: scratch, subject: 'Field trip', body: 'We are visiting the science museum next week.',
  });
  assert.equal(res.status, 302);
  const message = db.prepare('SELECT * FROM messages WHERE recipient_id = ?').get(parent);
  assert.equal(message.course_id, scratch);

  const parentAgent = await signIn(app, 'pjohnson');
  const inbox = await parentAgent.get('/messages');
  assert.match(inbox.text, /Field trip/);
  assert.match(inbox.text, /1 new/);

  const thread = await parentAgent.get(`/messages/${message.thread_id}`);
  assert.match(thread.text, /science museum/);
  assert.ok(db.prepare('SELECT read_at FROM messages WHERE id = ?').get(message.id).read_at);

  await parentAgent.postForm(`/messages/${message.thread_id}/reply`, { body: 'Thanks! Jordan is excited.' });
  const reply = db.prepare('SELECT * FROM messages WHERE thread_id = ? AND sender_id = ?').get(message.thread_id, parent);
  assert.equal(reply.recipient_id, userId(db, 'mrivera'));
});

test('instructors cannot message parents outside their courses', async () => {
  const { app, db } = setup();
  // dchen teaches Python; pjohnson is a parent there (sam.j). Add a parent with no child in dchen's course.
  db.prepare("INSERT INTO users (username, email, password_hash, first_name, last_name, role) VALUES ('other.parent', 'o@x.org', 'x', 'Olive', 'Other', 'parent')").run();
  const instructor = await signIn(app, 'dchen');
  const res = await instructor.postForm('/messages', {
    recipient_ids: [userId(db, 'other.parent')], subject: 'Hi', body: 'Hello',
  });
  assert.equal(res.status, 422);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
});

test('people outside a conversation cannot read it', async () => {
  const { app, db } = setup();
  const instructor = await signIn(app, 'mrivera');
  await instructor.postForm('/messages', { recipient_ids: [userId(db, 'pjohnson')], subject: 'Private', body: 'About Jordan' });
  const threadId = db.prepare('SELECT thread_id FROM messages').get().thread_id;
  const outsider = await signIn(app, 'dchen');
  assert.equal((await outsider.get(`/messages/${threadId}`)).status, 404);
});

test('sending to several parents gives each a private copy', async () => {
  const { app, db } = setup();
  db.prepare("INSERT INTO users (username, email, password_hash, first_name, last_name, role) VALUES ('kim.parent', 'k@x.org', 'x', 'Jamie', 'Kim', 'parent')").run();
  db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(userId(db, 'kim.parent'), userId(db, 'taylor.k'));
  const instructor = await signIn(app, 'mrivera');
  await instructor.postForm('/messages', {
    recipient_ids: [userId(db, 'pjohnson'), userId(db, 'kim.parent')], subject: 'Update', body: 'Great week!',
  });
  const threads = db.prepare('SELECT DISTINCT thread_id FROM messages').all();
  assert.equal(threads.length, 2);
});
