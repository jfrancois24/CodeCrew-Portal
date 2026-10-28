const { ROLES, hashPassword, passwordProblem } = require('./auth');
const { text, optional, USERNAME_PATTERN, EMAIL_PATTERN } = require('./forms');

// Students can sign in with a username alone, since many K-12 students do not have an email address.
const EMAIL_REQUIRED_ROLES = ['parent', 'instructor', 'admin'];

function readUserForm(body) {
  return {
    username: text(body.username),
    email: optional(body.email),
    first_name: text(body.first_name),
    last_name: text(body.last_name),
    role: text(body.role),
    grade_level: optional(body.grade_level),
    school: optional(body.school),
    phone: optional(body.phone),
    password: text(body.password),
  };
}

// Returns a list of problems with the submitted values (empty when valid).
function validateUser(db, values, { passwordRequired, excludeId = 0 }) {
  const errors = [];
  if (!values.first_name) errors.push('First name is required.');
  if (!values.last_name) errors.push('Last name is required.');
  if (!ROLES.includes(values.role)) errors.push('Choose a valid role.');
  if (!USERNAME_PATTERN.test(values.username)) {
    errors.push('Username must be 3-40 characters: letters, numbers, dots, dashes, or underscores.');
  } else if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?').get(values.username, excludeId)) {
    errors.push('That username is already taken.');
  }
  if (values.email) {
    if (!EMAIL_PATTERN.test(values.email)) errors.push('Enter a valid email address.');
    else if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(values.email, excludeId)) {
      errors.push('An account with that email already exists.');
    }
  } else if (EMAIL_REQUIRED_ROLES.includes(values.role)) {
    errors.push('Email is required for parent, instructor, and admin accounts.');
  }
  if (passwordRequired || values.password) {
    const problem = passwordProblem(values.password);
    if (problem) errors.push(problem);
  }
  return errors;
}

function studentOnly(values, field) {
  return values.role === 'student' ? values[field] : null;
}

function createUser(db, values) {
  const result = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, role, grade_level, school, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      values.username,
      values.email,
      hashPassword(values.password),
      values.first_name,
      values.last_name,
      values.role,
      studentOnly(values, 'grade_level'),
      studentOnly(values, 'school'),
      values.phone
    );
  return Number(result.lastInsertRowid);
}

function updateUser(db, id, values) {
  db.prepare(
    `UPDATE users SET username = ?, email = ?, first_name = ?, last_name = ?, role = ?,
       grade_level = ?, school = ?, phone = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    values.username,
    values.email,
    values.first_name,
    values.last_name,
    values.role,
    studentOnly(values, 'grade_level'),
    studentOnly(values, 'school'),
    values.phone,
    id
  );
  if (values.password) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      hashPassword(values.password),
      id
    );
  }
}

module.exports = { readUserForm, validateUser, createUser, updateUser, EMAIL_REQUIRED_ROLES };
