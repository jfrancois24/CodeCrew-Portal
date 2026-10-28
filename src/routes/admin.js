const express = require('express');
const { ROLES, requireRole } = require('../lib/auth');
const { readUserForm, validateUser, createUser, updateUser } = require('../lib/users');
const { childrenOf, parentsOf } = require('../lib/access');
const { activeEnrollmentsFor } = require('../lib/enrollment');
const { readCourseForm, activeInstructors } = require('../lib/courses');
const { transaction } = require('../db');
const { text, optional, positiveInt } = require('../lib/forms');

const PROGRAM_STATUSES = ['draft', 'open', 'closed'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

module.exports = (db) => {
  const router = express.Router();
  router.use(requireRole('admin'));

  const notFound = (res, what) => res.status(404).render('error', { title: `${what} not found`, message: `That ${what.toLowerCase()} does not exist.` });

  function activeAdminCount() {
    return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;
  }

  // ---------- Users ----------

  router.get('/users', (req, res) => {
    const role = ROLES.includes(req.query.role) ? req.query.role : '';
    const q = text(req.query.q);
    const like = `%${q}%`;
    const users = db
      .prepare(
        `SELECT * FROM users
         WHERE ($role = '' OR role = $role)
           AND ($q = '' OR first_name || ' ' || last_name LIKE $like OR username LIKE $like OR IFNULL(email, '') LIKE $like)
         ORDER BY last_name, first_name`
      )
      .all({ role, q, like });
    res.render('admin/users/index', { title: 'Users', users, role, q });
  });

  router.get('/users/new', (req, res) => {
    const role = ROLES.includes(req.query.role) ? req.query.role : 'student';
    res.render('admin/users/form', { title: 'Add user', values: { role, active: 1 }, errors: [], editing: null });
  });

  router.post('/users', (req, res) => {
    const values = readUserForm(req.body);
    const errors = validateUser(db, values, { passwordRequired: true });
    if (errors.length) return res.status(422).render('admin/users/form', { title: 'Add user', values, errors, editing: null });
    const id = createUser(db, values);
    req.flash('success', `${values.first_name} ${values.last_name} was added.`);
    res.redirect(`/admin/users/${id}`);
  });

  function loadUserParam(req, res, next) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(positiveInt(req.params.id));
    if (!user) return notFound(res, 'User');
    req.target = user;
    next();
  }

  function renderUser(req, res, { values = req.target, errors = [], status = 200 } = {}) {
    const user = req.target;
    const data = { title: `${user.first_name} ${user.last_name}`, values, errors, editing: user };
    if (user.role === 'student') {
      data.parents = parentsOf(db, user.id);
      data.enrollments = activeEnrollmentsFor(db, user.id);
      data.linkOptions = db
        .prepare(
          `SELECT id, first_name, last_name, username FROM users u WHERE role = 'parent'
           AND NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.parent_id = u.id AND ps.student_id = ?)
           ORDER BY last_name, first_name`
        )
        .all(user.id);
    } else if (user.role === 'parent') {
      data.children = childrenOf(db, user.id);
      data.linkOptions = db
        .prepare(
          `SELECT id, first_name, last_name, username FROM users u WHERE role = 'student'
           AND NOT EXISTS (SELECT 1 FROM parent_students ps WHERE ps.student_id = u.id AND ps.parent_id = ?)
           ORDER BY last_name, first_name`
        )
        .all(user.id);
    } else if (user.role === 'instructor') {
      data.courses = db
        .prepare(
          `SELECT c.id, c.title, p.name AS program_name FROM courses c JOIN programs p ON p.id = c.program_id
           WHERE c.instructor_id = ? ORDER BY c.title`
        )
        .all(user.id);
    }
    res.status(status).render('admin/users/form', data);
  }

  router.get('/users/:id', loadUserParam, (req, res) => renderUser(req, res));

  router.post('/users/:id', loadUserParam, (req, res) => {
    const target = req.target;
    const values = { ...readUserForm(req.body), active: req.body.active ? 1 : 0 };
    const errors = validateUser(db, values, { passwordRequired: false, excludeId: target.id });
    const losesAdmin = target.role === 'admin' && target.active && (values.role !== 'admin' || !values.active);
    if (losesAdmin && target.id === req.user.id) errors.push('You cannot remove your own admin access or turn off your own account.');
    else if (losesAdmin && activeAdminCount() <= 1) errors.push('The portal must keep at least one active admin.');
    if (errors.length) return renderUser(req, res, { values: { ...target, ...values }, errors, status: 422 });

    const roleChanged = values.role !== target.role;
    transaction(db, () => {
      updateUser(db, target.id, values);
      db.prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?").run(values.active, target.id);
      if (roleChanged) {
        // Relationships tied to the old role no longer make sense, so clear them.
        db.prepare('DELETE FROM parent_students WHERE parent_id = ? OR student_id = ?').run(target.id, target.id);
        db.prepare('UPDATE courses SET instructor_id = NULL WHERE instructor_id = ?').run(target.id);
        db.prepare(
          `UPDATE enrollments SET status = 'removed', ended_by = ?, ended_at = datetime('now'), end_reason = 'Account role changed'
           WHERE student_id = ? AND status = 'active'`
        ).run(req.user.id, target.id);
      }
    });
    req.flash('success', roleChanged
      ? 'User saved. Because the role changed, their old family links, course assignments, and enrollments were cleared.'
      : 'User saved.');
    res.redirect(`/admin/users/${target.id}`);
  });

  router.post('/users/:id/delete', loadUserParam, (req, res) => {
    const target = req.target;
    if (target.id === req.user.id) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect(`/admin/users/${target.id}`);
    }
    if (target.role === 'admin' && target.active && activeAdminCount() <= 1) {
      req.flash('error', 'The portal must keep at least one active admin.');
      return res.redirect(`/admin/users/${target.id}`);
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    req.flash('success', `${target.first_name} ${target.last_name} was permanently deleted.`);
    res.redirect('/admin/users');
  });

  router.post('/users/:id/links', loadUserParam, (req, res) => {
    const target = req.target;
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(positiveInt(req.body.other_id));
    const pair =
      target.role === 'parent' && other && other.role === 'student' ? [target.id, other.id]
      : target.role === 'student' && other && other.role === 'parent' ? [other.id, target.id]
      : null;
    if (!pair) req.flash('error', 'Links can only be made between a parent and a student.');
    else {
      db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(...pair);
      req.flash('success', `Linked with ${other.first_name} ${other.last_name}.`);
    }
    res.redirect(`/admin/users/${target.id}`);
  });

  router.post('/users/:id/links/:otherId/delete', loadUserParam, (req, res) => {
    const otherId = positiveInt(req.params.otherId);
    db.prepare(
      'DELETE FROM parent_students WHERE (parent_id = ? AND student_id = ?) OR (parent_id = ? AND student_id = ?)'
    ).run(req.target.id, otherId, otherId, req.target.id);
    req.flash('success', 'Link removed.');
    res.redirect(`/admin/users/${req.target.id}`);
  });

  // ---------- Programs ----------

  function readProgramForm(body) {
    const values = {
      name: text(body.name),
      description: optional(body.description),
      status: text(body.status),
      start_date: optional(body.start_date),
      end_date: optional(body.end_date),
    };
    const errors = [];
    if (!values.name) errors.push('Program name is required.');
    if (!PROGRAM_STATUSES.includes(values.status)) errors.push('Choose a valid status.');
    for (const field of ['start_date', 'end_date']) {
      if (values[field] && !DATE_PATTERN.test(values[field])) errors.push('Dates must be in YYYY-MM-DD format.');
    }
    if (values.start_date && values.end_date && values.end_date < values.start_date) {
      errors.push('End date must be on or after the start date.');
    }
    return { values, errors };
  }

  router.get('/programs', (req, res) => {
    const programs = db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM courses c WHERE c.program_id = p.id) AS course_count,
                (SELECT COUNT(*) FROM enrollments e JOIN courses c ON c.id = e.course_id
                  WHERE c.program_id = p.id AND e.status = 'active') AS enrolled_count
         FROM programs p ORDER BY p.start_date DESC, p.name`
      )
      .all();
    res.render('admin/programs/index', { title: 'Programs', programs });
  });

  router.get('/programs/new', (req, res) => {
    res.render('admin/programs/form', { title: 'New program', values: { status: 'draft' }, errors: [] });
  });

  router.post('/programs', (req, res) => {
    const { values, errors } = readProgramForm(req.body);
    if (errors.length) return res.status(422).render('admin/programs/form', { title: 'New program', values, errors });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO programs (name, description, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)')
      .run(values.name, values.description, values.status, values.start_date, values.end_date);
    req.flash('success', `${values.name} was created. Now add its courses.`);
    res.redirect(`/admin/programs/${lastInsertRowid}`);
  });

  function loadProgram(req, res, next) {
    const program = db.prepare('SELECT * FROM programs WHERE id = ?').get(positiveInt(req.params.id));
    if (!program) return notFound(res, 'Program');
    req.program = program;
    next();
  }

  function renderProgram(req, res, { values = req.program, errors = [], courseValues = {}, courseErrors = [], status = 200 } = {}) {
    const courses = db
      .prepare(
        `SELECT c.*, i.first_name AS instructor_first, i.last_name AS instructor_last,
                (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'active') AS enrolled_count
         FROM courses c LEFT JOIN users i ON i.id = c.instructor_id
         WHERE c.program_id = ? ORDER BY c.title`
      )
      .all(req.program.id);
    res.status(status).render('admin/programs/show', {
      title: req.program.name,
      program: req.program,
      values,
      errors,
      courses,
      courseValues,
      courseErrors,
      instructors: activeInstructors(db),
    });
  }

  router.get('/programs/:id', loadProgram, (req, res) => renderProgram(req, res));

  router.post('/programs/:id', loadProgram, (req, res) => {
    const { values, errors } = readProgramForm(req.body);
    if (errors.length) return renderProgram(req, res, { values: { ...req.program, ...values }, errors, status: 422 });
    db.prepare(
      "UPDATE programs SET name = ?, description = ?, status = ?, start_date = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(values.name, values.description, values.status, values.start_date, values.end_date, req.program.id);
    req.flash('success', 'Program saved.');
    res.redirect(`/admin/programs/${req.program.id}`);
  });

  router.post('/programs/:id/delete', loadProgram, (req, res) => {
    db.prepare('DELETE FROM programs WHERE id = ?').run(req.program.id);
    req.flash('success', `${req.program.name} and its courses were deleted.`);
    res.redirect('/admin/programs');
  });

  router.post('/programs/:id/courses', loadProgram, (req, res) => {
    const { values, errors } = readCourseForm(db, { ...req.body, program_id: req.program.id }, { admin: true });
    if (errors.length) return renderProgram(req, res, { courseValues: values, courseErrors: errors, status: 422 });
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO courses (program_id, title, description, schedule, location, capacity, instructor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.program.id, values.title, values.description, values.schedule, values.location, values.capacity, values.instructor_id);
    req.flash('success', `${values.title} was added.`);
    res.redirect(`/courses/${lastInsertRowid}`);
  });

  return router;
};
