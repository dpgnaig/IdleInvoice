#!/usr/bin/env bash
# Cập nhật nhanh code đã đóng gói. Chỉ cài lại dependency khi package-lock.json / package.json / requirements.txt đổi.
# Yêu cầu: server đã được cài bằng deploy.sh ít nhất 1 lần (có .env, systemd, Caddy).
# Usage: update.sh user@SERVER_IP [path/to/key.pem]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 user@SERVER_IP [path/to/key.pem]"
  exit 1
fi

TARGET="$1"
KEY="${2:-}"
DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_TMP="/tmp/idleinvoice-update"

if [ ! -f "$DIR/api/dist/index.js" ]; then
  echo "Thiếu $DIR/api/dist/index.js. Chạy deploy/package.ps1 trước."
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [ -n "$KEY" ]; then
  SSH_OPTS+=(-i "$KEY")
fi

echo "==> Upload code to $TARGET"
ssh "${SSH_OPTS[@]}" "$TARGET" "rm -rf $REMOTE_TMP && mkdir -p $REMOTE_TMP"
scp "${SSH_OPTS[@]}" -r "$DIR/api" "$DIR/parser" "$TARGET:$REMOTE_TMP/"

echo "==> Update and restart"
ssh "${SSH_OPTS[@]}" "$TARGET" bash -s <<'REMOTE'
set -euo pipefail

SRC=/tmp/idleinvoice-update
APP=/opt/idleinvoice

if [ ! -f "$APP/api/.env" ] || [ ! -f /etc/systemd/system/idleinvoice-api.service ]; then
  echo "Server chưa được cài đặt. Chạy deploy.sh trước."
  exit 1
fi

# Dù thành công hay lỗi, trả quyền sở hữu về www-data để service còn ghi được data/ và uploads/.
trap 'sudo chown -R www-data:www-data "$APP"; rm -rf "$SRC"' EXIT
sudo chown -R "$(id -un):$(id -gn)" "$APP"

hash_of() { cat "$@" | sha256sum | cut -d' ' -f1; }

NEW_NODE_HASH=$(hash_of "$SRC/api/package.json" "$SRC/api/package-lock.json")
OLD_NODE_HASH=$(cat "$APP/api/.deps.sha256" 2>/dev/null || true)
NEW_PY_HASH=$(hash_of "$SRC/parser/requirements.txt")
OLD_PY_HASH=$(cat "$APP/parser/.deps.sha256" 2>/dev/null || true)

sudo systemctl stop idleinvoice-api

# Chỉ thay phần code. Không đụng .env, data/, uploads/, node_modules/, .venv/.
rm -rf "$APP/api/dist" "$APP/parser/app"
cp -r "$SRC/api/dist" "$APP/api/dist"
cp "$SRC/api/package.json" "$SRC/api/package-lock.json" "$APP/api/"
cp -r "$SRC/parser/app" "$APP/parser/app"
cp "$SRC/parser/requirements.txt" "$APP/parser/"

cd "$APP/api"
if [ "$NEW_NODE_HASH" != "$OLD_NODE_HASH" ] || [ ! -d node_modules ]; then
  echo "==> Node dependencies thay đổi: npm ci"
  npm ci --omit=dev
  echo "$NEW_NODE_HASH" > .deps.sha256
else
  echo "==> Node dependencies không đổi, bỏ qua npm ci"
fi
mkdir -p data uploads

cd "$APP/parser"
[ -d .venv ] || python3 -m venv .venv
if [ "$NEW_PY_HASH" != "$OLD_PY_HASH" ]; then
  echo "==> Python dependencies thay đổi: pip install"
  .venv/bin/pip install --no-cache-dir -r requirements.txt
  echo "$NEW_PY_HASH" > .deps.sha256
else
  echo "==> Python dependencies không đổi, bỏ qua pip install"
fi

sudo chown -R www-data:www-data "$APP"
sudo systemctl restart idleinvoice-parser idleinvoice-api

sleep 2
systemctl --no-pager is-active idleinvoice-parser idleinvoice-api caddy
curl -s -o /dev/null -w "API local: HTTP %{http_code}\n" http://127.0.0.1:3000/api/setup || true
REMOTE

echo "==> Done. Check: curl -I https://apiquoteflow.duckdns.org"
