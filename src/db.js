const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_SETTINGS = {
  markup_percent: '0', // sales commission % added on top of the S&R member price
  service_fee_per_item: '0', // flat PHP fee per unit
  round_to: '0', // round sale prices up to the nearest N pesos (0 = keep centavos)
  cap_at_regular: '1', // never charge more than S&R's own non-member price
  delivery_fee: '150',
  free_delivery_over: '5000', // 0 = never free
  min_order: '0',
  payment_instructions:
    'GCash: 09XX-XXX-XXXX (Juan Dela Cruz)\nBDO: 0000-0000-0000 (Juan Dela Cruz)\nPlease send proof of payment with your order code.',
  delivery_areas: 'Metro Manila\nCavite\nLaguna\nRizal\nBulacan',
  notice:
    'S&R member prices without a membership — we shop at S&R for you.',
};

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL UNIQUE,
      url TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      description TEXT,
      image TEXT,
      source_price REAL NOT NULL,             -- S&R member price
      regular_price REAL,                     -- S&R non-member price
      currency TEXT DEFAULT 'PHP',
      in_stock INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,      -- still listed on S&R
      hidden INTEGER NOT NULL DEFAULT 0,      -- hidden by admin
      price_override REAL,                    -- manual sale price
      last_seen TEXT,
      last_sync_id INTEGER,                   -- sync run that last saw it
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT NOT NULL,
      area TEXT,
      notes TEXT,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      subtotal REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      total REAL NOT NULL,
      admin_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      name TEXT NOT NULL,
      source_url TEXT,
      source_price REAL NOT NULL,             -- S&R member price
      regular_price REAL,                     -- S&R non-member price
      unit_price REAL NOT NULL,
      qty INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY,
      adapter TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      found INTEGER DEFAULT 0,
      created INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0,
      deactivated INTEGER DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations for databases created by earlier versions
  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!cols.includes('regular_price')) db.exec('ALTER TABLE products ADD COLUMN regular_price REAL');

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insert.run(k, v);
  return db;
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/** Run fn inside a transaction (node:sqlite has no helper for this). */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, getSettings, setSetting, tx, DEFAULT_SETTINGS };
