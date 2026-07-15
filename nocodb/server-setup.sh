#!/bin/bash
# Run this on the DigitalOcean server via the web console.
# Installs Docker Compose if missing, deploys NocoDB + Postgres.

set -e

echo "=== BAPG NocoDB Setup ==="

# 1. Install Docker Compose plugin if not present
if ! docker compose version &>/dev/null 2>&1; then
  echo "Installing Docker Compose plugin..."
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin
fi

echo "Docker Compose: $(docker compose version)"

# 2. Create app directory
mkdir -p /opt/nocodb
cd /opt/nocodb

# 3. Write docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: "3.8"

services:
  nocodb:
    image: nocodb/nocodb:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      NC_DB: "pg://postgres:5432?u=nocodb&p=nocodb_pass_2026&d=nocodb"
      NC_AUTH_JWT_SECRET: "bapg-secret-jwt-2026-nocodb"
    volumes:
      - nocodb_data:/usr/app/data
    depends_on:
      - postgres

  postgres:
    image: postgres:15-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nocodb
      POSTGRES_PASSWORD: nocodb_pass_2026
      POSTGRES_DB: nocodb
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  nocodb_data:
  pg_data:
EOF

# 4. Open firewall port 8080
if command -v ufw &>/dev/null; then
  ufw allow 8080/tcp
  echo "Firewall: port 8080 opened"
fi

# 5. Pull images and start
echo "Pulling images..."
docker compose pull

echo "Starting NocoDB..."
docker compose up -d

# 6. Wait for NocoDB to be ready
echo "Waiting for NocoDB to start (up to 60s)..."
for i in $(seq 1 12); do
  if curl -sf http://localhost:8080/api/v1/health &>/dev/null; then
    echo "NocoDB is up!"
    break
  fi
  echo "  ...waiting ($((i*5))s)"
  sleep 5
done

echo ""
echo "======================================"
echo "NocoDB is running at:"
echo "  http://137.184.211.133:8080"
echo ""
echo "First-time setup:"
echo "  1. Open that URL in your browser"
echo "  2. Create an admin account (your email + password)"
echo "  3. Note the API token from: Team & Settings → API Tokens"
echo "  4. Run the table-setup script with that token"
echo "======================================"
