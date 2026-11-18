// tsc không copy file .sql sang dist — chép thủ công sau khi build.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'src', 'db', 'migrations');
const to = join(root, 'dist', 'db', 'migrations');

if (!existsSync(from)) {
  console.error(`Không tìm thấy thư mục migrations: ${from}`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`Đã chép migrations -> ${to}`);
