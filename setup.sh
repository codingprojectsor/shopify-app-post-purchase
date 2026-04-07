#!/usr/bin/env bash
# ===========================================
# Post-Purchase Upsell App — Server Setup
# ===========================================
# Installs: Node.js 20, PostgreSQL 14, Nginx, PM2
# Configures: Database, Nginx reverse proxy, app build
#
# Usage: chmod +x setup.sh && sudo ./setup.sh
# ===========================================

set -euo pipefail

# ---- Configuration (edit these) ----
APP_NAME="post-purchase-app"
APP_DIR="/var/www/shopify-app-post-purchase"
APP_PORT=3000
DOMAIN="_"  # Replace with your domain, e.g. "app.example.com"

DB_NAME="post_purchase_app"
DB_USER="postpurchase"
DB_PASS="PostPurchase@2026"

NODE_VERSION="20"
# ------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[SETUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Must run as root
if [ "$EUID" -ne 0 ]; then
  err "Please run as root: sudo ./setup.sh"
fi

log "Starting setup for ${APP_NAME}..."

# ==================
# 1. System packages
# ==================
log "Updating system packages..."
apt-get update -qq

# ==================
# 2. Node.js 20
# ==================
if command -v node &>/dev/null && node -v | grep -q "v${NODE_VERSION}"; then
  log "Node.js $(node -v) already installed."
else
  log "Installing Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -qq nodejs
fi
log "Node: $(node -v) | npm: $(npm -v)"

# ==================
# 3. PostgreSQL
# ==================
if command -v psql &>/dev/null; then
  log "PostgreSQL already installed."
else
  log "Installing PostgreSQL..."
  apt-get install -y -qq postgresql postgresql-contrib
fi

# Start PostgreSQL
systemctl enable postgresql
systemctl start postgresql
log "PostgreSQL is running."

# Create user and database
log "Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_catalog.pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
log "Database '${DB_NAME}' ready with user '${DB_USER}'."

# ==================
# 4. Nginx
# ==================
if command -v nginx &>/dev/null; then
  log "Nginx already installed."
else
  log "Installing Nginx..."
  apt-get install -y -qq nginx
fi

systemctl enable nginx

# Write Nginx config
log "Configuring Nginx reverse proxy..."
cat > /etc/nginx/sites-available/${APP_NAME} <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 90;
    }
}
NGINX

# Enable site
ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/${APP_NAME}
rm -f /etc/nginx/sites-enabled/default

# Test and restart
nginx -t && systemctl restart nginx
log "Nginx configured — proxying port 80 -> ${APP_PORT}"

# ==================
# 5. PM2 (process manager)
# ==================
if command -v pm2 &>/dev/null; then
  log "PM2 already installed."
else
  log "Installing PM2..."
  npm install -g pm2
fi

# ==================
# 6. App setup
# ==================
log "Installing app dependencies..."
cd "${APP_DIR}"

# Write .env if missing
if [ ! -f .env ]; then
  log "Creating .env file..."
  cat > .env <<ENV
DATABASE_URL=postgresql://${DB_USER}:$(echo ${DB_PASS} | sed 's/@/%40/g')@localhost:5432/${DB_NAME}
ADMIN_SECRET=$(openssl rand -hex 32)
ENV
  log ".env created with a random ADMIN_SECRET."
else
  log ".env already exists, skipping."
fi

npm install
log "Running Prisma migrations..."
npx prisma generate
npx prisma migrate deploy

log "Building the app..."
npm run build

# ==================
# 7. Start with PM2
# ==================
log "Starting app with PM2..."
pm2 delete ${APP_NAME} 2>/dev/null || true
cd "${APP_DIR}"
PORT=${APP_PORT} pm2 start npm --name "${APP_NAME}" -- run start
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

# ==================
# 8. Firewall (optional)
# ==================
if command -v ufw &>/dev/null; then
  log "Configuring firewall..."
  ufw allow 'Nginx Full' 2>/dev/null || true
  ufw allow OpenSSH 2>/dev/null || true
fi

# ==================
# Done
# ==================
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  App:        http://localhost:${APP_PORT}"
echo "  Nginx:      http://$(hostname -I | awk '{print $1}')"
echo "  Database:   ${DB_NAME} (user: ${DB_USER})"
echo "  PM2 status: pm2 status"
echo "  PM2 logs:   pm2 logs ${APP_NAME}"
echo ""
echo "  Useful commands:"
echo "    pm2 restart ${APP_NAME}    # Restart app"
echo "    pm2 logs ${APP_NAME}       # View logs"
echo "    npx prisma studio          # Database GUI"
echo "    sudo nginx -t              # Test Nginx config"
echo ""
warn "Next steps:"
echo "  1. Update DOMAIN in /etc/nginx/sites-available/${APP_NAME}"
echo "  2. Set up SSL: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx -d yourdomain.com"
echo "  3. Update application_url in shopify.app.toml to your production URL"
echo ""
