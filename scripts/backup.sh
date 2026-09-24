#!/usr/bin/env bash
# Backs up the Postgres database and the Media & Evidence uploads of the
# docker-compose deployment, keeping the last KEEP_DAYS days.
#
# Run on the VPS from anywhere (it cds to the repo root). Nightly via cron:
#   crontab -e
#   30 2 * * * /path/to/Home_Care-API/scripts/backup.sh >> $HOME/bheco-backup.log 2>&1
#
# Settings (environment variables):
#   BACKUP_DIR  where backups go          (default: $HOME/bheco-backups)
#   KEEP_DAYS   delete backups older than (default: 14)
# Copy BACKUP_DIR off the server too (rclone, scp, ...): a backup on the same
# disk won't survive losing the VPS.
#
# Restore (stop writes first; replaces current data):
#   docker compose exec -T db pg_restore -U postgres -d home_care_api --clean --if-exists < db-<stamp>.dump
#   docker compose exec -T api sh -c 'tar -C /app/uploads -xzf -' < uploads-<stamp>.tar.gz
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-$HOME/bheco-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_NAME="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"' " || true)"
DB_NAME="${DB_NAME:-home_care_api}"
STAMP="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$BACKUP_DIR"
DB_FILE="$BACKUP_DIR/db-$STAMP.dump"
UPLOADS_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"

# Write to .partial files and rename on success, so a failed run never leaves
# something that looks like a good backup.
cleanup_partial() { rm -f "$DB_FILE.partial" "$UPLOADS_FILE.partial"; }
trap cleanup_partial EXIT

docker compose exec -T db pg_dump -U postgres -Fc "$DB_NAME" > "$DB_FILE.partial"
mv "$DB_FILE.partial" "$DB_FILE"

docker compose exec -T api tar -C /app/uploads -czf - . > "$UPLOADS_FILE.partial"
mv "$UPLOADS_FILE.partial" "$UPLOADS_FILE"

find "$BACKUP_DIR" -maxdepth 1 \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup ok: $(du -h "$DB_FILE" | cut -f1) database, $(du -h "$UPLOADS_FILE" | cut -f1) uploads -> $BACKUP_DIR"
