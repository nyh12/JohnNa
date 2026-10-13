const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { setSetting, getSettings, DEFAULT_SETTINGS } = require('../db');
const { salePrice } = require('../pricing');
const { isSyncRunning } = require('../sync');

const ORDER_STATUSES = {
  pending: 'Awaiting payment',
  paid: 'Paid — to buy',
  purchased: 'Purchased at S&R',
  shipped: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

module.exports = function adminRoutes(db, { triggerSync }) {
  const router = express.Router();
  router.use(basicAuth);
  const csrfToken = crypto.createHmac('sha256', config.sessionSecret).update('admin-csrf').digest('hex');
  router.use((req, res, next) => {
    res.locals.csrfToken = csrfToken;
    res.locals.ORDER_STATUSES = ORDER_STATUSES;
    res.locals.syncRunning = isSyncRunning();
    if (req.method === 'POST' && !safeEqual(String(req.body._csrf || ''), csrfToken)) {
      return res.status(403).send('Invalid CSRF token');
    }
    next();
  });

  router.get('/', (req, res) => {
    const stats = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM products WHERE active = 1) AS active,
           (SELECT COUNT(*) FROM products WHERE active = 1 AND in_stock = 1 AND hidden = 0) AS listed,
           (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending,
           (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS toBuy,
           (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status NOT IN ('pending', 'cancelled')) AS revenue`
      )
      .get();
    const runs = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 10').all();
    const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10').all();
    res.render('admin/dashboard', { title: 'Dashboard', stats, runs, orders, adapter: config.scraperAdapter });
  });

  router.post('/sync', (req, res) => {
    triggerSync();
    res.redirect('/admin');
  });

  router.get('/products', (req, res) => {
    const q = String(req.query.q || '').trim();
    const filter = String(req.query.filter || 'all');
    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push('(name LIKE ? OR brand LIKE ? OR source_id = ?)');
      params.push(`%${q}%`, `%${q}%`, q);
    }
    if (filter === 'hidden') where.push('hidden = 1');
    if (filter === 'inactive') where.push('active = 0');
    if (filter === 'oos') where.push('in_stock = 0');
    if (filter === 'override') where.push('price_override IS NOT NULL');
    const settings = res.locals.settings;
    const products = db
      .prepare(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE LIMIT 200`)
      .all(...params)
      .map((p) => ({ ...p, price: salePrice(p, settings), autoPrice: salePrice({ ...p, price_override: null }, settings) }));
    res.render('admin/products', { title: 'Products', products, q, filter });
  });

  router.post('/products/:id', (req, res) => {
    const override = String(req.body.price_override || '').trim();
    db.prepare(`UPDATE products SET hidden = ?, price_override = ?, updated_at = datetime('now') WHERE id = ?`).run(
      req.body.hidden === '1' ? 1 : 0,
      override === '' ? null : Math.max(0, Number(override) || 0),
      req.params.id
    );
    let back = '/admin/products';
    try {
      const ref = new URL(req.get('Referer'));
      if (ref.pathname === '/admin/products') back += ref.search;
    } catch {
      // no referer
    }
    res.redirect(back);
  });

  router.get('/orders', (req, res) => {
    const status = ORDER_STATUSES[req.query.status] ? req.query.status : '';
    const orders = status
      ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 500').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all();
    res.render('admin/orders', { title: 'Orders', orders, status });
  });

  router.get('/orders/:id', (req, res, next) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return next();
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.render('admin/order', { title: `Order ${order.code}`, order, items });
  });

  router.post('/orders/:id', (req, res) => {
    const status = ORDER_STATUSES[req.body.status] ? req.body.status : null;
    db.prepare(
      `UPDATE orders SET status = COALESCE(?, status), admin_notes = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(status, String(req.body.admin_notes || '').slice(0, 2000), req.params.id);
    res.redirect(`/admin/orders/${req.params.id}`);
  });

  // Everything that has been paid for but not yet bought, merged per product —
  // this is what to pick up on the next S&R run.
  router.get('/shopping-list', (req, res) => {
    const items = db
      .prepare(
        `SELECT oi.product_id, oi.name, oi.source_url, MAX(oi.source_price) AS source_price,
                SUM(oi.qty) AS qty, GROUP_CONCAT(o.code, ', ') AS orders
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.status = 'paid'
         GROUP BY COALESCE(oi.product_id, oi.name)
         ORDER BY oi.name COLLATE NOCASE`
      )
      .all();
    const estimate = items.reduce((s, i) => s + i.source_price * i.qty, 0);
    res.render('admin/shopping-list', { title: 'Shopping list', items, estimate });
  });

  router.get('/settings', (req, res) => {
    res.render('admin/settings', { title: 'Settings', keys: Object.keys(DEFAULT_SETTINGS), saved: req.query.saved === '1' });
  });

  router.post('/settings', (req, res) => {
    const current = getSettings(db);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in req.body) setSetting(db, key, String(req.body[key]).replace(/\r\n/g, '\n'));
      else setSetting(db, key, current[key]);
    }
    res.redirect('/admin/settings?saved=1');
  });

  return router;
};

function basicAuth(req, res, next) {
  if (!config.adminPassword) return res.status(503).send('Admin is disabled: set ADMIN_PASSWORD.');
  const [scheme, encoded] = String(req.get('Authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString();
    const i = decoded.indexOf(':');
    if (safeEqual(decoded.slice(0, i), config.adminUser) && safeEqual(decoded.slice(i + 1), config.adminPassword)) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"').status(401).send('Authentication required');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports.ORDER_STATUSES = ORDER_STATUSES;
