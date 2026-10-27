const crypto = require('node:crypto');

function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  });
  next();
}

// One-time notices shown on the next page load ("Course updated", errors, etc.).
function flash(req, res, next) {
  res.locals.flash = req.session.flash || [];
  if (req.session.flash) delete req.session.flash;
  req.flash = (type, message) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };
  next();
}

// Every form posts a per-session token so other sites cannot submit forms on a user's behalf.
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const sent = Buffer.from(String((req.body && req.body._csrf) || ''));
  const expected = Buffer.from(req.session.csrfToken);
  if (sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();
  res.status(403).render('error', {
    title: 'Form expired',
    message: 'This form expired or was submitted from somewhere else. Go back, refresh the page, and try again.',
  });
}

module.exports = { securityHeaders, flash, csrf };
