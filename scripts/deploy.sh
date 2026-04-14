#!/bin/bash
set -e

DEPLOY_DIR="/opt/content-factory"
SRC_DIR="/home/dev/projects/content-factory"

echo "=== Content Factory Deploy ==="
echo "$(date)"

# 1. Create deploy dir if needed
mkdir -p "$DEPLOY_DIR"

# 2. Sync source files
echo "Syncing files..."
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='backend/node_modules' \
  --exclude='backend/.env' \
  --exclude='uploads/*' \
  --exclude='dist' \
  --exclude='.env.prod' \
  "$SRC_DIR/" "$DEPLOY_DIR/"

# 3. Load env
if [ ! -f "$DEPLOY_DIR/.env.prod" ]; then
  echo "ERROR: .env.prod not found in $DEPLOY_DIR"
  echo "Create it first: cp .env.example .env.prod && edit"
  exit 1
fi

set -a
source "$DEPLOY_DIR/.env.prod"
set +a

# 4. Build frontend
echo "Building frontend..."
cd "$DEPLOY_DIR"
docker run --rm -v "$DEPLOY_DIR":/app -w /app node:20-alpine sh -c "npm install && npm run build" 2>&1

# 5. Rebuild backend
echo "Rebuilding backend container..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build 2>&1

# 6. Wait for postgres to be healthy
echo "Waiting for postgres..."
sleep 3

# 7. Sync DB password (POSTGRES_PASSWORD only applies on first initdb)
echo "Syncing DB password..."
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  psql -U contentfactory -d contentfactory \
  -c "ALTER USER contentfactory WITH PASSWORD '$DB_PASSWORD';" 2>&1 \
  && echo "DB password synced" \
  || echo "WARNING: Failed to sync DB password"

# 8. Run migrations
echo "Running migrations..."
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T backend \
  bunx prisma migrate deploy 2>&1

# 9. Health check (full — includes DB connectivity)
echo "Health check..."
sleep 2
HEALTH=$(curl -sf http://localhost:3800/api/health?full=true 2>/dev/null || echo '{"status":"error"}')
echo "$HEALTH"

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "Backend healthy!"
elif echo "$HEALTH" | grep -q 'Authentication failed'; then
  echo "ERROR: DB auth still failing after password sync. Check .env.prod and postgres volume."
  docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=10 backend
  exit 1
else
  echo "WARNING: Health check issue, check logs:"
  docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=20 backend
fi

echo ""
echo "=== Deploy complete! ==="
echo "Backend: http://localhost:3800"
echo "Frontend: $DEPLOY_DIR/dist (served by Caddy)"
echo "Health: curl http://localhost:3800/api/health?full=true"
