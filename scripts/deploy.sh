#!/bin/bash
set -e
cd /opt/content-factory

set -a
source .env.prod
set +a

echo "Pulling latest code..."
git pull

echo "Building frontend..."
docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "npm ci && npm run build"

echo "Rebuilding backend..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo "Running migrations..."
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend bunx prisma migrate deploy

echo "Deploy complete!"
echo "Frontend served from /opt/content-factory/dist via Caddy"
echo "Backend at localhost:3800"
