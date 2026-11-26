#!/usr/bin/env bash
# Usage: deploy.sh user@SERVER_IP CORS_ORIGIN [path/to/key.pem]
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 user@SERVER_IP CORS_ORIGIN [path/to/key.pem]"
  exit 1
fi

API_DOMAIN="apiquoteflow.duckdns.org"
TARGET="$1"
CORS_ORIGIN="$2"
KEY="${3:-}"
DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_TMP="/tmp/idleinvoice-deploy"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "$KEY" ]; then
  SSH_OPTS+=(-i "$KEY")
fi

echo "==> Upload package to $TARGET"
ssh "${SSH_OPTS[@]}" "$TARGET" "rm -rf $REMOTE_TMP && mkdir -p $REMOTE_TMP"
scp "${SSH_OPTS[@]}" -r "$DIR/api" "$DIR/parser" "$DIR/systemd" "$DIR/Caddyfile.tmpl" "$TARGET:$REMOTE_TMP/"

echo "==> Install and restart services"
ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "$API_DOMAIN" "$CORS_ORIGIN" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

API_DOMAIN="$1"
CORS_ORIGIN="$2"
SRC=/tmp/idleinvoice-deploy
APP=/opt/idleinvoice

if [ -z "$(swapon --show)" ]; then
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf >/dev/null
  sudo sysctl -q vm.swappiness=10
fi

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

sudo apt-get update
sudo apt-get install -y curl python3 python3-venv python3-pip git iptables-persistent debian-keyring debian-archive-keyring apt-transport-https gpg

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y caddy
fi

sudo mkdir -p "$APP/api" "$APP/parser"
sudo rm -rf "$APP/api/dist" "$APP/parser/app"
sudo cp -r "$SRC/api/." "$APP/api/"
sudo cp -r "$SRC/parser/." "$APP/parser/"
sudo chown -R "$(id -un):$(id -gn)" "$APP"

cd "$APP/api"
npm ci --omit=dev
mkdir -p data uploads

cd "$APP/parser"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --no-cache-dir -r requirements.txt

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
  echo "Created $ENV_FILE (secrets generated)"
else
  echo "Keeping existing $ENV_FILE (edit CORS_ORIGIN there if it changed)"
fi

sudo cp "$SRC/systemd/idleinvoice-api.service" "$SRC/systemd/idleinvoice-parser.service" /etc/systemd/system/
sed "s/__API_DOMAIN__/$API_DOMAIN/g" "$SRC/Caddyfile.tmpl" | sudo tee /etc/caddy/Caddyfile >/dev/null

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

sudo chown -R www-data:www-data "$APP"
sudo systemctl daemon-reload
sudo systemctl enable idleinvoice-parser idleinvoice-api caddy
sudo systemctl restart idleinvoice-parser idleinvoice-api caddy

sleep 2
systemctl --no-pager is-active idleinvoice-parser idleinvoice-api caddy
rm -rf "$SRC"
REMOTE

echo "==> Done. Check: curl -I https://$API_DOMAIN"
