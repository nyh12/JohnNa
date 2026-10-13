/**
 * Sale price shown to customers, derived from the S&R shelf price.
 * price = ceil((source * (1 + markup%) + feePerItem) / roundTo) * roundTo
 */
function salePrice(product, settings) {
  if (product.price_override != null) return Number(product.price_override);
  const markup = Number(settings.markup_percent) || 0;
  const fee = Number(settings.service_fee_per_item) || 0;
  const roundTo = Number(settings.round_to) || 1;
  const raw = Number(product.source_price) * (1 + markup / 100) + fee;
  // Subtract a tiny epsilon so float noise (e.g. 115.00000000001) doesn't bump a whole step.
  return Math.ceil(raw / roundTo - 1e-9) * roundTo;
}

function deliveryFee(subtotal, settings) {
  const fee = Number(settings.delivery_fee) || 0;
  const freeOver = Number(settings.free_delivery_over) || 0;
  if (subtotal <= 0) return 0;
  if (freeOver > 0 && subtotal >= freeOver) return 0;
  return fee;
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
function formatPeso(n) {
  return peso.format(Number(n) || 0);
}

module.exports = { salePrice, deliveryFee, formatPeso };
