# Việc còn lại — IdleInvoice

Danh sách để phiên sau triển khai tiếp. Đối chiếu với `prompt_web_lap_hoa_don_v2.md` và code tại ngày 19/11/2026.

## Trạng thái hiện tại

Đã xong và chạy được cả 3 service: parser, api, web. Kiểm thử đều đạt:

| Bộ test | Kết quả |
|---|---|
| Parser (pytest) | 38/38 |
| API (vitest + supertest) | 31/31 |
| Web | typecheck + build OK |
| E2E (Playwright) | 3/3 |

Chạy lại toàn bộ: `./scripts/test-dev.sh --e2e`. Xem cách khởi động stack trong `README.md`.

Môi trường dev đang dùng: API ở cổng `3010` (`.run/api.env`, DB `.run/fresh.db`), parser ở `8011`, Vite ở `5173` với `VITE_API_TARGET=http://127.0.0.1:3010`. Đăng nhập: `admin@example.com` / `Admin12345`.

---

## P0 — Lỗi cần sửa trước

### 1. `tsc` sinh file `.js` vào `web/src`, che mất file `.tsx` khi chạy dev

- **Hiện tượng:** `web/package.json` có `"build": "tsc -p tsconfig.json && vite build"`, mà `web/tsconfig.json` không có `noEmit`. Mỗi lần build, tsc ghi 32 file `.js` cạnh file `.tsx` (vd `src/pages/quote-import.js`).
- **Hậu quả:** Vite tìm `.js` trước `.tsx`. Sau khi build một lần, sửa file `.tsx` trong lúc chạy `npm run dev` sẽ **không có tác dụng** cho đến lần build sau. Log HMR cũng báo `hmr update /src/pages/quote-import.js`.
- **Cách sửa:**
  1. Thêm `"noEmit": true` vào `compilerOptions` của `web/tsconfig.json`.
  2. Xóa các file đã sinh: `find web/src -name "*.js" -delete` (kiểm tra trước là `src` không có file `.js` viết tay nào — hiện tại cả 32 file đều có `.tsx` tương ứng).
  3. Chạy lại `npm run build` và xác nhận `find web/src -name "*.js"` không trả kết quả.
- **Kiểm tra:** sửa một chữ trong `src/pages/dashboard.tsx` khi đang chạy `npm run dev` → trình duyệt cập nhật ngay.

### 2. Combobox chỉ nạp 200 khách hàng / sản phẩm đầu tiên

- **Hiện tượng:** `quote-import.tsx` và `invoice-detail.tsx` gọi `/customers` và `/products` với `pageSize: 200` (API giới hạn tối đa 200). Danh mục thật có **4.107 khách hàng** và **1.844 sản phẩm**.
- **Hậu quả:** khách hàng/mã hàng nằm ngoài 200 dòng đầu (sắp theo tên) **không chọn tay được**. Chỉ chọn được khi bộ ghép tự động trả đúng nó trong `candidates`.
- **Cách sửa:** `Combobox` đã có sẵn prop `onSearch` + `loading` (lọc phía server) nhưng chưa nơi nào dùng. Viết hook kiểu `useRemoteOptions('/customers')` dùng `useDebounced` 300ms, gọi `?search=...&pageSize=20`, và luôn ghép option đang chọn vào danh sách để nhãn không bị mất.
- **Nơi sửa:** `web/src/pages/quote-import.tsx` (khách + dòng hàng), `web/src/pages/invoice-detail.tsx`.
- **Kiểm tra:** thêm e2e tìm một khách hàng có tên bắt đầu bằng chữ cuối bảng chữ cái rồi chọn được.

### 3. ~~Chưa có `.gitignore`~~ — đã xong (19/11/2026)

- Đã tạo `.gitignore` ở gốc, đã kiểm chứng bằng repo tạm: `.env`, `.run/`, `uploads/`, `*.db*`, `node_modules/`, `dist/`, `.venv/`, `__pycache__/`, `e2e/test-results/`, `e2e/screenshots/` đều bị bỏ qua; `.env.example` vẫn được giữ.
- Kèm rule `/web/src/**/*.js` để chặn file do `tsc` sinh ra (xem mục 1) — **file này vẫn đang tồn tại trên đĩa**, cần xóa cùng lúc sửa mục 1.
- **Còn lại:** `sample/` và `parser/tests/fixtures/` chứa dữ liệu thật của khách hàng (tên công ty, MST, giá) và **đang được track**. Trước khi push lên remote công khai phải thay bằng dữ liệu giả cùng cấu trúc cột rồi cập nhật các file `.expected.json`. Chỉ push nguyên bản khi repo là private và được phép lưu dữ liệu đó.

---

## P1 — Tính năng spec yêu cầu nhưng chưa có

### 4. Gợi ý giá gần nhất trong bảng dòng hàng
- Spec: "đơn giá có gợi ý giá gần nhất".
- API đã có `GET /api/history/last-price?customerId=&productId=` (`api/src/routes/history.ts`) nhưng web chưa gọi.
- Làm: dưới ô Đơn giá trong `quote-import.tsx` (và `invoice-detail.tsx`), hiện "Lần trước: 11.200.000 ₫ (dd/MM/yyyy)" + nút áp dụng. Gọi lại khi đổi khách hoặc mã hàng.

### 5. "Xác nhận tất cả" phải chuyển sang trang Hóa đơn
- Spec: "Xác nhận tất cả → lưu các hóa đơn nháp và chuyển sang trang Hóa đơn".
- Hiện tại chỉ toast và giữ nguyên trang (`confirmAll.onSuccess` trong `quote-import.tsx`). Thêm `navigate('/invoices')` khi tất cả thẻ đã lưu xong.
- Nên đổi vòng lặp tuần tự sang báo lỗi từng file: hiện tại một file lỗi 409 sẽ dừng cả lô, và các file đã lưu trước đó vẫn nằm trên màn hình.

### 6. Lọc hóa đơn theo ngày và khách hàng
- API `GET /invoices` đã nhận `customerId`, `from`, `to` (`api/src/routes/invoices.ts`). Web mới lọc theo trạng thái và lọc tên **phía client trên trang hiện tại**.
- Làm: thêm chọn khoảng ngày + combobox khách (dùng lại mục 2) và đẩy lên server; bỏ lọc client.

### 7. Cảnh báo xuất trùng trước khi xuất Excel
- Spec mục Hóa đơn: "cảnh báo xuất trùng". `invoice-detail.tsx` đã hiện cảnh báo từ `/invoices/:id/duplicate-check`, nhưng màn danh sách xuất hàng loạt thì không.
- Làm: trước khi xuất, gọi duplicate-check cho các id đã chọn; nếu có cảnh báo thì mở ConfirmDialog liệt kê, cho phép "Vẫn xuất".

### 8. Kiểm tra trùng MST / mã hàng ngay khi rời ô
- Spec: "kiểm tra trùng MST/mã ngay khi rời ô". Hiện chỉ báo khi submit (API trả 409).
- Làm: `onBlur` ở ô MST (`customers.tsx`) và ô mã hàng (`products.tsx`) gọi `GET /customers?search=` / `/products?search=`, so khớp chính xác, đặt lỗi bằng `form.setError`. Bỏ qua khi đang sửa chính bản ghi đó.

### 9. Khách hàng tạo từ tra cứu MST phải có `source = 'TAX_LOOKUP'`
- Spec mục Tra cứu MST: "Ghi `source = 'TAX_LOOKUP'`".
- `NewCustomerDialog` trong `quote-import.tsx` luôn gửi `source: 'MANUAL'`. Lưu cờ khi tra cứu thành công và gửi `TAX_LOOKUP`.
- Tra cứu ngoài hiện chỉ chạy khi có `TAX_LOOKUP_URL` (`lookupTaxExternal` trong `api/src/routes/admin.ts`); chưa nối nhà cung cấp thật nào. Cần quyết định dùng nguồn nào.

### 10. Tạo nhanh sản phẩm từ dòng chưa ghép được
- Dòng hàng `unmatched` hiện chỉ báo "Chưa ghép được mã hàng"; người dùng phải sang trang Sản phẩm tạo rồi quay lại (mất bản nháp vì drafts chỉ nằm trong state).
- Làm: nút "+" cạnh combobox mã hàng, mở dialog điền sẵn mã = `parsed.model`, tên = `parsed.name`, ĐVT = `parsed.unit` — giống `NewCustomerDialog`.

### 11. Xem trước file Excel gốc
- Spec: "trái là bản xem nội dung gốc (PDF viewer / bảng Excel)". PDF đã xem được qua iframe (nút "File gốc"); file `.xlsx/.xls` hiện chỉ tải về.
- Làm: endpoint trả các dòng thô (parser có thể trả thêm `raw_rows`) và hiển thị bảng chỉ đọc trong cùng dialog.

### 12. LLM fallback chỉ là khung
- `parser/app/main.py` chỉ thêm một cảnh báo khi `LLM_FALLBACK_ENABLED=true`; không gọi model nào.
- Nếu làm: thêm class `LlmQuoteParser` cùng interface `QuoteParser` (`parser/app/base.py`), chỉ chạy khi parser bảng trả độ tin cậy thấp, có timeout, mặc định **TẮT**. Phải hiện cảnh báo rõ ràng cho người dùng vì nội dung báo giá rời khỏi máy chủ.

---

## P2 — Chất lượng, triển khai

### 13. Chạy thử Docker thật
- `api/Dockerfile` (build 3 tầng) và `docker-compose.yml` đã viết nhưng **chưa build thử** vì máy dev không có Docker.
- Kiểm tra: `docker compose up -d --build`, mở `http://localhost:3000`, chạy wizard setup, nhập 1 báo giá, xuất Excel, `docker compose restart` rồi xác nhận dữ liệu còn. Thử lệnh sao lưu/khôi phục trong README.
- Điểm dễ lỗi: native module `argon2` / `better-sqlite3` trên `node:22-bookworm-slim`; quyền ghi `/data` khi chạy bằng user `node`.

### 14. Test e2e cho wizard setup
- Spec mục Test: "setup → đăng nhập → upload báo giá → xác nhận → xuất Excel". E2E hiện chạy trên DB đã seed nên bỏ qua setup.
- Làm: thêm project Playwright riêng khởi động API với DB trống (`globalSetup` xóa file DB tạm), đi qua 3 bước wizard với `sample/HĐ-_mẫu.xlsx`, rồi xác nhận `/api/setup/status` trả 403.

### 15. Dùng TanStack Table
- Spec ghi DataTable dùng TanStack Table. `web/src/components/ui/data-table.tsx` là bảng tự viết (đã có sắp xếp, chọn nhiều dòng, ẩn/hiện cột, nhớ cột vào localStorage).
- Chức năng đã đủ; chỉ chuyển nếu muốn bám sát spec. Giữ nguyên API props để không phải sửa các trang.

### 16. Tách bundle
- Bundle web ~660 KB (gzip ~200 KB), Vite cảnh báo > 500 KB.
- Làm: `React.lazy` cho các trang trong `App.tsx` (nhất là `setup`, `admin`, `quote-import`), và `manualChunks` cho `framer-motion` / `react-query`.

### 17. Ô tìm kiếm ở trang Lịch sử báo giá
- API `GET /quotes` đã có `search` (theo số báo giá), web chưa có ô nhập. Thêm ô tìm có debounce như trang Khách hàng.

### 18. Bổ sung test API
- Chưa có test cho: `GET /quotes/file/:hash` (chặn hash sai định dạng → 400), `DELETE /quotes/:id` (409 khi hóa đơn đã xuất), sắp xếp giảm dần `sort=-code` / `sort=-taxCode` (vừa sửa lỗi, cần test chống tái phát), `POST /auth/change-password` (thu hồi mọi refresh token).

---

## Ghi chú cho phiên sau

- Đọc `README.md` trước; các quyết định thiết kế chính nằm ở mục "Ghi chú nghiệp vụ".
- Khi dừng API trên Windows, `TaskStop` chỉ dừng tiến trình bọc ngoài — tiến trình `node ... tsx src/index.ts` vẫn giữ cổng. Tìm PID bằng `netstat -ano | grep :3010`, kiểm tra lệnh bằng PowerShell `Get-CimInstance Win32_Process` rồi mới `Stop-Process`.
- Chạy e2e nhiều lần sẽ chạm giới hạn đăng nhập (10 lần/15 phút). Khởi động API với `LOGIN_RATE_MAX=200 AUTH_RATE_MAX=2000` khi test.
- Vite trên máy này nghe ở `[::1]:5173` — dùng `localhost`, không dùng `127.0.0.1`.
- Sau mỗi mục: chạy `./scripts/test-dev.sh --e2e` và báo kết quả kèm cách kiểm tra (theo yêu cầu cuối spec).
