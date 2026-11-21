/**
 * Nạp biến môi trường từ file .env khi chạy trực tiếp (npm run dev / node dist).
 *
 * Thứ tự tìm: thư mục làm việc hiện tại (api/.env), rồi .env ở gốc repo.
 * Biến đã có sẵn trong môi trường KHÔNG bị ghi đè — nhờ vậy
 * `dev-all.ps1` và test vẫn điều khiển được cấu hình.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '.env')];
for (const file of candidates) {
  if (existsSync(file)) {
    config({ path: file, override: false, quiet: true });
    break;
  }
}
