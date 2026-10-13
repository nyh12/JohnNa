const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { open, getSettings } = require('./db');
const { formatPeso } = require('./pricing');
const { runSync, isSyncRunning } = require('./sync');

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 1);
  app.locals.db = db;
  app.locals.formatPeso = formatPeso;
  app.locals.storeName = config.storeName;

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser(config.sessionSecret));
  app.use((req, res, next) => {
    res.locals.settings = getSettings(db);
    res.locals.path = req.path;
    next();
  });

  app.use('/admin', require('./routes/admin')(db, { triggerSync: () => startSync(db) }));
  app.use('/', require('./routes/shop')(db));

  app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'Page not found.' }));
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Please try again.' });
  });
  return app;
}

function startSync(db) {
  if (isSyncRunning()) return false;
  runSync(db, {
    adapterName: config.scraperAdapter,
    adapterOptions: config.snr,
    log: (m) => console.log(`[sync] ${m}`),
  }).catch((err) => console.error('[sync] failed:', err.message));
  return true;
}

if (require.main === module) {
  const db = open(config.dbPath);
  const app = createApp(db);

  if (!config.adminPassword) console.warn('ADMIN_PASSWORD is not set — /admin is disabled.');

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n === 0) startSync(db); // first boot: fill the catalogue
  if (config.syncIntervalHours > 0) {
    setInterval(() => startSync(db), config.syncIntervalHours * 3600 * 1000).unref();
  }

  app.listen(config.port, () => {
    console.log(`${config.storeName} running on http://localhost:${config.port} (adapter: ${config.scraperAdapter})`);
  });
}

module.exports = { createApp };
