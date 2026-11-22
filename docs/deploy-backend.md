# Deploy BE lên VPS 1 core / 1GB RAM (Ubuntu, không Docker)

Máy quá yếu để chạy Docker + build trên server cùng lúc, nên chiến lược là:
**build sẵn ở máy local (Windows)**, server chỉ cài dependency "production" và chạy.
FE host riêng ở Vercel, Vercel gọi qua rewrite proxy tới domain backend (xem mục 8) —
không gọi CORS cross-origin trực tiếp, vì cookie refresh-token của app đang set
`sameSite: 'strict'` (`api/src/routes/auth.ts`), chỉ gửi được khi FE và API cùng origin
qua góc nhìn trình duyệt.

## 0. Biến môi trường FE — đã kiểm tra

`web/src/lib/api.ts` gọi API với `baseURL: '/api'` **cố định**, không đọc `VITE_API_URL`
hay bất kỳ biến môi trường nào — không có chỗ nào trong `web/src` dùng `import.meta.env`.
Nghĩa là FE luôn gọi đường dẫn tương đối `/api/...` trên chính domain Vercel đang phục vụ.

Hệ quả: khi deploy, **không set biến env API URL ở Vercel** (không có biến nào để set cả) —
thay vào đó cấu hình Vercel rewrite `/api/*` sang domain backend (mục 8). Nhờ đó:
- Trình duyệt vẫn coi request `/api` là same-origin với Vercel → cookie refresh-token
  `sameSite: strict` hoạt động bình thường, không cần nới lỏng xuống `lax`/`none`.
- Không cần set `CORS_ORIGIN` trỏ sang domain Vercel, vì Vercel proxy nên request
  tới backend luôn có `Origin` là domain Vercel — vẫn cứ set đúng domain đó vào
  `CORS_ORIGIN` để phòng trường hợp gọi thẳng (xem mục 4).

## 1. Swap 4GB (bắt buộc — 1GB RAM dễ bị OOM-kill khi cài gói)

```bash
sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Giảm swappiness để ưu tiên RAM, chỉ dùng swap khi cần thật sự
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf

free -h   # kiểm tra đã thấy swap 4.0G
```

## 2. Cài Node.js + Python + Caddy trên server

```bash
sudo apt update && sudo apt install -y curl python3 python3-venv python3-pip git ufw debian-keyring debian-archive-keyring apt-transport-https

# Node LTS qua NodeSource (nhẹ, không cần nvm)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x

# Caddy — một binary tĩnh, tự lo HTTPS (Let's Encrypt), config ngắn gọn hơn nginx+certbot,
# phù hợp máy yếu vì không cần chạy thêm tiến trình certbot/cronjob gia hạn riêng.
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## 3. Build ở máy Windows local, chỉ đẩy artifact lên server

**Phần api (`api/`):**
```bash
# Ở máy Windows, trong thư mục api/
npm run build        # chạy tsc -p tsconfig.json && copy-assets -> ra dist/
```

Copy lên server (rsync/scp) các thứ sau, **không copy `node_modules`** (vì `better-sqlite3`
cần native binding đúng OS/arch của Linux, build trên Windows sẽ không chạy được trên Ubuntu):
- `api/dist/`
- `api/package.json`, `api/package-lock.json`

```bash
# ví dụ dùng scp từ Windows (Git Bash)
scp -r api/dist api/package.json api/package-lock.json user@SERVER_IP:/opt/idleinvoice/api/
```

Trên server:
```bash
cd /opt/idleinvoice/api
npm ci --omit=dev        # chỉ cài dependency chạy thật, tải binary sẵn cho Linux
mkdir -p data uploads
```

**Phần parser (`parser/`)** — Python thuần, cross-platform, nên cài thẳng trên server:
```bash
scp -r parser/app parser/requirements.txt user@SERVER_IP:/opt/idleinvoice/parser/
```
```bash
cd /opt/idleinvoice/parser
python3 -m venv .venv
source .venv/bin/activate
pip install --no-cache-dir -r requirements.txt
```
`--no-cache-dir` tiết kiệm RAM/disk khi pip build gói (rapidfuzz có thể cần biên dịch nếu
không có wheel sẵn — với swap 4GB vẫn đủ chạy).

## 4. File `.env` trên server (`/opt/idleinvoice/api/.env`)

```env
NODE_ENV=production
PORT=3000
DATABASE_PATH=./data/app.db
JWT_ACCESS_SECRET=<sinh bằng: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
JWT_REFRESH_SECRET=<sinh tương tự, khác secret trên>
INTERNAL_KEY=<chuỗi bí mật giữa api và parser, >=8 ký tự>
PARSER_URL=http://localhost:8001
CORS_ORIGIN=https://ten-du-an.vercel.app
REGISTRATION_MODE=approval
```

## 5. Chạy bằng systemd (nhẹ hơn PM2, không tốn thêm tiến trình Node quản lý)

`/etc/systemd/system/idleinvoice-api.service`:
```ini
[Unit]
Description=IdleInvoice API
After=network.target idleinvoice-parser.service

[Service]
Type=simple
WorkingDirectory=/opt/idleinvoice/api
EnvironmentFile=/opt/idleinvoice/api/.env
# Giới hạn heap Node để không ăn hết 1GB RAM khi có traffic đột biến
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/idleinvoice-parser.service`:
```ini
[Unit]
Description=IdleInvoice Parser
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/idleinvoice/parser
Environment=INTERNAL_KEY=<cùng giá trị INTERNAL_KEY ở trên>
Environment=PARSER_PORT=8001
Environment=MAX_FILE_MB=10
ExecStart=/opt/idleinvoice/parser/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 1
Restart=on-failure
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

`--workers 1` là bắt buộc với 1GB RAM — nhiều worker sẽ OOM.

```bash
sudo chown -R www-data:www-data /opt/idleinvoice
sudo systemctl daemon-reload
sudo systemctl enable --now idleinvoice-parser idleinvoice-api
sudo systemctl status idleinvoice-api idleinvoice-parser
journalctl -u idleinvoice-api -f    # xem log realtime khi cần debug
```

## 6. Caddy reverse proxy + HTTPS

Caddy tự xin và gia hạn chứng chỉ Let's Encrypt, không cần cài/cấu hình certbot riêng.

`/etc/caddy/Caddyfile`:
```
api.tenmiencuaban.com {
	request_body {
		max_size 15MB
	}
	reverse_proxy 127.0.0.1:3000
}
```

`15MB` khớp `MAX_FILE_MB=10` + dư cho multipart overhead.

```bash
sudo systemctl reload caddy
sudo systemctl status caddy
```

Trỏ DNS A record của `api.tenmiencuaban.com` về IP server trước khi reload — Caddy chỉ xin
được chứng chỉ khi domain đã phân giải đúng.

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

Cổng 3000 (api) và 8001 (parser) **không** mở ra ngoài — chỉ Caddy (local) gọi tới, giữ
nguyên `127.0.0.1` binding như trong unit file.

## 8. Phía Vercel (FE)

FE gọi API bằng đường dẫn tương đối `/api/...` (mục 0), nên chỉ cần thêm rewrite trong
`web/vercel.json` (đã có sẵn trong repo, chỉ cần sửa domain thật):

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.tenmiencuaban.com/api/:path*" }
  ]
}
```

Đổi `api.tenmiencuaban.com` thành domain backend thật rồi push — Vercel tự áp dụng rewrite
này, không cần set thêm biến môi trường nào ở Vercel project settings.

## 9. Khi có bản cập nhật code

```bash
# Local: build lại, rồi
scp -r api/dist user@SERVER_IP:/opt/idleinvoice/api/
ssh user@SERVER_IP 'cd /opt/idleinvoice/api && npm ci --omit=dev && sudo systemctl restart idleinvoice-api'

# Parser (nếu đổi code python)
scp -r parser/app user@SERVER_IP:/opt/idleinvoice/parser/
ssh user@SERVER_IP 'sudo systemctl restart idleinvoice-parser'
```

Không chạy `npm run build`/`npm test`/`vitest` trên server — việc đó ăn RAM gấp nhiều lần
việc chạy production, dễ bị OOM dù có swap.
