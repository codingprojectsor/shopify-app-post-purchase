#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/shopify-app-post-purchase"
APP_PORT=3000
DB_NAME="post_purchase_app"
DB_USER="postpurchase"
DB_PASS="PostPurchase@2026"
NODE_VERSION="20"

echo "=== Updating system ==="
apt-get update -qq

echo "=== Installing Node.js $NODE_VERSION ==="
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y -qq nodejs
echo "Node: $(node -v) | npm: $(npm -v)"

echo "=== Installing PostgreSQL ==="
apt-get install -y -qq postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

echo "=== Setting up database ==="
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_catalog.pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
echo "Database '${DB_NAME}' ready."

echo "=== Installing Nginx ==="
apt-get install -y -qq nginx
systemctl enable nginx

cat > /etc/nginx/sites-available/post-purchase-app <<NGINX
server {
    listen 80;
    server_name _;
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
    }
}
NGINX

ln -sf /etc/nginx/sites-available/post-purchase-app /etc/nginx/sites-enabled/post-purchase-app
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "Nginx configured (port 80 -> ${APP_PORT})"

echo "=== Installing PM2 ==="
npm install -g pm2

echo "=== Installing app dependencies ==="
cd "${APP_DIR}"

if [ ! -f .env ]; then
  cat > .env <<ENV
DATABASE_URL=postgresql://${DB_USER}:$(echo ${DB_PASS} | sed 's/@/%40/g')@localhost:5432/${DB_NAME}
ENV
  echo ".env created."
fi

npm install

echo "=== Running Prisma migrations ==="
npx prisma generate
npx prisma migrate deploy

echo "=== Building app ==="
npm run build

echo "=== Starting app with PM2 ==="
pm2 delete post-purchase-app 2>/dev/null || true
PORT=${APP_PORT} pm2 start npm --name "post-purchase-app" -- run start
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "=== Setup complete! ==="
echo "App: http://$(hostname -I | awk '{print $1}')"
echo "PM2: pm2 status / pm2 logs post-purchase-app"
