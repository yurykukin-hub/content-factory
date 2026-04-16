#!/bin/bash
set -e

BACKUP_DIR="/opt/backups/content-factory"
RETENTION_DAYS=30
LOG="/var/log/content-factory-backup.log"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/contentfactory-$TIMESTAMP.sql.gz"

echo "[$TIMESTAMP] Starting backup..." >> "$LOG"

docker compose -f /opt/content-factory/docker-compose.prod.yml exec -T postgres \
  pg_dump -U contentfactory contentfactory | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$TIMESTAMP] Backup created: $BACKUP_FILE ($SIZE)" >> "$LOG"

# Verify backup integrity
if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "[$TIMESTAMP] Backup verified: OK" >> "$LOG"
else
  echo "[$TIMESTAMP] ERROR: Backup verification FAILED — file may be corrupted!" >> "$LOG"
fi

find "$BACKUP_DIR" -name "contentfactory-*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$TIMESTAMP] Old backups cleaned (>${RETENTION_DAYS} days)" >> "$LOG"
