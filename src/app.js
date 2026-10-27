const path = require('node:path');
const express = require('express');
const session = require('express-session');
const SqliteSessionStore = require('./lib/session-store');
const { loadUser } = require('./lib/auth');
const { securityHeaders, flash, csrf } = require('./lib/middleware');
const helpers = require('./lib/view-helpers');

function createApp({ db, sessionSecret = process.env.SESSION_SECRET, production = process.env.NODE_ENV === 'production' }) {
  if (!sessionSecret) {
    if (production) throw new Error('SESSION_SECRET must be set in production.');
    sessionSecret = 'dev-only-secret-change-me';
  }

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.disable('x-powered-by');
  if (production) app.set('trust proxy', 1);
  Object.assign(app.locals, helpers);

  app.use(securityHeaders);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      name: 'codecrew.sid',
      store: new SqliteSessionStore(db),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 8 * 60 * 60 * 1000 },
    })
  );
  app.use((req, res, next) => {
    // Defaults so every page (including early error pages) can render the header.
    Object.assign(res.locals, { path: req.path, currentUser: null, unreadCount: 0 });
    next();
  });
  app.use(flash);
  app.use(loadUser(db));
  app.use(csrf);

  app.use(require('./routes/auth')(db));
  app.use(require('./routes/dashboard')(db));
  app.use(require('./routes/programs')(db));
  app.use(require('./routes/courses')(db));
  app.use(require('./routes/parent')(db));
  app.use(require('./routes/messages')(db));
  app.use('/admin', require('./routes/admin')(db));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page not found', message: 'We could not find that page.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Something went wrong', message: 'Please try again in a moment.' });
  });

  return app;
}

module.exports = { createApp };
