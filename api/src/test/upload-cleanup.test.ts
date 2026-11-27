import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextVnMidnight, purgeUploadedFiles } from '../services/upload-cleanup.js';

const HASH = 'a'.repeat(64);

describe('nextVnMidnight', () => {
  it('trả về 00:00 GMT+7 kế tiếp (17:00 UTC)', () => {
    // 2026-11-27 14:39 UTC = 21:39 GMT+7 -> nửa đêm kế tiếp là 2026-11-28 00:00 GMT+7 = 2026-11-27 17:00 UTC
    const now = Date.UTC(2026, 10, 27, 14, 39);
    expect(nextVnMidnight(now)).toBe(Date.UTC(2026, 10, 27, 17, 0));
  });

  it('đúng 00:00 GMT+7 thì hẹn sang ngày hôm sau, không chạy lặp ngay', () => {
    const now = Date.UTC(2026, 10, 27, 17, 0);
    expect(nextVnMidnight(now)).toBe(Date.UTC(2026, 10, 28, 17, 0));
  });

  it('sau 17:00 UTC (đã sang ngày mới theo GMT+7) thì hẹn 17:00 UTC hôm sau', () => {
    const now = Date.UTC(2026, 10, 27, 20, 0);
    expect(nextVnMidnight(now)).toBe(Date.UTC(2026, 10, 28, 17, 0));
  });
});

describe('purgeUploadedFiles', () => {
  it('xóa file gốc và bản cache xem trước, giữ lại file lạ', () => {
    const root = mkdtempSync(join(tmpdir(), 'idleinvoice-upl-'));
    try {
      const dir = join(root, 'quotes');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${HASH}.docx`), 'x');
      writeFileSync(join(dir, `${HASH}.view.xlsx`), 'x');
      writeFileSync(join(dir, 'ghi-chu.txt'), 'giữ lại');

      expect(purgeUploadedFiles(root)).toBe(2);
      expect(existsSync(join(dir, `${HASH}.docx`))).toBe(false);
      expect(existsSync(join(dir, `${HASH}.view.xlsx`))).toBe(false);
      expect(existsSync(join(dir, 'ghi-chu.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('thư mục chưa tồn tại thì trả về 0', () => {
    expect(purgeUploadedFiles(join(tmpdir(), 'idleinvoice-khong-ton-tai'))).toBe(0);
  });
});
