const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_PASSWORD = 'secret';
process.env.SESSION_SECRET = 'test-secret';
const { open } = require('../src/db');
const { runSync } = require('../src/sync');
const { createApp } = require('../src/server');

async function setup() {
  const db = open(':memory:');
  await runSync(db, { adapterName: 'mock', adapterOptions: {}, log: () => {} });
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base };
}

// Minimal cookie jar around fetch
function client(base) {
  const jar = new Map();
  return async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body = opts.body;
    if (body && typeof body === 'object') {
      body = new URLSearchParams(body).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(base + path, { ...opts, body, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
}

test('sync deactivates products missing from a later run', async () => {
  const db = open(':memory:');
  await runSync(db, { adapterName: 'mock', adapterOptions: {}, log: () => {} });
  const mock = require('../src/scraper/mock');
  const original = mock.fetchProducts;
  mock.fetchProducts = async function* () {
    let i = 0;
    for await (const p of original()) if (i++ !== 0) yield p; // drop first product
  };
  try {
    const stats = await runSync(db, { adapterName: 'mock', adapterOptions: {}, log: () => {} });
    assert.equal(stats.deactivated, 1);
    assert.equal(stats.created, 0);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 0').get();
    assert.equal(n, 1);
  } finally {
    mock.fetchProducts = original;
  }
});

test('browse → cart → checkout → admin', async (t) => {
  const { db, server, base } = await setup();
  t.after(() => server.close());
  const req = client(base);

  let res = await req('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Kirkland Signature Mixed Nuts/);

  const product = db.prepare("SELECT * FROM products WHERE in_stock = 1 ORDER BY id LIMIT 1").get();
  res = await req('/cart/add', { method: 'POST', body: { productId: product.id, qty: 2, next: 'cart' } });
  assert.equal(res.status, 302);

  res = await req('/cart');
  assert.match(await res.text(), new RegExp(product.name));

  // invalid checkout
  res = await req('/checkout', { method: 'POST', body: { customer_name: 'J', phone: '123' } });
  assert.equal(res.status, 400);

  res = await req('/checkout', {
    method: 'POST',
    body: {
      customer_name: 'Juan Dela Cruz', phone: '0917 123 4567', address: '123 Rizal St, Brgy. San Antonio',
      area: 'Metro Manila', payment_method: 'gcash',
    },
  });
  assert.equal(res.status, 302);
  const loc = res.headers.get('location');
  assert.match(loc, /^\/order\/SR\d{6}-[A-Z0-9]{5}$/);

  const order = db.prepare('SELECT * FROM orders').get();
  const items = db.prepare('SELECT * FROM order_items').all();
  assert.equal(items.length, 1);
  assert.equal(items[0].qty, 2);
  assert.equal(order.subtotal, items[0].unit_price * 2);
  assert.equal(order.total, order.subtotal + order.delivery_fee);

  res = await req(loc);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Payment instructions/);

  // a different visitor cannot see the order without code + phone
  const stranger = client(base);
  res = await stranger(loc);
  assert.equal(res.status, 302);
  res = await stranger('/track', { method: 'POST', body: { code: order.code, phone: '09171234567' } });
  assert.equal(res.headers.get('location'), loc);

  // admin
  res = await fetch(base + '/admin');
  assert.equal(res.status, 401);
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };
  res = await fetch(base + '/admin/orders/' + order.id, { headers: auth });
  const adminHtml = await res.text();
  assert.match(adminHtml, new RegExp(order.code));
  const csrf = adminHtml.match(/name="_csrf" value="([a-f0-9]+)"/)[1];

  res = await fetch(base + '/admin/orders/' + order.id, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'status=paid', redirect: 'manual',
  });
  assert.equal(res.status, 403, 'POST without CSRF token is rejected');

  res = await fetch(base + '/admin/orders/' + order.id, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `status=paid&_csrf=${csrf}`, redirect: 'manual',
  });
  assert.equal(res.status, 302);
  res = await fetch(base + '/admin/shopping-list', { headers: auth });
  assert.match(await res.text(), new RegExp(product.name));
});

test('admin can change the sales commission and shop prices follow', async (t) => {
  const { db, server, base } = await setup();
  t.after(() => server.close());
  const product = db.prepare('SELECT * FROM products WHERE in_stock = 1 ORDER BY id LIMIT 1').get();
  const auth = { Authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') };

  // default 0%: shop shows exactly the member price
  let html = await (await fetch(`${base}/product/${product.id}`)).text();
  assert.ok(html.includes(new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(product.source_price)));
  assert.match(html, /S&amp;R member price/);

  const dash = await (await fetch(base + '/admin', { headers: auth })).text();
  const csrf = dash.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const post = (v) => fetch(base + '/admin/commission', {
    method: 'POST', redirect: 'manual',
    headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `markup_percent=${v}&_csrf=${csrf}`,
  });

  assert.equal((await post('abc')).headers.get('location'), '/admin?commission=invalid');
  assert.equal((await post('2')).headers.get('location'), '/admin?commission=saved');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'markup_percent'").get().value, '2');

  const expected = Math.ceil(product.source_price * 1.02 * 100 - 1e-6) / 100;
  html = await (await fetch(`${base}/product/${product.id}`)).text();
  assert.ok(html.includes(new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(expected)));
});
