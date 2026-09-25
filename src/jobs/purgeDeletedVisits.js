const Visit = require('../models/Visit');

// How long a deleted visit stays restorable. After this it's removed for
// good; its files follow via the upload cleanup job.
const RETENTION_DAYS = Number(process.env.VISIT_TRASH_RETENTION_DAYS) || 30;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

async function purgeDeletedVisits(retentionDays = RETENTION_DAYS) {
  const ids = await Visit.purgeDeletedOlderThan(retentionDays);
  if (ids.length > 0) {
    console.info(`[visits] permanently removed ${ids.length} visit(s) deleted over ${retentionDays} days ago: ${ids.join(', ')}`);
  }
  return ids;
}

function startDeletedVisitPurge() {
  const run = () => purgeDeletedVisits().catch((err) => console.error('[visits] purge failed:', err));
  run();
  setInterval(run, INTERVAL_MS).unref();
}

module.exports = { RETENTION_DAYS, purgeDeletedVisits, startDeletedVisitPurge };
