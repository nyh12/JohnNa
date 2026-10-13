const { fetchText, sleep } = require('./http');

/**
 * Fast adapter for Shopify storefronts: the public /products.json endpoint
 * returns 250 products per page with prices and stock flags.
 */
async function* fetchProducts(opts) {
  const { baseUrl, userAgent, requestDelayMs, maxProducts } = opts;
  let count = 0;
  for (let page = 1; ; page++) {
    const body = await fetchText(`${baseUrl}/products.json?limit=250&page=${page}`, {
      userAgent,
      accept: 'application/json',
    });
    const { products = [] } = JSON.parse(body);
    if (!products.length) return;
    for (const p of products) {
      const product = mapShopifyProduct(p, baseUrl);
      if (!product) continue;
      yield product;
      if (maxProducts && ++count >= maxProducts) return;
    }
    await sleep(requestDelayMs);
  }
}

function mapShopifyProduct(p, baseUrl) {
  const variant = (p.variants || []).find((v) => v.available) || (p.variants || [])[0];
  const price = variant ? Number(variant.price) : NaN;
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    sourceId: String(variant.sku || p.id),
    url: `${baseUrl}/products/${p.handle}`,
    name: p.title,
    brand: p.vendor || null,
    category: p.product_type || null,
    description: String(p.body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000) || null,
    image: p.images?.[0]?.src || null,
    price,
    currency: 'PHP',
    inStock: (p.variants || []).some((v) => v.available),
  };
}

module.exports = { fetchProducts, mapShopifyProduct };
