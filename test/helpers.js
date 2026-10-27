const request = require('supertest');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { seed, DEMO_PASSWORD } = require('../scripts/seed');

function setup() {
  const db = openDatabase(':memory:');
  seed(db);
  const app = createApp({ db, sessionSecret: 'test-secret', production: false });
  return { db, app };
}

async function csrfToken(agent, path = '/login') {
  const res = await agent.get(path);
  const match = res.text.match(/name="_csrf" value="([^"]+)"/);
  if (!match) throw new Error(`No CSRF token on ${path} (status ${res.status})`);
  return match[1];
}

// Returns a supertest agent signed in as the given user, plus a helper to post forms with a valid token.
async function signIn(app, username, password = DEMO_PASSWORD) {
  const agent = request.agent(app);
  const token = await csrfToken(agent);
  const res = await agent.post('/login').type('form').send({ _csrf: token, identifier: username, password });
  if (res.status !== 302) throw new Error(`Sign-in failed for ${username}: ${res.status}`);
  return withPost(agent);
}

function withPost(agent) {
  agent.postForm = async (path, fields = {}) => {
    const token = await csrfToken(agent, '/dashboard');
    return agent.post(path).type('form').send(formBody({ _csrf: token, ...fields }));
  };
  return agent;
}

// Encodes arrays as repeated keys (a=1&a=2), the way browsers submit checkboxes.
function formBody(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v));
  }
  return params.toString();
}

function userId(db, username) {
  return db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
}

function courseId(db, titleStart) {
  return db.prepare('SELECT id FROM courses WHERE title LIKE ?').get(`${titleStart}%`).id;
}

module.exports = { setup, signIn, csrfToken, withPost, userId, courseId, request };
