const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProductPage, parseSitemap } = require('../src/scraper/jsonld');
const { mapShopifyProduct } = require('../src/scraper/shopify');

test('parses schema.org Product JSON-LD inside @graph', () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"BreadcrumbList","itemListElement":[{"name":"Home"},{"name":"Snacks"},{"name":"Nuts"}]},
      {"@type":"Product","name":"Mixed Nuts 1.13kg","sku":"12345","brand":{"@type":"Brand","name":"Kirkland"},
       "image":["/img/nuts.jpg"],"description":"<p>Tasty</p>",
       "offers":{"@type":"Offer","price":"1,199.00","priceCurrency":"PHP","availability":"https://schema.org/InStock"}}
    ]}</script></head><body></body></html>`;
  const p = parseProductPage(html, 'https://shop.example/products/nuts');
  assert.deepEqual(p, {
    sourceId: '12345',
    url: 'https://shop.example/products/nuts',
    name: 'Mixed Nuts 1.13kg',
    brand: 'Kirkland',
    category: 'Snacks',
    description: 'Tasty',
    image: 'https://shop.example/img/nuts.jpg',
    price: 1199,
    currency: 'PHP',
    inStock: true,
  });
});

test('handles AggregateOffer and out-of-stock', () => {
  const html = `<script type="application/ld+json">[{"@type":"Product","name":"Thing",
    "offers":{"@type":"AggregateOffer","lowPrice":250,"availability":"http://schema.org/OutOfStock"}}]</script>`;
  const p = parseProductPage(html, 'https://x/p/1');
  assert.equal(p.price, 250);
  assert.equal(p.inStock, false);
  assert.equal(p.sourceId, 'https://x/p/1');
});

test('falls back to OpenGraph product meta tags', () => {
  const html = `<meta property="og:title" content="Olive Oil 2L">
    <meta property="og:image" content="https://cdn/x.jpg">
    <meta property="product:price:amount" content="1099">`;
  const p = parseProductPage(html, 'https://x/p/2');
  assert.equal(p.name, 'Olive Oil 2L');
  assert.equal(p.price, 1099);
  assert.equal(p.image, 'https://cdn/x.jpg');
});

test('returns null for non-product pages', () => {
  assert.equal(parseProductPage('<html><title>About</title></html>', 'https://x/about'), null);
});

test('parses sitemap and sitemap index', () => {
  const idx = parseSitemap(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://x/sitemap_products_1.xml</loc></sitemap></sitemapindex>`);
  assert.deepEqual(idx, { isIndex: true, locs: ['https://x/sitemap_products_1.xml'] });
  const sm = parseSitemap(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://x/products/a</loc></url><url><loc>https://x/products/b</loc></url></urlset>`);
  assert.deepEqual(sm, { isIndex: false, locs: ['https://x/products/a', 'https://x/products/b'] });
});

test('maps Shopify products.json entries', () => {
  const p = mapShopifyProduct({
    id: 9, handle: 'nuts', title: 'Nuts', vendor: 'K', product_type: 'Food', body_html: '<b>Yum</b>',
    images: [{ src: 'https://cdn/n.jpg' }],
    variants: [{ sku: 'S1', price: '199.00', available: true }],
  }, 'https://shop');
  assert.equal(p.sourceId, 'S1');
  assert.equal(p.price, 199);
  assert.equal(p.url, 'https://shop/products/nuts');
  assert.equal(p.description, 'Yum');
  assert.equal(p.inStock, true);
});
