const test = require('node:test');
const assert = require('node:assert/strict');
const { salePrice, savings, deliveryFee } = require('../src/pricing');
const { DEFAULT_SETTINGS } = require('../src/db');

const settings = { markup_percent: '15', service_fee_per_item: '0', round_to: '5', delivery_fee: '150', free_delivery_over: '5000' };

test('salePrice applies markup and rounds up', () => {
  assert.equal(salePrice({ source_price: 100 }, settings), 115);
  assert.equal(salePrice({ source_price: 1199 }, settings), 1380); // 1378.85 → 1380
});

test('salePrice adds per-item fee', () => {
  assert.equal(salePrice({ source_price: 100 }, { ...settings, service_fee_per_item: '20' }), 135);
});

test('price_override wins', () => {
  assert.equal(salePrice({ source_price: 100, price_override: 99 }, settings), 99);
});

test('deliveryFee is free above threshold', () => {
  assert.equal(deliveryFee(0, settings), 0);
  assert.equal(deliveryFee(4999, settings), 150);
  assert.equal(deliveryFee(5000, settings), 0);
  assert.equal(deliveryFee(10000, { ...settings, free_delivery_over: '0' }), 150);
});

test('defaults: 0% commission sells at exactly the S&R member price, centavos kept', () => {
  assert.equal(salePrice({ source_price: 565, regular_price: 593.25 }, DEFAULT_SETTINGS), 565);
  assert.equal(salePrice({ source_price: 123.75 }, DEFAULT_SETTINGS), 123.75);
});

test('commission % is applied to the member price', () => {
  const s = { ...DEFAULT_SETTINGS, markup_percent: '3' };
  assert.equal(salePrice({ source_price: 565, regular_price: 593.25 }, s), 581.95);
});

test('price is capped at the S&R non-member price unless disabled', () => {
  const s = { ...DEFAULT_SETTINGS, markup_percent: '10' };
  assert.equal(salePrice({ source_price: 565, regular_price: 593.25 }, s), 593.25);
  assert.equal(salePrice({ source_price: 565, regular_price: 593.25 }, { ...s, cap_at_regular: '0' }), 621.5);
  assert.equal(salePrice({ source_price: 565, regular_price: null }, s), 621.5);
});

test('savings vs non-member price', () => {
  assert.equal(savings({ regular_price: 593.25 }, 565), 28.25);
  assert.equal(savings({ regular_price: null }, 565), 0);
  assert.equal(savings({ regular_price: 500 }, 565), 0);
});
