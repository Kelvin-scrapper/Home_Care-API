const fs = require('fs');
const path = require('path');
const Upload = require('../models/Upload');

// Unattached uploads are kept this long so a draft saved on a phone can still
// be submitted days later with its files.
const RETENTION_DAYS = Number(process.env.UPLOAD_RETENTION_DAYS) || 7;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

async function cleanupUploads(retentionDays = RETENTION_DAYS) {
  const storageNames = await Upload.deleteUnattachedOlderThan(retentionDays);
  await Promise.all(
    storageNames.map((name) =>
      fs.promises.unlink(path.join(Upload.UPLOAD_DIR, name)).catch((err) => {
        if (err.code !== 'ENOENT') console.error(`[uploads] could not delete ${name}:`, err.message);
      })
    )
  );
  if (storageNames.length > 0) {
    console.info(`[uploads] removed ${storageNames.length} unattached upload(s) older than ${retentionDays} days`);
  }
  return storageNames.length;
}

function startUploadCleanup() {
  const run = () => cleanupUploads().catch((err) => console.error('[uploads] cleanup failed:', err));
  run();
  setInterval(run, INTERVAL_MS).unref();
}

module.exports = { cleanupUploads, startUploadCleanup };
