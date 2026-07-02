#!/bin/bash
set -e

BACKUP_DIR="/opt/backups/content-factory"
RETENTION_DAYS=30
LOG="/var/log/content-factory-backup.log"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/contentfactory-$TIMESTAMP.sql.gz"

echo "[$TIMESTAMP] Starting backup..." >> "$LOG"

if ! docker compose -f /opt/content-factory/docker-compose.prod.yml exec -T postgres \
  pg_dump -U contentfactory contentfactory | gzip > "$BACKUP_FILE"; then
  echo "[$TIMESTAMP] ERROR: pg_dump не выполнился — удаляю неполный файл" >> "$LOG"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Валидность: НЕ пустышка (20-байтный gzip проходит gunzip -t!) + корректный gzip-архив.
BYTES=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || echo 0)
if [ "$BYTES" -lt 1000 ] || ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "[$TIMESTAMP] ERROR: бэкап невалиден (${BYTES}B < 1000 или битый gzip) — удаляю" >> "$LOG"
  rm -f "$BACKUP_FILE"
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$TIMESTAMP] Backup created & verified: $BACKUP_FILE ($SIZE)" >> "$LOG"

find "$BACKUP_DIR" -name "contentfactory-*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$TIMESTAMP] Old backups cleaned (>${RETENTION_DAYS} days)" >> "$LOG"
