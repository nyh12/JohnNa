/**
 * Sale price shown to customers, derived from the S&R member price.
 *   price = member price × (1 + commission%) + fee per item, rounded up
 * capped at S&R's own non-member price (when enabled) so buying through us
 * is never more expensive than buying from S&R directly as a non-member.
 */
function salePrice(product, settings) {
  if (product.price_override != null) return Number(product.price_override);
  const commission = Number(settings.markup_percent) || 0;
  const fee = Number(settings.service_fee_per_item) || 0;
  const roundTo = Number(settings.round_to) || 0;
  const raw = Number(product.source_price) * (1 + commission / 100) + fee;
  // Subtract a tiny epsilon so float noise (e.g. 115.00000000001) doesn't bump a whole step.
  let price = roundTo > 0 ? Math.ceil(raw / roundTo - 1e-9) * roundTo : Math.ceil(raw * 100 - 1e-6) / 100;
  const regular = Number(product.regular_price) || 0;
  if (settings.cap_at_regular === '1' && regular > 0 && price > regular) price = regular;
  return price;
}

/** How much a customer saves vs. S&R's non-member price (0 if unknown). */
function savings(product, price) {
  const regular = Number(product.regular_price) || 0;
  return regular > price ? Math.round((regular - price) * 100) / 100 : 0;
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

module.exports = { salePrice, savings, deliveryFee, formatPeso };
