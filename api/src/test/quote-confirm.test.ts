import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestEnv } from './helpers.js';

const env = setupTestEnv();
const { createApp } = await import('../index.js');
const { getRawDb, closeDb } = await import('../db/index.js');
const { setSetting } = await import('../lib/settings.js');

const app = createApp();
const raw = getRawDb();
let token = '';
let customerId = 0;
let productId = 0;

const FILE_HASH = 'hash-confirm-quote-1';

beforeAll(async () => {
  setSetting('setup_completed', 'true');
  await request(app).post('/api/auth/register').send({
    fullName: 'Kế toán xác nhận',
    email: 'confirm@test.vn',
    password: 'Ketoan123',
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'confirm@test.vn', password: 'Ketoan123' });
  token = login.body.accessToken;
  expect(token).toBeTruthy();

  const now = new Date().toISOString();
  customerId = Number(
    raw
      .prepare(
        `INSERT INTO customers (created_at, updated_at, tax_code, name, address, email, buyer_name, id_card, bank_account, budget_unit_code, source)
         VALUES (?, ?, ?, ?, '', '', '', '', '', '', 'MANUAL')`,
      )
      .run(now, now, '0109998887', 'Công ty xác nhận').lastInsertRowid,
  );
  productId = Number(
    raw
      .prepare('INSERT INTO products (created_at, updated_at, code, name, unit) VALUES (?, ?, ?, ?, ?)')
      .run(now, now, 'QC-1', 'Hàng xác nhận', 'Cái').lastInsertRowid,
  );
  raw
    .prepare(
      `INSERT INTO quote_files (created_at, updated_at, original_name, stored_path, file_hash, uploaded_by, parse_status, parsed_json)
       VALUES (?, ?, ?, ?, ?, NULL, 'parsed', ?)`,
    )
    .run(now, now, 'bao-gia.pdf', 'x', FILE_HASH, JSON.stringify({ quote_no: '' }));
});

afterAll(() => {
  closeDb();
  env.cleanup();
});

const payload = (quoteNo: string) => ({
  quoteNo,
  quoteDate: null,
  customerId,
  fileHash: FILE_HASH,
  declaredSubtotal: null,
  declaredVat: null,
  declaredTotal: null,
  validityDays: null,
  note: '',
  lines: [{ productId, qty: 1, unitPrice: 1000, taxRate: 0.08 }],
});

const confirm = (quoteNo: string) =>
  request(app)
    .post('/api/quotes/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send(payload(quoteNo));

describe('xác nhận báo giá', () => {
  it('để trống số báo giá vẫn lưu được và tự sinh mã', async () => {
    const res = await confirm('');
    expect(res.status).toBe(201);
    expect(res.body.quote.quoteNo).toMatch(/^BG-\d{8}-\d{3}$/);
  });

  it('mỗi lần để trống sinh mã khác nhau', async () => {
    const a = await confirm('');
    const b = await confirm('');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.quote.quoteNo).not.toBe(b.body.quote.quoteNo);
  });

  it('vẫn báo trùng khi người dùng nhập số đã tồn tại', async () => {
    const first = await confirm('BG-NGUOI-DUNG-001');
    expect(first.status).toBe(201);
    const dup = await confirm('BG-NGUOI-DUNG-001');
    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain('đã tồn tại');
  });
});
