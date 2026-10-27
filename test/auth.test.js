const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, signIn, csrfToken, withPost, request } = require('./helpers');

test('sign-in sends each role to its own dashboard', async () => {
  const { app } = setup();
  const expectations = {
    admin: 'Admin dashboard',
    mrivera: 'My courses',
    pjohnson: 'Add a child',
    'jordan.j': 'Find a program',
  };
  for (const [username, text] of Object.entries(expectations)) {
    const agent = await signIn(app, username);
    const res = await agent.get('/dashboard');
    assert.equal(res.status, 200);
    assert.match(res.text, new RegExp(text), `${username} dashboard`);
  }
});

test('wrong password is rejected', async () => {
  const { app } = setup();
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent.post('/login').type('form').send({ _csrf: token, identifier: 'admin', password: 'nope-nope' });
  assert.equal(res.status, 401);
});

test('forms without a CSRF token are rejected', async () => {
  const { app } = setup();
  const res = await request(app).post('/login').type('form').send({ identifier: 'admin', password: 'codecrew123' });
  assert.equal(res.status, 403);
});

test('signed-out visitors are sent to sign in', async () => {
  const { app } = setup();
  const res = await request(app).get('/dashboard');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});

test('parents and students can register, but not as instructor or admin', async () => {
  const { app, db } = setup();
  const base = { first_name: 'Rosa', last_name: 'Diaz', password: 'longenough1', password_confirm: 'longenough1' };

  for (const role of ['instructor', 'admin']) {
    const agent = request.agent(app);
    const token = await csrfToken(agent, '/register');
    const res = await agent.post('/register').type('form').send({ _csrf: token, ...base, role, username: `rosa-${role}`, email: `${role}@x.org` });
    assert.equal(res.status, 422);
    assert.equal(db.prepare('SELECT 1 FROM users WHERE username = ?').get(`rosa-${role}`), undefined);
  }

  const agent = withPost(request.agent(app));
  const token = await csrfToken(agent, '/register');
  const res = await agent.post('/register').type('form').send({ _csrf: token, ...base, role: 'parent', username: 'rdiaz', email: 'rdiaz@x.org' });
  assert.equal(res.status, 302);
  const dash = await agent.get('/dashboard');
  assert.match(dash.text, /Welcome to CodeCrew/);
  assert.match(dash.text, /Add a child/);
});

test('students can register without an email; parents cannot', async () => {
  const { app } = setup();
  const base = { first_name: 'Kai', last_name: 'Lee', password: 'longenough1', password_confirm: 'longenough1' };
  let agent = request.agent(app);
  let token = await csrfToken(agent, '/register');
  let res = await agent.post('/register').type('form').send({ _csrf: token, ...base, role: 'student', username: 'kai.lee' });
  assert.equal(res.status, 302);

  agent = request.agent(app);
  token = await csrfToken(agent, '/register');
  res = await agent.post('/register').type('form').send({ _csrf: token, ...base, role: 'parent', username: 'kai.parent' });
  assert.equal(res.status, 422);
});

test('deactivated users cannot sign in and are signed out', async () => {
  const { app, db } = setup();
  const agent = await signIn(app, 'taylor.k');
  db.prepare("UPDATE users SET active = 0 WHERE username = 'taylor.k'").run();
  const res = await agent.get('/dashboard');
  assert.equal(res.status, 302);
  await assert.rejects(signIn(app, 'taylor.k'));
});

test('users can change their own password', async () => {
  const { app } = setup();
  const agent = await signIn(app, 'pjohnson');
  const res = await agent.postForm('/account', {
    first_name: 'Pat', last_name: 'Johnson', email: 'pjohnson@example.org',
    current_password: 'codecrew123', new_password: 'brand-new-pass', new_password_confirm: 'brand-new-pass',
  });
  assert.equal(res.status, 302);
  await signIn(app, 'pjohnson', 'brand-new-pass');
});
