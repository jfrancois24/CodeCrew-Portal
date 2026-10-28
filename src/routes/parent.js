const express = require('express');
const { requireRole } = require('../lib/auth');
const { readUserForm, validateUser, createUser } = require('../lib/users');
const { transaction } = require('../db');
const { text } = require('../lib/forms');

module.exports = (db) => {
  const router = express.Router();

  router.get('/children/new', requireRole('parent'), (req, res) => {
    res.render('parent/child-new', { title: 'Add a child', values: { last_name: req.user.last_name }, errors: [] });
  });

  // Parents create their child's student account, which is linked to them automatically.
  router.post('/children', requireRole('parent'), (req, res) => {
    const values = { ...readUserForm(req.body), role: 'student' };
    const errors = validateUser(db, values, { passwordRequired: true });
    if (values.password !== text(req.body.password_confirm)) errors.push('Passwords do not match.');
    if (errors.length) return res.status(422).render('parent/child-new', { title: 'Add a child', values, errors });

    transaction(db, () => {
      const childId = createUser(db, values);
      db.prepare('INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(req.user.id, childId);
    });
    req.flash('success', `${values.first_name}'s account was created. They can sign in with the username "${values.username}".`);
    res.redirect('/dashboard');
  });

  return router;
};
