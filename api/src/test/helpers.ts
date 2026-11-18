import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Thiết lập env cho test TRƯỚC khi import app. */
export function setupTestEnv(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'ii-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = join(dir, 'app.db');
  process.env.UPLOAD_DIR = join(dir, 'uploads');
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
  process.env.INTERNAL_KEY = 'test-internal-key';
  process.env.PARSER_URL = 'http://127.0.0.1:9';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.REGISTRATION_MODE = 'open';
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
