const { getAdapter } = require('./scraper');

// If a run finds fewer than this share of the currently active products,
// assume the scrape was partial (site change, blocking…) and don't delist anything.
const MIN_COVERAGE_TO_DEACTIVATE = 0.5;

let running = false;

/**
 * Pull the catalogue from S&R via the configured adapter and upsert it.
 * Products that vanished from S&R are marked inactive (not deleted, so old
 * orders keep their references).
 */
async function runSync(db, { adapterName, adapterOptions, log = console.log }) {
  if (running) throw new Error('A sync is already running');
  running = true;
  const run = db
    .prepare('INSERT INTO sync_runs (adapter) VALUES (?) RETURNING id')
    .get(adapterName);
  const stats = { found: 0, created: 0, updated: 0, deactivated: 0 };

  const select = db.prepare('SELECT id FROM products WHERE source_id = ?');
  const insert = db.prepare(`
    INSERT INTO products (source_id, url, name, brand, category, description, image,
                          source_price, currency, in_stock, active, last_seen, last_sync_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?)`);
  const update = db.prepare(`
    UPDATE products SET url = ?, name = ?, brand = ?, category = ?, description = ?, image = ?,
      source_price = ?, currency = ?, in_stock = ?, active = 1, last_seen = datetime('now'),
      last_sync_id = ?, updated_at = datetime('now')
    WHERE id = ?`);

  try {
    const adapter = getAdapter(adapterName);
    for await (const p of adapter.fetchProducts(adapterOptions, log)) {
      stats.found++;
      const fields = [
        p.url, p.name, p.brand, p.category, p.description, p.image,
        p.price, p.currency || 'PHP', p.inStock ? 1 : 0,
      ];
      const existing = select.get(p.sourceId);
      if (existing) {
        update.run(...fields, run.id, existing.id);
        stats.updated++;
      } else {
        insert.run(p.sourceId, ...fields, run.id);
        stats.created++;
      }
      if (stats.found % 100 === 0) log(`…${stats.found} products processed`);
    }

    const { n: previouslyActive } = db
      .prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND last_sync_id IS NOT ?')
      .get(run.id);
    const coverage = stats.found / Math.max(1, stats.found + previouslyActive);
    if (stats.found > 0 && (previouslyActive === 0 || coverage >= MIN_COVERAGE_TO_DEACTIVATE)) {
      stats.deactivated = Number(
        db
          .prepare(
            `UPDATE products SET active = 0, updated_at = datetime('now')
             WHERE active = 1 AND last_sync_id IS NOT ?`
          )
          .run(run.id).changes
      );
    } else if (previouslyActive > 0) {
      log(`only ${stats.found} found vs ${previouslyActive} unseen — skipping delisting`);
    }

    finish(db, run.id, stats, null);
    log(`sync done: ${JSON.stringify(stats)}`);
    return stats;
  } catch (err) {
    finish(db, run.id, stats, err.message);
    throw err;
  } finally {
    running = false;
  }
}

function finish(db, id, s, error) {
  db.prepare(
    `UPDATE sync_runs SET finished_at = datetime('now'), found = ?, created = ?, updated = ?,
       deactivated = ?, error = ? WHERE id = ?`
  ).run(s.found, s.created, s.updated, s.deactivated, error, id);
}

function isSyncRunning() {
  return running;
}

module.exports = { runSync, isSyncRunning };
