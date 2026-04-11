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

# 6. Wait for backend to start
echo "Waiting for backend..."
sleep 3

# 7. Run migrations
echo "Running migrations..."
docker compose -f docker-compose.prod.yml exec -T backend bunx prisma migrate deploy 2>&1

# 8. Health check
echo "Health check..."
if curl -sf http://localhost:3800/api/health > /dev/null; then
  echo "Backend healthy!"
else
  echo "WARNING: Health check failed, check logs:"
  docker compose -f docker-compose.prod.yml logs --tail=20 backend
fi

echo ""
echo "=== Deploy complete! ==="
echo "Backend: http://localhost:3800"
echo "Frontend: $DEPLOY_DIR/dist (served by Caddy)"
echo "Health: curl http://localhost:3800/api/health?full=true"
