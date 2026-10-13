// Run one catalogue sync from the command line: `npm run sync`
const config = require('../src/config');
const { open } = require('../src/db');
const { runSync } = require('../src/sync');

const db = open(config.dbPath);
runSync(db, { adapterName: config.scraperAdapter, adapterOptions: config.snr })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });
