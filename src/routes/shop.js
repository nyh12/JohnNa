const crypto = require('node:crypto');
const express = require('express');
const { salePrice, savings } = require('../pricing');
const { readCart, writeCart, setQty, priceCart } = require('../cart');
const { tx } = require('../db');

const PAGE_SIZE = 24;
const PAYMENT_METHODS = {
  gcash: 'GCash',
  bank: 'Bank transfer',
  cod: 'Cash on delivery',
};
const SORTS = {
  name: 'name COLLATE NOCASE ASC',
  price_asc: 'COALESCE(price_override, source_price) ASC',
  price_desc: 'COALESCE(price_override, source_price) DESC',
  new: 'created_at DESC, id DESC',
};
const VISIBLE = 'active = 1 AND hidden = 0';

module.exports = function shopRoutes(db) {
  const router = express.Router();

  router.use((req, res, next) => {
    const cart = readCart(req);
    res.locals.cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
    res.locals.categories = db
      .prepare(`SELECT category, COUNT(*) AS n FROM products WHERE ${VISIBLE} AND category IS NOT NULL
                GROUP BY category ORDER BY category`)
      .all();
    next();
  });

  router.get('/', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const category = String(req.query.category || '');
    const sort = SORTS[req.query.sort] ? req.query.sort : 'name';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    const where = [VISIBLE];
    const params = [];
    if (q) {
      for (const word of q.split(/\s+/)) {
        where.push("(name LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')");
        const like = `%${word.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
        params.push(like, like);
      }
    }
    if (category) {
      where.push('category = ?');
      params.push(category);
    }
    const whereSql = where.join(' AND ');
    const { n: total } = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE ${whereSql}`).get(...params);
    const products = db
      .prepare(`SELECT * FROM products WHERE ${whereSql} ORDER BY in_stock DESC, ${SORTS[sort]} LIMIT ? OFFSET ?`)
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .map((p) => withPrice(p, res.locals.settings));

    res.render('index', {
      title: category || 'All products',
      products,
      q,
      category,
      sort,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      added: req.query.added === '1',
    });
  });

  router.get('/product/:id', (req, res, next) => {
    const product = db.prepare(`SELECT * FROM products WHERE id = ? AND ${VISIBLE}`).get(req.params.id);
    if (!product) return next();
    res.render('product', {
      title: product.name,
      product: withPrice(product, res.locals.settings),
    });
  });

  router.post('/cart/add', (req, res) => {
    const id = String(parseInt(req.body.productId, 10));
    const product = db.prepare(`SELECT id FROM products WHERE id = ? AND ${VISIBLE} AND in_stock = 1`).get(id);
    if (product) {
      const cart = readCart(req);
      writeCart(res, setQty(cart, id, (cart[id] || 0) + (parseInt(req.body.qty, 10) || 1)));
    }
    res.redirect(req.body.next === 'cart' ? '/cart' : safeBack(req));
  });

  router.get('/cart', (req, res) => {
    res.render('cart', { title: 'Your cart', cart: priceCart(db, readCart(req), res.locals.settings) });
  });

  router.post('/cart/update', (req, res) => {
    let cart = readCart(req);
    for (const [key, value] of Object.entries(req.body)) {
      const m = key.match(/^qty_(\d+)$/);
      if (m) cart = setQty(cart, m[1], value);
    }
    if (req.body.remove) cart = setQty(cart, String(req.body.remove), 0);
    writeCart(res, cart);
    res.redirect('/cart');
  });

  router.get('/checkout', (req, res) => {
    const cart = priceCart(db, readCart(req), res.locals.settings);
    if (!cart.count) return res.redirect('/cart');
    res.render('checkout', { title: 'Checkout', cart, form: {}, errors: [], PAYMENT_METHODS });
  });

  router.post('/checkout', (req, res) => {
    const settings = res.locals.settings;
    const cart = priceCart(db, readCart(req), settings);
    if (!cart.count) return res.redirect('/cart');

    const form = pick(req.body, ['customer_name', 'phone', 'email', 'address', 'area', 'notes', 'payment_method']);
    const errors = validateCheckout(form, settings);
    const minOrder = Number(settings.min_order) || 0;
    if (cart.subtotal < minOrder) errors.push(`Minimum order is ₱${minOrder}.`);
    if (errors.length) {
      return res.status(400).render('checkout', { title: 'Checkout', cart, form, errors, PAYMENT_METHODS });
    }

    const code = orderCode();
    tx(db, () => {
      const { id } = db
        .prepare(
          `INSERT INTO orders (code, customer_name, phone, email, address, area, notes, payment_method,
                               subtotal, delivery_fee, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .get(code, form.customer_name, form.phone, form.email || null, form.address, form.area || null,
          form.notes || null, form.payment_method, cart.subtotal, cart.delivery, cart.total);
      const insertItem = db.prepare(
        `INSERT INTO order_items (order_id, product_id, name, source_url, source_price, unit_price, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of cart.lines.filter((x) => x.available)) {
        insertItem.run(id, l.product.id, l.product.name, l.product.url, l.product.source_price, l.unitPrice, l.qty);
      }
    });

    writeCart(res, {});
    res.cookie('order_access', code, { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 90 * 24 * 3600 * 1000 });
    res.redirect(`/order/${code}`);
  });

  router.get('/track', (req, res) => {
    res.render('track', { title: 'Track order', error: null, code: '', phone: '' });
  });

  router.post('/track', (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    const phone = normalizePhone(req.body.phone);
    const order = db.prepare('SELECT code, phone FROM orders WHERE code = ?').get(code);
    if (!order || normalizePhone(order.phone) !== phone) {
      return res.status(404).render('track', {
        title: 'Track order',
        error: 'No order found with that code and phone number.',
        code,
        phone: req.body.phone || '',
      });
    }
    res.cookie('order_access', code, { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 90 * 24 * 3600 * 1000 });
    res.redirect(`/order/${code}`);
  });

  router.get('/order/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    if (req.signedCookies.order_access !== code) return res.redirect('/track');
    const order = db.prepare('SELECT * FROM orders WHERE code = ?').get(code);
    if (!order) return res.redirect('/track');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.render('order', { title: `Order ${code}`, order, items, PAYMENT_METHODS });
  });

  router.get('/how-it-works', (req, res) => res.render('how', { title: 'How it works' }));

  return router;
};

function withPrice(product, settings) {
  const price = salePrice(product, settings);
  return { ...product, price, save: savings(product, price) };
}

function validateCheckout(form, settings) {
  const errors = [];
  if (!form.customer_name || form.customer_name.length < 2) errors.push('Please enter your full name.');
  if (!/^(\+?63|0)9\d{9}$/.test(normalizePhone(form.phone))) {
    errors.push('Please enter a valid PH mobile number (e.g. 09171234567).');
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push('Email address looks invalid.');
  if (!form.address || form.address.length < 10) errors.push('Please enter your complete delivery address.');
  const areas = String(settings.delivery_areas || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (areas.length && !areas.includes(form.area)) errors.push('Please choose a delivery area.');
  if (!PAYMENT_METHODS[form.payment_method]) errors.push('Please choose a payment method.');
  return errors;
}

function pick(body, keys) {
  return Object.fromEntries(keys.map((k) => [k, String(body[k] ?? '').trim().slice(0, 1000)]));
}

function normalizePhone(p) {
  return String(p || '').replace(/[\s\-()]/g, '');
}

function orderCode() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('');
  return `SR${ymd}-${rand}`;
}

function safeBack(req) {
  const ref = req.get('Referer');
  try {
    const u = new URL(ref);
    if (u.host === req.get('host')) {
      u.searchParams.set('added', '1');
      return u.pathname + u.search;
    }
  } catch {
    // no / bad referer
  }
  return '/?added=1';
}

module.exports.validateCheckout = validateCheckout;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
