const cheerio = require('cheerio');
const { fetchText, sleep } = require('./http');
const { MEMBER_PRICE, NON_MEMBER_PRICE } = require('./price-labels');

/**
 * Adapter for www.snrshopping.com.
 *
 * S&R lists every product with two prices, e.g.
 *   "Member Price ₱ 565.00  Non-member Price: ₱ 593.25"
 * and groups products under /category/<slug> pages. We discover category
 * links from the home page, walk each category's pagination and read the
 * product cards. Cards are located by their "Member Price" label rather than
 * by CSS class names, so minor theme changes on S&R's side don't break it.
 */

// Promo listings that repeat products from real categories. Crawled last so
// products get their real category name.
const PROMO_CATEGORY = /members?-value|best-deal|new-arrival|promo|sale|clearance|featured/i;
const MAX_PAGES_PER_CATEGORY = 200;

async function* fetchProducts(opts, log = console.log) {
  const { baseUrl, userAgent, requestDelayMs, maxProducts } = opts;
  const get = (url) => fetchText(url, { userAgent });

  const categories = opts.categoryUrls?.length
    ? opts.categoryUrls
    : discoverCategories(await get(baseUrl + '/'), baseUrl);
  categories.sort((a, b) => PROMO_CATEGORY.test(a) - PROMO_CATEGORY.test(b));
  log(`found ${categories.length} categories`);
  if (!categories.length) throw new Error('No /category/ links found on the S&R home page');

  const seenProducts = new Set();
  let count = 0;
  for (const categoryUrl of categories) {
    const queue = [categoryUrl];
    const visited = new Set();
    let categoryName = null;
    while (queue.length && visited.size < MAX_PAGES_PER_CATEGORY) {
      const pageUrl = queue.shift();
      if (visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      let html;
      try {
        html = await get(pageUrl);
      } catch (err) {
        log(`page skipped: ${pageUrl} (${err.message})`);
        continue;
      }
      const page = parseListingPage(html, pageUrl);
      categoryName ||= page.title || titleFromSlug(categoryUrl);
      for (const next of page.nextPages) if (!visited.has(next)) queue.push(next);

      for (const p of page.products) {
        if (seenProducts.has(p.sourceId)) continue;
        seenProducts.add(p.sourceId);
        yield { ...p, category: categoryName };
        if (maxProducts && ++count >= maxProducts) return;
      }
      await sleep(requestDelayMs);
    }
    log(`category done: ${categoryName} (${visited.size} page(s), ${seenProducts.size} products so far)`);
  }
}

function discoverCategories(html, baseUrl) {
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href]').each((_, a) => {
    const u = resolve($(a).attr('href'), baseUrl);
    if (u && sameSite(u, baseUrl) && /^\/category\/[^/]+\/?$/i.test(u.pathname)) {
      urls.add(u.origin + u.pathname.replace(/\/$/, ''));
    }
  });
  return [...urls];
}

/** Parse a category / search listing (also works on a single product page). */
function parseListingPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const cards = new Set();

  $('body *').each((_, el) => {
    const ownText = $(el).contents().filter((_, n) => n.type === 'text').text();
    if (countMemberLabels(ownText) !== 1) return;
    // Climb to the largest ancestor that still holds exactly one product.
    let node = el;
    while (node.parent && node.parent.type === 'tag' && node.parent.name !== 'body') {
      const parent = $(node.parent);
      // Stop before swallowing a second product or page chrome (lone product on a page).
      if (countMemberLabels(parent.text()) > 1) break;
      if (parent.is('main, nav, header, footer') || parent.find('h1, nav, header, footer').length) break;
      if (parent.find('a[href]').length > 12) break;
      node = node.parent;
    }
    cards.add(node);
  });

  const products = [];
  for (const card of cards) {
    const p = parseCard($, $(card), pageUrl);
    if (p) products.push(p);
  }

  const title = clean($('h1').first().text()) || null;
  return { products, nextPages: paginationLinks($, pageUrl), title };
}

const MEMBER_LABEL = /(non[-\s]?)?member'?s?\s*price/gi;
function countMemberLabels(text) {
  let n = 0;
  for (const m of String(text).matchAll(MEMBER_LABEL)) if (!m[1]) n++;
  return n;
}


function parseCard($, card, pageUrl) {
  const text = clean(card.text());
  const member = toNumber(text.match(MEMBER_PRICE)?.[1]);
  if (member == null) return null;
  const nonMember = toNumber(text.match(NON_MEMBER_PRICE)?.[1]);

  // Product link: first link that isn't a category / cart / javascript link.
  let url = null;
  let linkName = '';
  card.find('a[href]').each((_, a) => {
    const u = resolve($(a).attr('href'), pageUrl);
    if (!u || !sameSite(u, pageUrl) || /^\/(category|cart|checkout|login|account)\b/i.test(u.pathname) || u.pathname === '/') return;
    url ||= u.origin + u.pathname;
    const t = clean($(a).attr('title') || $(a).text());
    if (t.length > linkName.length && !/member'?s?\s*price/i.test(t)) linkName = t;
  });

  const img = card.find('img').first();
  const name =
    clean(card.find('[class*="name" i], [class*="title" i], h2, h3, h4, h5').first().text()) ||
    linkName ||
    clean(img.attr('alt'));
  if (!name || countMemberLabels(name)) return null;

  const idAttr = card
    .find('[data-product-id], [data-product_id], [data-sku], [data-id]')
    .addBack('[data-product-id], [data-product_id], [data-sku], [data-id]')
    .first();
  const sourceId =
    idAttr.attr('data-sku') || idAttr.attr('data-product-id') || idAttr.attr('data-product_id') ||
    idAttr.attr('data-id') || (url ? new URL(url).pathname : null) || `name:${name}`;

  return {
    sourceId: String(sourceId),
    url,
    name,
    brand: null,
    description: null,
    image: imageSrc(img, pageUrl),
    price: member,
    regularPrice: nonMember != null && nonMember > member ? nonMember : null,
    currency: 'PHP',
    inStock: !/out of stock|sold out|not available|unavailable/i.test(text),
  };
}

function paginationLinks($, pageUrl) {
  const current = new URL(pageUrl);
  const out = new Set();
  $('a[href], link[rel="next"]').each((_, el) => {
    const u = resolve($(el).attr('href'), pageUrl);
    if (!u || u.origin !== current.origin || u.pathname.replace(/\/$/, '') !== current.pathname.replace(/\/$/, '')) return;
    if (/^\d+$/.test(u.searchParams.get('page') || u.searchParams.get('p') || '')) {
      u.hash = '';
      out.add(u.href);
    }
  });
  out.delete(current.href);
  return [...out];
}

function imageSrc(img, base) {
  if (!img.length) return null;
  const candidates = [
    img.attr('data-src'), img.attr('data-original'), img.attr('data-lazy'),
    img.attr('src'), (img.attr('srcset') || img.attr('data-srcset') || '').split(/[\s,]+/)[0],
  ];
  for (const c of candidates) {
    if (c && !c.startsWith('data:')) return resolve(c, base)?.href || null;
  }
  return null;
}

function resolve(href, base) {
  if (!href || /^(javascript|mailto|tel):|^#/i.test(href)) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

const bareHost = (h) => h.replace(/^www\./, '');
function sameSite(u, base) {
  return bareHost(u.hostname) === bareHost(new URL(base).hostname);
}

function titleFromSlug(url) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function toNumber(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  fetchProducts,
  discoverCategories,
  parseListingPage,
  countMemberLabels,
};
