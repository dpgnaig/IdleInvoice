# IdleInvoice — Web lập hóa đơn

Bộ công cụ nội bộ cho kế toán: nhập báo giá PDF/Excel từ nhà cung cấp, đối chiếu với danh mục khách hàng/sản phẩm, soạn nội dung hóa đơn và xuất file Excel đúng mẫu để nhập vào phần mềm hóa đơn.

## Kiến trúc

```
web (React + Vite)  ──HTTP/JSON──▶  api (Express + SQLite)  ──X-Internal-Key──▶  parser (FastAPI)
                                          │
                                    data/app.db + uploads/
```

- **api** là dịch vụ duy nhất đọc/ghi SQLite. Parser chỉ nhận file và trả JSON, không truy cập DB.
- **parser** không publish cổng ra ngoài; chỉ api gọi được qua mạng nội bộ và header `X-Internal-Key`.
- Token: access token 15 phút (giữ trong bộ nhớ trình duyệt) + refresh token 7 ngày trong cookie `httpOnly; Secure; SameSite=Strict`, xoay vòng mỗi lần refresh; phát hiện dùng lại refresh token cũ sẽ thu hồi toàn bộ phiên của người dùng.

## Yêu cầu

| Thành phần | Phiên bản |
|---|---|
| Node.js | >= 20 (khuyến nghị 22) |
| Python | >= 3.11 (đã kiểm tra với 3.13) |
| Docker | >= 24 (nếu chạy bằng container) |

## Chạy môi trường dev

**Cách nhanh (khuyến nghị):** một lệnh lo hết — tạo `parser/.venv`, `pip install`, `npm ci` nếu thiếu, rồi mở mỗi service trong một cửa sổ PowerShell riêng.

```powershell
.\scripts\dev-all.ps1              # parser :8001 + api :3000 + web :5173
.\scripts\dev-all.ps1 -Install     # ép cài lại dependency của cả ba
.\scripts\dev-all.ps1 -Seed        # thêm dữ liệu mẫu (admin@example.com / Admin12345)
.\scripts\dev-all.ps1 -NoWeb       # bỏ web; tương tự -NoApi, -NoParser
```

Từ cmd: `scripts\dev-all.cmd` (wrapper, nhận cùng tham số). Script đặt sẵn các biến dev mặc định (`JWT_*_SECRET`, `INTERNAL_KEY`, `PARSER_URL`, `CORS_ORIGIN`, `PORT`, `DATABASE_PATH`, `REGISTRATION_MODE`) và tự tạo thư mục chứa DB; biến đã có trong môi trường thì giữ nguyên. Đóng cửa sổ cha hoặc Ctrl+C là tắt cả ba.

Trên Windows, `python` trên PATH có thể chỉ là alias của Microsoft Store (báo lỗi "Python was not found") — khi đó tạo venv bằng `py -m venv .venv` rồi chạy `.\scripts\dev-all.ps1 -Install`, hoặc dùng cách thủ công dưới đây.

**Cách thủ công:** ba terminal độc lập.

**1. Parser**

```bash
cd parser
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
set INTERNAL_KEY=local-internal-key          # macOS/Linux: export ...
uvicorn app.main:app --reload --port 8001
```

**2. API**

```bash
cd api
npm ci
# tạo .env từ .env.example rồi sửa DATABASE_PATH, CORS_ORIGIN, INTERNAL_KEY
# INTERNAL_KEY phải trùng với parser
npm run dev          # http://localhost:3000
```

**3. Web**

```bash
cd web
npm ci
npm run dev          # http://localhost:5173, proxy /api -> http://localhost:3000
```

Lần đầu mở web, ứng dụng chuyển tới `/setup` để tạo tài khoản admin, import danh mục khách hàng/sản phẩm và (tùy chọn) lịch sử hóa đơn. Hoàn tất wizard thì các endpoint `/api/setup/*` bị khóa vĩnh viễn.

Nếu cần dữ liệu mẫu để thử nhanh (không dùng cho production):

```bash
cd api
DATABASE_PATH=./data/dev.db npm run seed   # admin@example.com / Admin12345
```

## Biến môi trường

Xem `.env.example`. Bắt buộc:

- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — >= 32 ký tự, khác nhau.
- `INTERNAL_KEY` — dùng chung giữa api và parser, >= 8 ký tự.
- `REGISTRATION_MODE` — `open` (ai cũng đăng ký được), `approval` (mặc định, admin duyệt), `closed`.

Không commit file `.env`.

## Build

```bash
cd parser && pip install -r requirements.txt      # parser chạy trực tiếp bằng uvicorn
cd api && npm run build                           # tsc -> dist/ + chép migrations
cd web && npm run build                           # -> web/dist
```

Để api phục vụ luôn giao diện đã build, đặt `SERVE_WEB=true` và chép `web/dist` vào `api/public`:

```bash
mkdir -p api/public && cp -r web/dist/. api/public/
cd api && SERVE_WEB=true NODE_ENV=production node dist/index.js
```

## Chạy bằng Docker

```bash
cp .env.example .env      # sửa 3 secret, đặt PORT nếu 3000 đã bận
docker compose up -d --build
docker compose logs -f api
```

Truy cập `http://localhost:3000`. Image api là build đa tầng: build web bằng Vite rồi nhúng vào `public/`, build TypeScript, và chạy bằng user `node` không đặc quyền.

Dừng: `docker compose down` (giữ dữ liệu) hoặc `docker compose down -v` (xóa luôn volume — mất DB và file upload).

## Dữ liệu và sao lưu

SQLite ở `data/app.db` (volume `appdata`), file báo giá gốc ở `uploads/` (volume `uploads`). Bật WAL nên phải sao lưu bằng lệnh của SQLite, không copy nóng file `.db`.

**Sao lưu khi đang chạy (khuyến nghị):**

```bash
docker compose exec api node -e "
const D=require('better-sqlite3');
const db=new D('/data/app.db',{readonly:true});
db.backup('/data/backup-' + new Date().toISOString().slice(0,10) + '.db').then(()=>console.log('ok'));
"
docker compose cp api:/data/backup-2026-01-01.db ./backup-2026-01-01.db
```

Sao lưu file upload: `docker compose cp api:/app/uploads ./uploads-backup`

**Khôi phục:**

```bash
docker compose down
docker run --rm -v idleinvoice_appdata:/data -v "$PWD":/backup alpine \
  sh -c "cp /backup/backup-2026-01-01.db /data/app.db && rm -f /data/app.db-wal /data/app.db-shm"
docker compose up -d
```

Chạy không dùng Docker thì dừng api trước rồi copy cả ba file `app.db`, `app.db-wal`, `app.db-shm` — hoặc vẫn dùng `db.backup()` như trên với đường dẫn thật.

## Kiểm thử

Cách nhanh nhất — một lệnh chạy hết:

```bash
./scripts/test-dev.sh                  # parser + API + typecheck/build web
./scripts/test-dev.sh --e2e            # thêm Playwright (cần 3 service đang chạy)
./scripts/test-dev.sh --only api       # chỉ một phần: parser | api | web | e2e
./scripts/test-dev.sh --no-build       # bỏ bước vite build
```

Trên Windows (cmd/PowerShell) dùng wrapper: `scripts\test-dev.cmd --e2e`.

Script tự tìm Python trong `parser/.venv`, in bảng tổng kết PASS/FAIL kèm thời gian và trả mã thoát 1 nếu có bước lỗi (dùng được trong CI). Bước e2e tự bỏ qua nếu chưa thấy web/API đang chạy.

Chạy lẻ từng phần:

```bash
cd parser && python -m pytest -q                 # 38 test: 4 mẫu PDF/Excel + API
cd api && npm test                               # 41 test: auth, CRUD, export, setup, phân quyền
cd web && npm run typecheck && npm run build
```

End-to-end lần đầu (cần cài trình duyệt):

```bash
cd e2e && npm ci && npx playwright install chromium
BASE_URL=http://localhost:5173 npx playwright test
```

Ảnh chụp màn hình sau mỗi bước nằm trong `e2e/screenshots/`.

Lưu ý khi chạy e2e nhiều lần: giới hạn đăng nhập mặc định là 10 lần/15 phút (mỗi login trong test đều tính). Nếu chạy lặp lại nhiều, khởi động api với `LOGIN_RATE_MAX=200`; test tự sinh số báo giá duy nhất nên không đụng dữ liệu cũ.

## Cấu trúc thư mục

```
api/src
  db/            schema Drizzle + migrations SQL (chạy tuần tự, ghi vào __migrations)
  routes/        auth, setup, customers, products, quotes, invoices, history, export, admin
  services/      parser-client, excel-import, match, quotes, invoice-export, tokens
  test/          vitest + supertest
parser/app
  pdf_parser.py  pdfplumber: dò header theo từ khóa, gộp dòng phụ vào spec_text
  excel_parser.py openpyxl/xlrd
  table_reader.py đọc bảng có đường kẻ / không đường kẻ
web/src
  pages/         dashboard, customers, products, quote-import, quotes, invoices, invoice-detail, admin, setup
  components/    layout (sidebar, header, command palette), ui (dialog, combobox, data-table…)
scripts
  dev-all.*      chạy cả ba service cho dev (ps1 + wrapper cmd)
  test-dev.*     chạy test/build toàn bộ (sh + wrapper cmd)
  pack.ps1       đóng gói image/artifact
e2e/tests        Playwright, ảnh chụp trong e2e/screenshots
sample           file báo giá PDF/Excel dùng làm mẫu và fixture test
```

## Ghi chú nghiệp vụ

- Thứ tự đối chiếu khách hàng: mã số thuế → tên viết tắt đã nhớ → khớp mờ duy nhất → tạo mới. Sản phẩm: mã = mã → tên viết tắt → chứa chuỗi (ưu tiên trùng tên/xuất xứ/lịch sử) → khớp mờ → chưa khớp.
- Mọi cảnh báo (lệch tổng, trùng số báo giá, báo giá hết hạn, nguy cơ bán trùng trong 30 ngày, lệch giá, độ tin cậy thấp) hiển thị trước khi xác nhận; có thể bỏ qua nhưng không bị chặn.
- File export có đúng 18 cột theo mẫu, mỗi hóa đơn cách nhau đúng một dòng trống; cột thuế lưu số `0.08` với định dạng `0%` nên hiển thị 8%, còn `KCT`/`KKKNT` lưu dạng chuỗi.
- Hóa đơn đã export bị khóa sửa qua API (trả 409) cho tới khi được tạo lại.
