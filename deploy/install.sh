#!/usr/bin/env bash
# Chạy trên server, từ trong thư mục đã upload (chứa api/, parser/, systemd/, Caddyfile.tmpl).
# Usage: bash install.sh https://ten-du-an.vercel.app
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ $# -lt 1 ]; then
  echo "Usage: bash $0 CORS_ORIGIN"
  exit 1
fi

CORS_ORIGIN="$1"
API_DOMAIN="apiquoteflow.duckdns.org"
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/idleinvoice

echo "==> Cài gói hệ thống"
sudo apt-get update
sudo apt-get install -y curl gpg python3 python3-venv python3-pip iptables-persistent \
  debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
fi

echo "==> Mở cổng 80/443 trong iptables"
REJECT_LINE=$(sudo iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')
for PORT in 80 443; do
  if ! sudo iptables -C INPUT -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
    if [ -n "$REJECT_LINE" ]; then
      sudo iptables -I INPUT "$REJECT_LINE" -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT
    else
      sudo iptables -A INPUT -m state --state NEW -p tcp --dport "$PORT" -j ACCEPT
    fi
  fi
done
sudo netfilter-persistent save

echo "==> Copy code vào $APP"
sudo mkdir -p "$APP/api" "$APP/parser"
sudo rm -rf "$APP/api/dist" "$APP/parser/app"
sudo cp -r "$SRC/api/." "$APP/api/"
sudo cp -r "$SRC/parser/." "$APP/parser/"
sudo chown -R "$(id -un):$(id -gn)" "$APP"

echo "==> Cài dependency API"
cd "$APP/api"
npm ci --omit=dev
mkdir -p data uploads

echo "==> Cài dependency parser"
cd "$APP/parser"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --no-cache-dir -r requirements.txt

echo "==> Tạo .env (giữ nguyên nếu đã có)"
ENV_FILE="$APP/api/.env"
if [ ! -f "$ENV_FILE" ]; then
  gen() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_PATH=./data/app.db
JWT_ACCESS_SECRET=$(gen)
JWT_REFRESH_SECRET=$(gen)
INTERNAL_KEY=$(gen)
PARSER_URL=http://localhost:8001
CORS_ORIGIN=$CORS_ORIGIN
REGISTRATION_MODE=approval
EOF
  chmod 600 "$ENV_FILE"
  echo "Đã tạo $ENV_FILE"
else
  echo "Giữ nguyên $ENV_FILE (sửa CORS_ORIGIN bằng tay nếu cần)"
fi

echo "==> Cài systemd và Caddy"
sudo cp "$SRC/systemd/idleinvoice-api.service" "$SRC/systemd/idleinvoice-parser.service" /etc/systemd/system/
sed "s/__API_DOMAIN__/$API_DOMAIN/g" "$SRC/Caddyfile.tmpl" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile

sudo chown -R www-data:www-data "$APP"
sudo systemctl daemon-reload
sudo systemctl enable idleinvoice-parser idleinvoice-api caddy
sudo systemctl restart idleinvoice-parser idleinvoice-api caddy

sleep 2
systemctl --no-pager is-active idleinvoice-parser idleinvoice-api caddy || true
curl -s -o /dev/null -w "API local: HTTP %{http_code}\n" http://127.0.0.1:3000/api/setup || true
echo "==> Xong. Kiểm tra từ ngoài: curl -I https://$API_DOMAIN"
