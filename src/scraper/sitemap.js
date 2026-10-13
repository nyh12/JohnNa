const { fetchText, sleep } = require('./http');
const { parseProductPage, parseSitemap } = require('./jsonld');

/**
 * Platform-agnostic adapter: walk the site's sitemap, visit every product
 * URL and read its schema.org Product data.
 */
async function* fetchProducts(opts, log = console.log) {
  const { baseUrl, userAgent, requestDelayMs, maxProducts } = opts;
  const pattern = new RegExp(opts.productUrlPattern, 'i');
  const roots = opts.sitemapUrl ? [opts.sitemapUrl] : await discoverSitemaps(baseUrl, userAgent);

  const productUrls = new Set();
  const seenSitemaps = new Set();
  const queue = [...roots];
  while (queue.length) {
    const sm = queue.shift();
    if (seenSitemaps.has(sm)) continue;
    seenSitemaps.add(sm);
    let xml;
    try {
      xml = await fetchText(sm, { userAgent, accept: 'application/xml,text/xml,*/*' });
    } catch (err) {
      log(`sitemap skipped: ${sm} (${err.message})`);
      continue;
    }
    const { isIndex, locs } = parseSitemap(xml);
    if (isIndex) queue.push(...locs);
    else locs.filter((u) => pattern.test(new URL(u).pathname)).forEach((u) => productUrls.add(u));
  }
  log(`found ${productUrls.size} product URLs in ${seenSitemaps.size} sitemap(s)`);

  let count = 0;
  for (const url of productUrls) {
    if (maxProducts && count >= maxProducts) break;
    try {
      const html = await fetchText(url, { userAgent });
      const product = parseProductPage(html, url);
      if (product) {
        count++;
        yield product;
      }
    } catch (err) {
      log(`product skipped: ${url} (${err.message})`);
    }
    await sleep(requestDelayMs);
  }
}

async function discoverSitemaps(baseUrl, userAgent) {
  try {
    const robots = await fetchText(`${baseUrl}/robots.txt`, { userAgent, retries: 1 });
    const found = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
    if (found.length) return found;
  } catch {
    // fall through to default location
  }
  return [`${baseUrl}/sitemap.xml`];
}

module.exports = { fetchProducts };
