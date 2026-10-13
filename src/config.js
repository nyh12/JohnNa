const path = require('node:path');

// Load .env if present (Node >= 21.7).
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // no .env file — rely on real environment variables
}

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'shop.db'),
  sessionSecret: env.SESSION_SECRET || 'change-me-in-production',
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: env.ADMIN_PASSWORD || '',
  storeName: env.STORE_NAME || 'S&R Pasabuy PH',

  // Which scraper adapter to use: "sitemap" | "shopify" | "mock"
  scraperAdapter: env.SCRAPER_ADAPTER || 'mock',
  snr: {
    baseUrl: (env.SNR_BASE_URL || 'https://www.snrshopping.com').replace(/\/$/, ''),
    sitemapUrl: env.SNR_SITEMAP_URL || '',
    productUrlPattern: env.SNR_PRODUCT_URL_PATTERN || '/products?/|/p/|product',
    requestDelayMs: Number(env.SNR_REQUEST_DELAY_MS || 1500),
    maxProducts: Number(env.SNR_MAX_PRODUCTS || 0), // 0 = unlimited
    userAgent:
      env.SNR_USER_AGENT ||
      'Mozilla/5.0 (compatible; SnRPasabuyBot/1.0; +contact-store-owner)',
  },

  // Hours between automatic syncs. 0 disables the scheduler.
  syncIntervalHours: Number(env.SYNC_INTERVAL_HOURS ?? 12),
};
