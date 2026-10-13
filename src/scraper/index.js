const adapters = {
  snr: require('./snr'),
  sitemap: require('./sitemap'),
  shopify: require('./shopify'),
  mock: require('./mock'),
};

function getAdapter(name) {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Unknown SCRAPER_ADAPTER "${name}". Use one of: ${Object.keys(adapters).join(', ')}`);
  }
  return adapter;
}

module.exports = { getAdapter, adapterNames: Object.keys(adapters) };
