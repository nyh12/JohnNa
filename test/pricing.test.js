const test = require('node:test');
const assert = require('node:assert/strict');
const { salePrice, deliveryFee } = require('../src/pricing');

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
