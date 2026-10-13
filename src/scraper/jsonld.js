const cheerio = require('cheerio');

/**
 * Extract a normalized product from a product page's HTML using
 * schema.org JSON-LD (what Google Shopping uses — nearly every e-commerce
 * platform emits it), falling back to OpenGraph / product meta tags.
 * Returns null when the page doesn't look like a product.
 */
function parseProductPage(html, url) {
  const $ = cheerio.load(html);
  const product = findJsonLdProduct($);
  const meta = (prop) =>
    $(`meta[property="${prop}"]`).attr('content') || $(`meta[name="${prop}"]`).attr('content');

  const offer = product ? pickOffer(product.offers) : null;
  const name = clean(product?.name) || clean(meta('og:title'));
  const priceRaw =
    offer?.price ?? offer?.lowPrice ?? meta('product:price:amount') ?? meta('og:price:amount');
  const price = parsePrice(priceRaw);
  if (!name || price == null) return null;

  const availability = String(offer?.availability || meta('product:availability') || '');
  const inStock = availability ? !/OutOfStock|SoldOut|Discontinued|out of stock/i.test(availability) : true;

  return {
    sourceId: String(product?.sku || product?.productID || product?.mpn || url),
    url,
    name,
    brand: clean(typeof product?.brand === 'object' ? product.brand?.name : product?.brand) || null,
    category: clean(normalizeCategory(product?.category)) || breadcrumbCategory($) || null,
    description: clean(stripTags(product?.description || meta('og:description') || '')).slice(0, 2000) || null,
    image: absolutize(firstImage(product?.image) || meta('og:image'), url),
    price,
    currency: offer?.priceCurrency || meta('product:price:currency') || 'PHP',
    inStock,
  };
}

function findJsonLdProduct($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collect(JSON.parse($(el).contents().text()), nodes);
    } catch {
      // ignore malformed blocks
    }
  });
  return nodes.find((n) => isType(n, 'Product')) || null;
}

function collect(value, out) {
  if (Array.isArray(value)) return value.forEach((v) => collect(v, out));
  if (!value || typeof value !== 'object') return;
  out.push(value);
  if (value['@graph']) collect(value['@graph'], out);
}

function isType(node, type) {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function pickOffer(offers) {
  if (!offers) return null;
  const list = Array.isArray(offers) ? offers : [offers];
  // AggregateOffer may nest individual offers
  const flat = list.flatMap((o) => (o && o.offers ? [o, ...[].concat(o.offers)] : [o]));
  return flat.find((o) => o && (o.price != null || o.lowPrice != null)) || flat[0] || null;
}

function breadcrumbCategory($) {
  let category = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const nodes = [];
      collect(JSON.parse($(el).contents().text()), nodes);
      const crumbs = nodes.find((n) => isType(n, 'BreadcrumbList'));
      const items = crumbs?.itemListElement;
      if (Array.isArray(items) && items.length >= 2) {
        // second-to-last crumb is usually the direct category of the product
        const it = items[items.length - 2];
        category = clean(it?.name || it?.item?.name) || category;
      }
    } catch {
      // ignore
    }
  });
  return category;
}

function normalizeCategory(c) {
  if (!c) return null;
  if (Array.isArray(c)) c = c[c.length - 1];
  if (typeof c === 'object') c = c.name;
  // "Food > Snacks > Chips" → "Snacks"? keep the top two levels readable: use first level.
  return String(c).split(/\s*[>/|]\s*/)[0];
}

function firstImage(img) {
  if (!img) return null;
  if (Array.isArray(img)) return firstImage(img[0]);
  if (typeof img === 'object') return img.url || img.contentUrl || null;
  return String(img);
}

function absolutize(src, base) {
  if (!src) return null;
  try {
    return new URL(src, base).href;
  } catch {
    return null;
  }
}

function parsePrice(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}

function clean(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract <loc> entries from a sitemap or sitemap index. */
function parseSitemap(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const isIndex = $('sitemapindex').length > 0;
  const locs = $(isIndex ? 'sitemap > loc' : 'url > loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { isIndex, locs };
}

module.exports = { parseProductPage, parseSitemap, parsePrice };
