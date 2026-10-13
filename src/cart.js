const { salePrice, deliveryFee } = require('./pricing');

const COOKIE = 'cart';
const MAX_QTY = 99;
const MAX_LINES = 100;

/** Cart is a signed cookie: { [productId]: qty } */
function readCart(req) {
  const raw = req.signedCookies?.[COOKIE];
  if (!raw || typeof raw !== 'object') return {};
  const cart = {};
  for (const [id, qty] of Object.entries(raw)) {
    const q = Math.min(MAX_QTY, Math.floor(Number(qty)));
    if (/^\d+$/.test(id) && q > 0) cart[id] = q;
  }
  return cart;
}

function writeCart(res, cart) {
  const trimmed = Object.fromEntries(Object.entries(cart).slice(0, MAX_LINES));
  res.cookie(COOKIE, trimmed, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function setQty(cart, productId, qty) {
  const q = Math.min(MAX_QTY, Math.max(0, Math.floor(Number(qty) || 0)));
  const next = { ...cart };
  if (q === 0) delete next[productId];
  else next[productId] = q;
  return next;
}

/**
 * Resolve cart lines against the database, always using current prices.
 * Lines whose product is gone, hidden or out of stock are flagged unavailable.
 */
function priceCart(db, cart, settings) {
  const ids = Object.keys(cart);
  const products = ids.length
    ? db.prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const byId = new Map(products.map((p) => [String(p.id), p]));

  const lines = [];
  for (const id of ids) {
    const product = byId.get(id);
    if (!product) continue;
    const available = product.active === 1 && product.hidden === 0 && product.in_stock === 1;
    const unitPrice = salePrice(product, settings);
    lines.push({ product, qty: cart[id], unitPrice, lineTotal: unitPrice * cart[id], available });
  }
  const subtotal = lines.filter((l) => l.available).reduce((s, l) => s + l.lineTotal, 0);
  const delivery = deliveryFee(subtotal, settings);
  return {
    lines,
    subtotal,
    delivery,
    total: subtotal + delivery,
    count: lines.filter((l) => l.available).reduce((s, l) => s + l.qty, 0),
    hasUnavailable: lines.some((l) => !l.available),
  };
}

module.exports = { readCart, writeCart, setQty, priceCart };
