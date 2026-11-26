# IdleInvoice — Web lập hóa đơn

Bộ công cụ nội bộ cho kế toán: nhập báo giá PDF/Excel/Word từ nhà cung cấp, đối chiếu với danh mục khách hàng/sản phẩm, soạn nội dung hóa đơn và xuất file Excel đúng mẫu để nhập vào phần mềm hóa đơn.

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

> File `.doc` (Word 97-2003) được parser đọc bằng Python thuần (`olefile`), **không cần LibreOffice**.

**2. API**

```bash
cd api
npm ci
# Cấu hình: tạo api/.env (cũng nhận .env ở gốc repo nếu api/.env không có).
# Biến đã đặt trong môi trường luôn được ưu tiên hơn giá trị trong file.
# INTERNAL_KEY phải trùng với parser.
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

### Bổ sung bằng AI (tùy chọn)

Báo giá vẫn được đọc bằng bộ phân tích tất định (không cần mạng). Bật AI để xử lý thêm hai việc:

- **Khách hàng**: chuẩn hoá/sửa lỗi tên công ty, đoán MST khi file thiếu, rồi tra VietQR lấy tên và địa chỉ đăng ký.
- **Hàng hoá**: tách tên hàng / thương hiệu / model / mô tả từ một ô thông số kỹ thuật lẫn lộn, và chọn đúng mã hàng nhất trong các ứng viên do bộ ghép tất định trả về.

Mọi nhà cung cấp AI được cấu hình trong web tại **Quản trị → tab AI Agent** (chỉ admin) — không đọc key/model từ biến môi trường. Hỗ trợ **Google Gemini**, **OpenRouter**, **OpenAI Compatible** (bất kỳ server nào có `/chat/completions`) và **Anthropic** (`/messages`). Mỗi mục có Base URL, danh sách model (phân tách bằng dấu phẩy để dự phòng lẫn nhau), API key và công tắc bật/tắt; có nút **Kiểm tra kết nối** và tải danh sách model từ provider. Các provider chạy lần lượt theo thứ tự hiển thị, mỗi lần thử bị cắt sau `AI_ATTEMPT_TIMEOUT_MS`; provider vừa lỗi bị tạm ngắt 2 phút. API key chỉ lưu phía server và không bao giờ trả lại trình duyệt (chỉ hiện 4 ký tự cuối). Chưa cấu hình hoặc tắt hết provider, hay mọi provider đều lỗi, thì báo giá vẫn hiện bình thường với kết quả ghép tất định.

Thứ tự ưu tiên provider đổi bằng **kéo-thả** trong danh sách. Cấu hình có thể **sao lưu/khôi phục**: xuất một file JSON mã hóa AES-256-GCM bằng mật khẩu (khóa dẫn xuất scrypt, mật khẩu tối thiểu 8 ký tự) để mang sang máy khác mà file sao lưu không chứa API key dạng đọc được; khôi phục sẽ thay toàn bộ danh sách provider hiện có.

AI chỉ là gợi ý: không bao giờ ghi đè MST đọc được từ file, và mã hàng AI chọn phải nằm trong danh sách ứng viên (id bịa bị bỏ qua). Khi AI bật, mọi dòng hàng đều được gửi đi kiểm tra lại (kể cả dòng đã ghép chắc chắn), và màn hình nhập báo giá hiển thị provider/model thực tế đã trả lời. Tắt hoàn toàn bằng công tắc trong màn hình AI Agent. Lưu ý: nội dung báo giá (tên công ty, thông số kỹ thuật các dòng hàng) sẽ được gửi tới nhà cung cấp model khi bật tính năng này.

**MST chưa có trong danh mục**: api tra `https://api.vietqr.io/v2/business/{MST}` (không cần key) và tự thêm khách hàng với `source = TAX_LOOKUP`. Đặt `AUTO_ADD_CUSTOMER=false` để chỉ gợi ý trên màn hình. Tắt tra cứu ngoài bằng `TAX_LOOKUP_ENABLED=false`; thay nhà cung cấp khác bằng `TAX_LOOKUP_URL` (nhận `?taxCode=` và trả `{name, address}`).

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
cd api && npm test                               # 68 test: auth, CRUD, export, setup, AI provider, phân quyền
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
  routes/        auth, setup, customers, products, quotes, invoices, history, export, admin, ai-providers
  services/      parser-client, excel-import, match, quotes, invoice-export, tokens, ai, ai-providers, ai-backup
  test/          vitest + supertest
parser/app
  pdf_parser.py  pdfplumber: dò header theo từ khóa, gộp dòng phụ vào spec_text
  excel_parser.py openpyxl/xlrd
  table_reader.py đọc bảng có đường kẻ / không đường kẻ
web/src
  lib/           api client (axios + refresh token), endpoints.ts (toàn bộ route API), auth, theme
  pages/         dashboard, customers, products, quote-import, quotes, invoices, invoice-detail, admin, ai-settings, setup
  components/    layout (sidebar, header, command palette), ui (dialog, combobox, data-table, date-picker, sonner…)
scripts
  dev-all.*      chạy cả ba service cho dev (ps1 + wrapper cmd)
  test-dev.*     chạy test/build toàn bộ (sh + wrapper cmd)
  pack.ps1       đóng gói image/artifact
e2e/tests        Playwright, ảnh chụp trong e2e/screenshots
sample           file báo giá PDF/Excel dùng làm mẫu và fixture test
```

## Ghi chú nghiệp vụ

- Thứ tự đối chiếu khách hàng: mã số thuế → tên viết tắt đã nhớ → khớp mờ duy nhất → tạo mới. Sản phẩm: mã = mã → tên viết tắt → chứa chuỗi (ưu tiên trùng tên/xuất xứ/lịch sử) → khớp mờ → chưa khớp.
- Số báo giá không bắt buộc: bỏ trống thì api sinh mã `BG-YYYYMMDD-NNN` (đảm bảo không trùng); nhập số đã tồn tại sẽ bị từ chối.
- Mọi cảnh báo (lệch tổng, trùng số báo giá, báo giá hết hạn, nguy cơ bán trùng trong 30 ngày, lệch giá, độ tin cậy thấp) hiển thị trước khi xác nhận; có thể bỏ qua nhưng không bị chặn.
- File export có đúng 18 cột theo mẫu, mỗi hóa đơn cách nhau đúng một dòng trống; cột thuế lưu số `0.08` với định dạng `0%` nên hiển thị 8%, còn `KCT`/`KKKNT` lưu dạng chuỗi.
- Hóa đơn đã export bị khóa sửa qua API (trả 409) cho tới khi được tạo lại.
