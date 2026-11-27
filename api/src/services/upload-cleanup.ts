import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

// Giờ Việt Nam (GMT+7) không có giờ mùa hè -> dùng offset cố định, không phụ thuộc TZ của máy chủ/Docker.
const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

// Tên file upload luôn là "<sha256>.<ext>" hoặc "<sha256>.view.<ext>" (xem routes/quotes.ts).
const STORED_NAME_RE = /^[0-9a-f]{64}\./;

/** Mốc 00:00 GMT+7 kế tiếp (tính từ `now`), trả về epoch ms. */
export function nextVnMidnight(now: number = Date.now()): number {
  const vnNow = now + VN_OFFSET_MS;
  return (Math.floor(vnNow / DAY_MS) + 1) * DAY_MS - VN_OFFSET_MS;
}

/** Xóa toàn bộ file upload báo giá (file gốc + bản cache xem trước). Trả về số file đã xóa. */
export function purgeUploadedFiles(uploadRoot: string = process.env.UPLOAD_DIR ?? './uploads'): number {
  const dir = join(uploadRoot, 'quotes');
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !STORED_NAME_RE.test(entry.name)) continue;
    try {
      unlinkSync(join(dir, entry.name));
      removed++;
    } catch (err) {
      logger.warn({ err, file: entry.name }, 'Không xóa được file upload');
    }
  }
  return removed;
}

let timer: NodeJS.Timeout | undefined;

/** Hẹn xóa file upload vào 00:00 GMT+7 mỗi đêm. Gọi một lần khi server khởi động. */
export function startUploadCleanup(): void {
  if (timer) return;
  const schedule = () => {
    const delay = Math.max(nextVnMidnight() - Date.now(), 1000);
    timer = setTimeout(() => {
      try {
        const n = purgeUploadedFiles();
        logger.info({ removed: n }, 'Đã dọn file upload lúc 00:00 GMT+7');
      } catch (err) {
        logger.error({ err }, 'Dọn file upload thất bại');
      }
      schedule();
    }, delay);
    timer.unref();
  };
  schedule();
}

export function stopUploadCleanup(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
