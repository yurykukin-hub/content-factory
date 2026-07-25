#!/usr/bin/env bash
# Зеркало медиа Content Factory: бакет Beget S3 → Hetzner /opt/backups/cf-media.
#
# Почему гоняем с СПб, а не тянем с Hetzner: ключи от бакета полнодоступные, и держать
# их ещё и на резервной ноде — лишний радиус поражения. Данные идут S3 → СПб → Hetzner;
# после первого прогона синхронизируются только изменения, поэтому трафик копеечный.
#
# Именно sync, а не copy: удалённое в бакете должно исчезать и в зеркале, иначе оно
# бесконечно растёт. Защита от катастрофы (случайно вычистили бакет → зеркало повторило)
# — --backup-dir: удалённые/изменённые файлы уезжают в датированную папку, а не пропадают.
#
# ДВА прохода — не перестраховка. Приложение живое: файл, загруженный после того, как
# rclone составил список источника, в этот прогон не попадёт. Первый же такой случай
# (25.07: Юрий загрузил фото посреди копирования) уронил сверку. Проверка, которая
# ругается при штатной работе пользователей, быстро становится фоновым шумом, поэтому
# второй проход добирает хвост, и только НЕСОШЕДШАЯСЯ ПОСЛЕ НЕГО сверка — это сигнал.
set -euo pipefail

BUCKET=beget:73c241bab1be-content-factory-media
DEST=hetzner:/opt/backups/cf-media
STAMP=$(date +%Y%m%d)
LOG=/var/log/cf-media-mirror.log

sync_pass() {
  rclone sync "$BUCKET" "$DEST" \
    --backup-dir "hetzner:/opt/backups/cf-media-removed/$STAMP" \
    --transfers 6 --checkers 8 --size-only \
    --stats 5m --stats-one-line \
    --log-file "$LOG" --log-level "$1"
}

echo "=== $(date -Is) старт ===" >> "$LOG"
sync_pass INFO
sync_pass NOTICE   # добор того, что записалось во время первого прохода

SRC_N=$(rclone size "$BUCKET" --json | jq -r .count)
DST_N=$(rclone size "$DEST" --json | jq -r .count)

if [ "$SRC_N" = "$DST_N" ]; then
  echo "$(date -Is) ✅ готово: $SRC_N объектов в бакете и в зеркале" >> "$LOG"
  exit 0
fi

# Разошлось и после второго прохода — показываем ЧТО именно, иначе по числам не понять.
echo "$(date -Is) ⚠️ РАСХОЖДЕНИЕ: в бакете $SRC_N, в зеркале $DST_N" >> "$LOG"
rclone lsf "$BUCKET" -R --files-only | sort > /tmp/cf-mirror-src.txt
rclone lsf "$DEST" -R --files-only | sort > /tmp/cf-mirror-dst.txt
echo "--- нет в зеркале: ---" >> "$LOG"
comm -23 /tmp/cf-mirror-src.txt /tmp/cf-mirror-dst.txt | head -20 >> "$LOG"
echo "--- лишнее в зеркале: ---" >> "$LOG"
comm -13 /tmp/cf-mirror-src.txt /tmp/cf-mirror-dst.txt | head -20 >> "$LOG"
exit 1
