const crypto = require('node:crypto');

const ROLES = ['student', 'parent', 'instructor', 'admin'];
// Only these roles may create their own account; instructors and admins are created by an admin.
const SELF_REGISTER_ROLES = ['student', 'parent'];
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function passwordProblem(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// Attaches the signed-in user (if any) to req.user and res.locals.currentUser.
function loadUser(db) {
  const findUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL');
  return (req, res, next) => {
    req.user = null;
    res.locals.currentUser = null;
    res.locals.unreadCount = 0;
    const id = req.session && req.session.userId;
    if (!id) return next();
    const user = findUser.get(id);
    if (!user || !user.active) {
      delete req.session.userId;
      return next();
    }
    req.user = user;
    res.locals.currentUser = user;
    if (user.role !== 'student') res.locals.unreadCount = unread.get(user.id).n;
    next();
  };
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  req.flash('info', 'Please sign in to continue.');
  res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireLogin(req, res, next);
    if (roles.includes(req.user.role)) return next();
    res.status(403).render('error', { title: 'Not allowed', message: 'Your account does not have access to that page.' });
  };
}

module.exports = {
  ROLES,
  SELF_REGISTER_ROLES,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
  passwordProblem,
  loadUser,
  requireLogin,
  requireRole,
};
