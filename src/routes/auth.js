const express = require('express');
const { SELF_REGISTER_ROLES, verifyPassword, hashPassword, passwordProblem, requireLogin } = require('../lib/auth');
const { readUserForm, validateUser, createUser } = require('../lib/users');
const { text, optional, EMAIL_PATTERN } = require('../lib/forms');

module.exports = (db) => {
  const router = express.Router();

  function signIn(req, user, done) {
    // A fresh session id on sign-in prevents session fixation.
    const pendingFlash = req.session.flash;
    req.session.regenerate((err) => {
      if (err) return done(err);
      req.session.userId = user.id;
      if (pendingFlash) req.session.flash = pendingFlash;
      req.session.save(done);
    });
  }

  router.get('/', (req, res) => res.redirect(req.user ? '/dashboard' : '/login'));

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('login', { title: 'Sign in', identifier: '' });
  });

  router.post('/login', (req, res, next) => {
    const identifier = text(req.body.identifier);
    const password = text(req.body.password);
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.locals.flash = [{ type: 'error', message: 'That username/email and password do not match.' }];
      return res.status(401).render('login', { title: 'Sign in', identifier });
    }
    if (!user.active) {
      res.locals.flash = [{ type: 'error', message: 'This account is turned off. Please contact CodeCrew staff.' }];
      return res.status(403).render('login', { title: 'Sign in', identifier });
    }
    signIn(req, user, (err) => (err ? next(err) : res.redirect('/dashboard')));
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('codecrew.sid');
      res.redirect('/login');
    });
  });

  router.get('/register', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('register', { title: 'Create an account', values: { role: text(req.query.role) || 'parent' }, errors: [] });
  });

  router.post('/register', (req, res, next) => {
    const values = readUserForm(req.body);
    const errors = validateUser(db, values, { passwordRequired: true });
    if (!SELF_REGISTER_ROLES.includes(values.role)) {
      errors.unshift('Only students and parents can create their own accounts. CodeCrew staff set up instructor accounts.');
    }
    if (values.password !== text(req.body.password_confirm)) errors.push('Passwords do not match.');
    if (errors.length) {
      return res.status(422).render('register', { title: 'Create an account', values, errors });
    }
    const id = createUser(db, values);
    req.flash('success', 'Welcome to CodeCrew! Your account is ready.');
    signIn(req, { id }, (err) => (err ? next(err) : res.redirect('/dashboard')));
  });

  router.get('/account', requireLogin, (req, res) => {
    res.render('account', { title: 'My account', values: req.user, errors: [] });
  });

  router.post('/account', requireLogin, (req, res) => {
    const user = req.user;
    const values = {
      ...user,
      first_name: text(req.body.first_name),
      last_name: text(req.body.last_name),
      email: optional(req.body.email),
      phone: optional(req.body.phone),
    };
    const errors = [];
    if (!values.first_name || !values.last_name) errors.push('First and last name are required.');
    if (values.email && !EMAIL_PATTERN.test(values.email)) errors.push('Enter a valid email address.');
    if (!values.email && user.role !== 'student') errors.push('Email is required for your account type.');
    if (values.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(values.email, user.id)) {
      errors.push('An account with that email already exists.');
    }

    const newPassword = text(req.body.new_password);
    if (newPassword) {
      if (!verifyPassword(text(req.body.current_password), user.password_hash)) errors.push('Your current password is incorrect.');
      const problem = passwordProblem(newPassword);
      if (problem) errors.push(problem);
      if (newPassword !== text(req.body.new_password_confirm)) errors.push('New passwords do not match.');
    }

    if (errors.length) return res.status(422).render('account', { title: 'My account', values, errors });

    db.prepare(
      "UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(values.first_name, values.last_name, values.email, values.phone, user.id);
    if (newPassword) {
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
        hashPassword(newPassword),
        user.id
      );
    }
    req.flash('success', 'Your account was updated.');
    res.redirect('/account');
  });

  return router;
};
