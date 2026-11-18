# Prompt: Web lập hóa đơn từ báo giá (Express + Python service + React)

> Dán toàn bộ nội dung bên dưới vào Claude Code / Cursor. Nên giao từng bước theo mục "THỨ TỰ THỰC HIỆN", không dán rồi chờ ra hết một lần.

---

## VAI TRÒ
Bạn là senior fullstack dev. Xây dựng ứng dụng web "Trình lập hóa đơn từ báo giá" cho kế toán doanh thu. Người dùng đăng ký/đăng nhập bằng JWT, tải báo giá (PDF/Excel) lên, hệ thống đọc báo giá, đối chiếu với danh sách khách hàng (DSKH) và danh sách sản phẩm (DSSP), tạo hóa đơn nháp, rồi xuất file Excel đúng mẫu để import lên phần mềm hóa đơn.

## KIẾN TRÚC (3 service)
```
React SPA (Vite)  ──HTTP──▶  Express API (TypeScript)  ──HTTP nội bộ──▶  Python Parser Service (FastAPI)
                                   │
                               SQLite (ORM)
```
- Monorepo: `/web` (React), `/api` (Express), `/parser` (Python), `docker-compose.yml`, `.env.example`, `README.md`.
- **Chỉ Express truy cập database.** Python service không đụng DB, chỉ nhận file và trả JSON đã bóc tách. Python chỉ lắng nghe trong mạng nội bộ docker, không public; Express gọi sang kèm header bí mật `X-Internal-Key` (biến môi trường).
- Production: Express phục vụ file tĩnh của React build (hoặc nginx reverse proxy), một cổng public duy nhất. Dev: vite proxy `/api`.

## TECH STACK (bắt buộc)
**Backend `/api`:** Node 20+, Express, TypeScript (strict), Drizzle ORM + better-sqlite3 (SQLite), zod, jsonwebtoken, argon2 (hash mật khẩu), cookie-parser, helmet, cors, express-rate-limit, multer, exceljs, pino (log), vitest + supertest.
**Parser `/parser`:** Python 3.11+, FastAPI + uvicorn, pdfplumber (PDF có text layer, lấy bảng/tọa độ), openpyxl (.xlsx), xlrd (.xls), pydantic, pytest. Không dùng thư viện nặng không cần thiết.
**Frontend `/web`:** React 18 + Vite + TypeScript, shadcn/ui + Tailwind, TanStack Query, TanStack Table, react-hook-form + zod, react-router, sonner, **Framer Motion** (animation), lucide-react.

## UI/UX HIỆN ĐẠI
- Phong cách tối giản, sạch, nhiều khoảng trắng; light/dark mode, màu nhấn thống nhất (1 màu chính), bo góc lớn, đổ bóng nhẹ, font Inter/Geist.
- Layout: sidebar thu gọn được (có animation trượt), header có breadcrumb, command palette (⌘/Ctrl+K) để chuyển trang và tìm nhanh khách/hàng.
- Animation (Framer Motion, tinh tế, không gây chậm; tôn trọng `prefers-reduced-motion`):
  - Chuyển trang: fade + trượt nhẹ.
  - Danh sách/bảng: dòng xuất hiện lần lượt (stagger), hover nổi nhẹ.
  - Dialog/Sheet/Dropdown: scale + fade; Toast trượt vào.
  - Skeleton loading cho mọi bảng và thẻ; số liệu tổng tiền đếm chạy (count-up) khi thay đổi.
  - Khu vực kéo thả file: viền động khi kéo file vào, thanh tiến trình khi parse; thẻ kết quả parse hiện ra lần lượt.
  - Trạng thái rỗng có minh họa SVG đơn giản + nút hành động.
- Responsive (dùng tốt trên laptop 1366px; mobile xem được). Truy cập được (focus ring, nhãn aria, thao tác bàn phím).
- Giao diện toàn bộ tiếng Việt; tiền định dạng 1.234.567 ₫; ngày dd/MM/yyyy.

## XÁC THỰC & PHÂN QUYỀN (JWT)
- **Đăng ký**: `POST /api/auth/register` (họ tên, email, mật khẩu ≥ 8 ký tự, có kiểm tra độ mạnh). Cấu hình `REGISTRATION_MODE` = `open` | `approval` (mặc định `approval`: tài khoản mới ở trạng thái `pending`, admin duyệt mới đăng nhập được) | `closed`.
- **Đăng nhập**: `POST /api/auth/login` → trả **access token** (JWT, hết hạn 15 phút, trả trong body, client giữ trong bộ nhớ) và **refresh token** (JWT/chuỗi ngẫu nhiên, hết hạn 7 ngày, đặt trong cookie `httpOnly; Secure; SameSite=Strict`, chỉ lưu bản **hash** trong DB).
- `POST /api/auth/refresh` (xoay vòng refresh token mỗi lần dùng, phát hiện dùng lại token cũ thì thu hồi toàn bộ phiên của user đó), `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`.
- Mật khẩu hash bằng argon2id. Khóa tạm tài khoản/IP sau nhiều lần đăng nhập sai (rate limit riêng cho `/auth/*`).
- Vai trò: `admin` (quản lý user, cấu hình, xóa dữ liệu) và `accountant` (thao tác nghiệp vụ). Middleware `requireAuth`, `requireRole`. Mọi route `/api/*` (trừ `/auth/*`, `/setup/*`, `/health`) bắt buộc đăng nhập.
- Trang quản trị user (admin): danh sách, duyệt/khóa tài khoản, đổi vai trò, reset mật khẩu.
- Frontend: axios/fetch interceptor tự gọi refresh khi 401 một lần rồi gửi lại request; route guard theo vai trò; tự đăng xuất khi refresh thất bại.
- Bảo mật chung: helmet, CORS chỉ cho origin cấu hình, validate toàn bộ input bằng zod, giới hạn kích thước/loại file upload (pdf, xls, xlsx; tối đa 10 MB/file), tên file lưu ngẫu nhiên, không tin tên file gốc.

## SETUP LẦN ĐẦU (first-run wizard)
Bảng `app_settings` lưu cờ `setup_completed`. Khi chưa hoàn tất, mọi trang frontend chuyển hướng về `/setup`, và các API nghiệp vụ trả 428 (hoặc bị chặn). Wizard 3 bước, có animation chuyển bước và thanh tiến trình:
1. **Tạo tài khoản admin**: họ tên, email, mật khẩu.
2. **Import danh mục (chỉ làm ở bước setup này)**: upload file Excel mẫu (như `HĐ-_mẫu.xlsx`) chứa sheet **DSKH** và sheet **DSHH/DSSP**.
   - Bước xem trước: hiển thị số dòng, 10 dòng đầu, các dòng lỗi/trùng (MST rỗng, mã trùng, ĐVT rỗng).
   - Cột DSKH: Mã số thuế, Đơn vị mua hàng, Tên người mua hàng, CCCD, Địa chỉ, Email, Số tài khoản, Mã ĐV quan hệ ngân sách. Cột DSSP: Mã hàng hóa, Tên hàng hóa, Đơn vị tính. Tìm cột theo tên tiêu đề (không theo vị trí cố định), bỏ khoảng trắng thừa, MST/mã hàng luôn giữ dạng TEXT.
   - Xác nhận mới ghi: chạy trong 1 transaction, trả số bản ghi thêm/bỏ qua/lỗi, tải được file báo cáo lỗi.
   - (Tùy chọn) upload thêm file lịch sử hóa đơn đã xuất (ExportFast.xlsx) vào `sales_history` để đối chiếu mã hàng, gợi ý giá, cảnh báo xuất trùng.
3. **Hoàn tất**: ghi `setup_completed = true`, đăng nhập admin, chuyển vào dashboard.
- `GET /api/setup/status`, `POST /api/setup/admin`, `POST /api/setup/import/preview`, `POST /api/setup/import/commit`, `POST /api/setup/complete`. Sau khi `setup_completed = true`, **toàn bộ `/api/setup/*` trả 403 vĩnh viễn** (không còn import hàng loạt từ UI). Sau đó danh mục chỉ thay đổi bằng CRUD từng bản ghi.
- Nếu bước 2 bị gián đoạn (đóng trình duyệt), wizard phải tiếp tục được từ bước đang dở.

## DATABASE (Drizzle schema, SQLite)
Tất cả bảng có `id`, `created_at`, `updated_at` (ngày giờ lưu ISO). Bật `PRAGMA foreign_keys = ON`, `journal_mode = WAL`. Migration bằng drizzle-kit, tự chạy khi khởi động.

- **users**: email (UNIQUE), password_hash, full_name, role ('admin'|'accountant'), status ('pending'|'active'|'locked'), failed_login_count, locked_until
- **refresh_tokens**: user_id (FK), token_hash, expires_at, revoked_at, replaced_by, user_agent, ip
- **app_settings**: key (UNIQUE), value (vd `setup_completed`)
- **customers (DSKH)**: tax_code (TEXT UNIQUE, có thể dạng 0102744230-002), name, address, email, buyer_name, id_card (CCCD), bank_account, budget_unit_code, source ('IMPORT'|'MANUAL'|'TAX_LOOKUP')
- **products (DSSP)**: code (UNIQUE, tìm không phân biệt hoa thường), name, unit
- **product_aliases**: alias_text (UNIQUE, đã chuẩn hóa), product_id (FK)
- **customer_aliases**: alias_text (UNIQUE, đã chuẩn hóa), customer_id (FK)
- **quote_files**: original_name, stored_path, file_hash (UNIQUE), uploaded_by (FK users), parse_status ('parsed'|'needs_review'|'failed'), parsed_json, error_message
- **quotes**: quote_no (UNIQUE), quote_date, customer_id (FK, nullable tới khi ghép xong), quote_file_id (FK), declared_subtotal, declared_vat, declared_total, validity_days, note
- **invoices**: quote_id (FK nullable), customer_id (FK), payment_method (mặc định 'Chuyển khoản'), status ('draft'|'exported'), created_by (FK users), exported_at
- **invoice_lines**: invoice_id (FK, ON DELETE CASCADE), product_id (FK), qty (REAL), unit_price (INTEGER, VND), tax_rate (REAL, mặc định 0.08), sort_order
- **sales_history**: invoice_no, invoice_date, customer_tax_code, product_code, product_name, unit, qty, unit_price (INTEGER), tax_rate
- **audit_logs**: user_id, action, entity, entity_id, detail_json (ghi lại tạo/sửa/xóa/xuất file)
- Index: `sales_history(customer_tax_code, product_code)`, `customers(tax_code)`, `products(code)`, `quotes(quote_no)`.
- Tiền lưu số nguyên VND; thuế suất lưu dạng 0.08 (không lưu chuỗi "8%").

## PYTHON PARSER SERVICE (`/parser`, FastAPI)
Chỉ làm đúng một việc: **đọc file báo giá và trả JSON có cấu trúc**, không ghép khách/hàng (việc đó ở Express vì cần DB).

- `POST /parse` (multipart: file) → trả `ParsedQuote`. `GET /health`. Mọi request phải có `X-Internal-Key` đúng, sai trả 401. Giới hạn kích thước file và thời gian xử lý (timeout), không lưu file lâu dài (xử lý xong xóa file tạm).
- **PDF**: dùng pdfplumber, dựng lại dòng/cột từ tọa độ chữ và đường kẻ bảng. PDF không có text layer (ảnh scan) → trả `error_code: "NO_TEXT_LAYER"` kèm thông báo rõ ràng (chừa chỗ gắn OCR sau).
- **.xlsx**: openpyxl (đọc giá trị đã tính, `data_only=True`); **.xls**: xlrd. Duyệt các sheet, chọn sheet có bảng hàng hóa. Xử lý ô gộp (merged cells).
- **Không dò theo số ô cố định**: các nhân viên kinh doanh dùng bố cục khác nhau. Dò dòng tiêu đề bảng theo từ khóa (TT/STT, Chủng loại/Thông số/Tên hàng, ĐV/ĐVT, SL/Số lượng, Đơn giá, Thành tiền; chuẩn hóa bỏ dấu, hoa/thường) rồi suy ra vị trí cột.
- **Cần bóc tách:**
  - `buyer_name` (dòng "Kính gửi"), `buyer_tax_code` (MST 10 hoặc 13 số, có thể thiếu), `quote_no` ("Số BG", "Số báo giá", "Số:"), `quote_date` ("Hà Nội, ngày dd tháng mm năm yyyy" hoặc dd/mm/yyyy), người gửi/người nhận (tham khảo).
  - `lines[]`: `line_no`, `name`, `unit`, `qty`, `unit_price`, `amount`, `model` (từ dòng "Model:" hoặc mã trong tên), `brand`, `origin` (từ "Hãng SX", "Xuất xứ", "Sản xuất tại"), `spec_text`.
    - Dòng hàng chính = dòng có số lượng + đơn giá + thành tiền. Các dòng bên dưới không có số liệu (Hãng SX, Model, thông số, ghi chú như "máy không bao gồm động cơ") gộp vào `spec_text` của dòng hàng phía trên.
    - Số tiền dạng `11,200,000`, `11.200.000`, `11 200 000` đều đọc đúng; số lượng có thể thập phân.
  - `declared_subtotal`, `declared_vat`, `declared_total`, `tax_rate` (từ "Thuế VAT (8%)", "VAT 8%"...). Các dòng tổng không được coi là hàng hóa.
  - `payment_terms` (nếu có chữ "chuyển khoản" → 'Chuyển khoản'), `validity_days` (vd "hiệu lực 15 ngày").
- Mỗi trường có `confidence` ('high'|'medium'|'low'); mảng `warnings[]` (vd tổng các dòng lệch tổng khai báo, không tìm thấy MST, bảng nhiều khối).
- Kiến trúc nội bộ: interface `QuoteParser` (`PdfTableParser`, `ExcelTableParser`), dễ thêm parser mới. Tùy chọn `LlmFallbackParser` (gọi Claude API khi confidence thấp) **mặc định TẮT**, bật bằng biến môi trường và phải hiển thị cho người dùng biết nội dung sẽ được gửi ra ngoài.
- Test bằng pytest với thư mục `/parser/tests/fixtures` (các báo giá mẫu PDF/xls + file `.expected.json` để test hồi quy).

## EXPRESS API (prefix /api, zod validate, lỗi trả `{error, details}`)
**Customers (DSKH) – CRUD đầy đủ**
- `GET /customers?search=&page=&pageSize=&sort=` (tìm theo MST/tên, phân trang server-side), `GET /customers/:id`, `POST`, `PUT /:id`, `DELETE /:id`.
- Trùng `tax_code` → 409. Không cho xóa nếu đang được hóa đơn/báo giá tham chiếu (409, thông báo rõ).
**Products (DSSP) – CRUD đầy đủ**: tương tự, tìm theo code/name, trùng code → 409.
- Xuất danh mục ra Excel: `GET /export/customers.xlsx`, `GET /export/products.xlsx` (không có chức năng import hàng loạt ngoài bước setup).
- Tra cứu MST: `POST /customers/lookup-tax {taxCode}`; nếu không có trong DB thì gọi service tra cứu (module tách riêng, có timeout, có thể tắt bằng cấu hình) để điền sẵn tên/địa chỉ, không có kết quả thì cho nhập tay. Ghi `source = 'TAX_LOOKUP'`.
**Quotes (đọc báo giá)**
- `POST /quotes/parse`: nhận 1 hoặc nhiều file → lưu vào `quote_files` (kiểm tra `file_hash` trùng) → gọi Python `/parse` → chạy **ghép khách/hàng** và **kiểm tra cảnh báo** (xem bên dưới) → trả bản nháp để người dùng duyệt (chưa tạo hóa đơn).
- `POST /quotes/confirm`: nhận bản nháp đã chỉnh sửa → trong 1 transaction lưu `quotes` + `invoices` (draft) + `invoice_lines`, đồng thời lưu `product_aliases`/`customer_aliases` từ các ghép nối người dùng chọn tay (nếu người dùng đồng ý "ghi nhớ").
- `GET /quotes`, `GET /quotes/:id`, `DELETE /quotes/:id`.
**Invoices**
- CRUD hóa đơn nháp kèm lines (người dùng chỉ thấy/sửa hóa đơn của mình, admin thấy tất cả).
- `GET /products/suggest?q=`, `GET /history/last-price?customer=&product=`, `GET /invoices/:id/duplicate-check`.
- `POST /invoices/export`: nhận danh sách invoice id → trả file .xlsx (quy tắc bên dưới), đổi trạng thái `exported`.
**Admin**: `GET/PATCH /admin/users`, `GET /admin/audit-logs`.

## ĐỐI CHIẾU SAU KHI PARSE (thực hiện ở Express)
**Ghép khách hàng (thứ tự ưu tiên)**
1. MST trùng `customers.tax_code` (bỏ khoảng trắng/dấu chấm).
2. `customer_aliases` theo tên chuẩn hóa.
3. Khớp gần đúng theo tên (bỏ dấu, bỏ "CÔNG TY/TNHH/CP/CỔ PHẦN..."); chỉ tự động nhận khi điểm cao và duy nhất, còn lại trả danh sách ứng viên cho người dùng chọn.
4. Không có → trạng thái `new_customer`: UI mở form thêm khách, điền sẵn tên + MST đọc được, gọi tra cứu MST.
**Ghép hàng hóa (luôn ưu tiên DSSP có sẵn)**
1. `model` trùng khớp `products.code` (không phân biệt hoa thường, bỏ khoảng trắng).
2. `product_aliases`.
3. Model nằm trong tên hàng/mã hoặc ngược lại (vd báo giá "HD340", danh mục có `HD340-F053A`, `HD340.F053A`) → trả danh sách ứng viên, xếp hạng theo: khớp tên, khớp xuất xứ (Trung Quốc → mã có hậu tố `(TQ)`), mã từng bán cho khách này trong `sales_history`.
4. Khớp gần đúng theo tên hàng.
5. Không có → `unmatched`: bắt buộc chọn mã có sẵn hoặc tạo hàng hóa mới trước khi xác nhận.
**Cảnh báo (trả kèm kết quả)**
- Tổng các dòng (SL × đơn giá) lệch `declared_subtotal`; VAT tính lại lệch `declared_vat`.
- Số báo giá đã tồn tại, hoặc file đã upload (hash trùng).
- Báo giá quá hạn hiệu lực.
- Nguy cơ xuất trùng: `sales_history` đã có cùng khách + cùng mã + cùng SL + cùng đơn giá trong 30 ngày (chỉ cảnh báo từng dòng, không tự bỏ dòng).
- Đơn giá lệch lớn so với giá bán gần nhất cho khách này.
- Trường có `confidence = low` được đánh dấu để UI tô vàng.

## QUY TẮC XUẤT EXCEL (rất quan trọng)
Sheet **"mẫu hđ"**, dòng 1 là header đúng thứ tự:
`Masothue | Tennguoimua | Tencongty | Diachi | Email | Sotaikhoan | MaDL | Nganhang | HinhthucTT | MaSP | TenSP | Tinhchathanghoa | Donvitinh | Soluong | Dongia | ThueGTGT | CCCD | MaQHNS`
- Mỗi dòng hàng lặp lại đầy đủ thông tin khách hàng.
- Giữa các hóa đơn khác nhau chèn đúng **1 dòng trắng**.
- Masothue, MaSP lưu dạng text; Tinhchathanghoa = "1" (hàng hóa, dịch vụ).
- Soluong, Dongia là số, format `#,##0`.
- ThueGTGT ghi số `0.08` nhưng đặt `number_format = '0%'` để hiển thị **8%** (tuyệt đối không hiển thị 0.08). Hỗ trợ 0, 0.05, 0.08, 0.1, 'KCT', 'KKKNT'.
- Không để hyperlink mailto tự sinh ở cột Email.
- Tên/ĐVT hàng lấy từ DSSP, không lấy từ báo giá.

## FRONTEND (React + shadcn + TypeScript)
Sidebar: Tổng quan, **Nhập báo giá**, Hóa đơn, Khách hàng, Sản phẩm, Lịch sử báo giá, Quản trị (admin).
1. **Đăng nhập / Đăng ký**: form đẹp, chia đôi màn hình (minh họa + form), hiển thị lỗi inline, trạng thái "chờ admin duyệt" sau khi đăng ký.
2. **Setup wizard** (xem mục SETUP): stepper có animation, xem trước dữ liệu import dạng bảng, báo lỗi theo dòng.
3. **Khách hàng & Sản phẩm (CRUD hoàn chỉnh)**:
   - DataTable (TanStack Table): tìm kiếm debounce 300ms, sắp xếp, phân trang server-side, chọn nhiều dòng, ẩn/hiện cột.
   - "Thêm mới"/Sửa bằng Dialog (react-hook-form + zod, kiểm tra trùng MST/mã ngay khi rời ô), xóa bằng AlertDialog, toast kết quả.
   - Skeleton, trạng thái rỗng, nút Export Excel.
4. **Nhập báo giá** (tính năng cốt lõi):
   - Kéo thả nhiều file, tiến trình theo từng file, mỗi file là một thẻ kết quả.
   - Mỗi thẻ 2 cột: trái là bản xem nội dung gốc (PDF viewer / bảng Excel), phải là hóa đơn nháp chỉnh sửa được: Combobox khách (gợi ý sẵn), bảng dòng hàng (Combobox mã hàng, SL, đơn giá có gợi ý giá gần nhất, thuế suất mặc định 8%, thành tiền), tổng chưa VAT / VAT / tổng thanh toán (count-up), danh sách cảnh báo.
   - Dòng chưa ghép được tô đỏ, nút "Xác nhận" bị khóa tới khi xử lý hết; trường độ tin cậy thấp tô vàng.
   - Khi chọn tay một ghép nối hiện hỏi "Ghi nhớ cho lần sau?" (mặc định bật).
   - "Xác nhận tất cả" → lưu các hóa đơn nháp và chuyển sang trang Hóa đơn.
5. **Hóa đơn**: danh sách + lọc theo trạng thái/ngày/khách, chọn nhiều hóa đơn nháp rồi "Xuất Excel", xem/sửa hóa đơn, cảnh báo xuất trùng.
6. **Quản trị**: duyệt/khóa user, nhật ký thao tác.

## CHẤT LƯỢNG, TRIỂN KHAI
- `docker-compose.yml` chạy 3 service (web/api gộp hoặc tách nginx, parser nội bộ), volume cho `app.db` và thư mục upload; `.env.example` đầy đủ (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_KEY`, `REGISTRATION_MODE`, `PARSER_URL`, `CORS_ORIGIN`...). Không commit secret.
- Xử lý lỗi tập trung (middleware), log có cấu trúc, `/health` cho cả 3 service; khi Python service tắt, API trả thông báo thân thiện chứ không crash.
- Seed script dữ liệu demo cho môi trường dev.
- Test: API (vitest + supertest: auth, phân quyền, khóa setup sau khi hoàn tất, CRUD, chặn xóa khi có tham chiếu, export Excel: định dạng 8% + dòng trắng giữa hóa đơn), parser (pytest với báo giá mẫu), và vài test e2e luồng chính (Playwright: setup → đăng nhập → upload báo giá → xác nhận → xuất Excel).
- README: cách chạy dev, build, deploy bằng docker, sao lưu file SQLite.

## THỨ TỰ THỰC HIỆN
1. Khung monorepo + docker-compose + schema Drizzle + migration.
2. Auth JWT (đăng ký/đăng nhập/refresh/phân quyền) + trang đăng nhập/đăng ký.
3. Setup wizard (tạo admin + import DSKH/DSSP + khóa setup).
4. CRUD Khách hàng / Sản phẩm (API + UI).
5. Python parser service + test với báo giá mẫu.
6. Ghép khách/hàng + cảnh báo + màn hình Nhập báo giá.
7. Hóa đơn + xuất Excel đúng mẫu.
8. Quản trị user, audit log, hoàn thiện UI/animation, e2e, tài liệu.

Sau mỗi bước, chạy thử và báo kết quả (kèm cách kiểm tra) trước khi sang bước tiếp theo.
