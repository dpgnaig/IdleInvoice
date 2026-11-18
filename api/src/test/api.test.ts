import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { setupTestEnv } from './helpers.js';

const env = setupTestEnv();
// import sau khi env đã set
const { createApp } = await import('../index.js');
const { getRawDb } = await import('../db/index.js');
const { setSetting } = await import('../lib/settings.js');

const app = createApp();
let agent = request.agent(app);
let accessToken = '';
let refreshCookie = '';
let adminToken = '';

async function login(email: string, password: string) {
  const res = await agent.post('/api/auth/login').send({ email, password });
  return res;
}

beforeAll(async () => {
  // setup hoàn tất + admin
  setSetting('setup_completed', 'true');
  const raw = getRawDb();
  const now = new Date().toISOString();
  // tạo admin trực tiếp qua API register rồi nâng quyền
  await request(app).post('/api/auth/register').send({
    fullName: 'Quản trị viên',
    email: 'admin@test.vn',
    password: 'Admin1234',
  });
  raw.prepare("UPDATE users SET role='admin', status='active' WHERE email='admin@test.vn'").run();
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.vn', password: 'Admin1234' });
  adminToken = res.body.accessToken;
  expect(adminToken).toBeTruthy();

  await request(app).post('/api/auth/register').send({
    fullName: 'Kế toán A',
    email: 'kt@test.vn',
    password: 'Ketoan123',
  });
  const r2 = await login('kt@test.vn', 'Ketoan123');
  accessToken = r2.body.accessToken;
  refreshCookie = r2.headers['set-cookie']?.[0] ?? '';
  expect(accessToken).toBeTruthy();
  expect(refreshCookie).toContain('ii_refresh=');
  expect(refreshCookie.toLowerCase()).toContain('httponly');
  expect(now).toBeTruthy();
});

afterAll(async () => {
  const { closeDb } = await import('../db/index.js');
  closeDb();
  env.cleanup();
});

describe('auth', () => {
  it('đăng nhập trả access token 15m và refresh cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kt@test.vn', password: 'Ketoan123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const payload = JSON.parse(
      Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
    );
    expect(payload.exp - payload.iat).toBe(900);
    expect(res.headers['set-cookie']![0]).toContain('HttpOnly');
  });

  it('sai mật khẩu trả 401 và không lộ thông tin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kt@test.vn', password: 'sai-mat-khau' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Email hoặc mật khẩu không đúng');
  });

  it('khóa tài khoản sau 5 lần sai', async () => {
    await request(app).post('/api/auth/register').send({
      fullName: 'Người bị khóa',
      email: 'lock@test.vn',
      password: 'Lock12345',
    });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: 'lock@test.vn', password: 'sai' });
    }
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'lock@test.vn', password: 'Lock12345' });
    expect(res.status).toBe(423);
    expect(res.body.error).toContain('tạm khóa');
  });

  it('refresh token xoay vòng và dùng lại token cũ bị thu hồi', async () => {
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kt@test.vn', password: 'Ketoan123' });
    const cookie1 = first.headers['set-cookie']![0]!;

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', cookie1);
    expect(rotated.status).toBe(200);
    expect(rotated.body.accessToken).toBeTruthy();
    const cookie2 = rotated.headers['set-cookie']![0]!;
    expect(cookie2).not.toBe(cookie1);

    // dùng lại token cũ -> 401
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', cookie1);
    expect(reuse.status).toBe(401);

    // token mới cũng bị thu hồi do phát hiện dùng lại
    const after = await request(app).post('/api/auth/refresh').set('Cookie', cookie2);
    expect(after.status).toBe(401);
  });

  it('chặn truy cập khi không có token', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
  });

  it('logout thu hồi refresh token', async () => {
    const l = await request(app)
      .post('/api/auth/login')
      .send({ email: 'kt@test.vn', password: 'Ketoan123' });
    const cookie = l.headers['set-cookie']![0]!;
    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    const r = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(r.status).toBe(401);
  });
});

describe('customers CRUD', () => {
  let id = 0;
  it('tạo khách hàng', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        taxCode: '0102744230-002',
        name: 'CÔNG TY CỔ PHẦN CÔNG NGHỆ XỬ LÝ NƯỚC',
        address: 'Hà Nội',
        email: 'a@b.vn',
        buyerName: 'Nguyễn Văn A',
        idCard: '001200012345',
        bankAccount: '123456789',
        budgetUnitCode: 'M01',
      });
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(res.body.source).toBe('MANUAL');
  });

  it('trùng MST trả 409', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taxCode: '0102744230-002', name: 'Trùng MST' });
    expect(res.status).toBe(409);
    expect(res.body.details.id).toBe(id);
  });

  it('tìm kiếm + phân trang', async () => {
    const res = await request(app)
      .get('/api/customers?search=0102744230&page=1&pageSize=10')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('cập nhật khách hàng', async () => {
    const res = await request(app)
      .put(`/api/customers/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taxCode: '0102744230-002', name: 'Tên mới' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Tên mới');
  });
});

describe('products CRUD + ràng buộc', () => {
  let id = 0;
  it('tạo sản phẩm, mã chuẩn hóa', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: 'hd340.f053a', name: 'Đĩa phân phối khí Jaeger HD340', unit: 'Cái' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('HD340.F053A');
    id = res.body.id;
  });

  it('trùng mã hàng (khác hoa thường) trả 409', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: 'HD340.F053A', name: 'X', unit: 'Cái' });
    expect(res.status).toBe(409);
  });

  it('kế toán không được xóa sản phẩm (403)', async () => {
    const res = await request(app)
      .delete(`/api/products/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('admin xóa được sản phẩm không tham chiếu', async () => {
    const res = await request(app)
      .delete(`/api/products/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe('invoices + export Excel', () => {
  let customerId = 0;
  let productId = 0;
  let invoiceId = 0;
  let invoice2Id = 0;

  beforeAll(async () => {
    const c = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        taxCode: '0110717304',
        name: 'CÔNG TY CỔ PHẦN TM VÀ XNK NGUYÊN PHÁT',
        address: 'Số 12 Hưng Phúc, Hà Nội',
        email: 'np@example.vn',
        buyerName: 'Chị Tú',
        idCard: '',
        bankAccount: '0123456789',
        budgetUnitCode: 'QH01',
      });
    customerId = c.body.id;
    const p = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code: 'HD340', name: 'Đĩa phân phối khí tinh Jaeger HD340', unit: 'Cái' });
    productId = p.body.id;
    const inv = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        customerId,
        paymentMethod: 'Chuyển khoản',
        lines: [{ productId, qty: 9, unitPrice: 430000, taxRate: 0.08 }],
      });
    invoiceId = inv.body.id;
    const inv2 = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        customerId,
        paymentMethod: 'Tiền mặt',
        lines: [{ productId, qty: 2, unitPrice: 100000, taxRate: 'KCT' }],
      });
    invoice2Id = inv2.body.id;
  });

  it('tính tổng đúng', async () => {
    const res = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.subtotal).toBe(3_870_000);
    expect(res.body.vat).toBeCloseTo(309_600, 5);
  });

  it('chặn xóa khách hàng đang có hóa đơn (409)', async () => {
    const res = await request(app)
      .delete(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('tham chiếu');
  });

  it('xuất Excel: header đúng, 8% hiển thị 0%, dòng trắng giữa hóa đơn', async () => {
    const res = await request(app)
      .post('/api/invoices/export')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ids: [invoiceId, invoice2Id] })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('mẫu hđ');
    expect(ws).toBeTruthy();
    const header = (ws!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      'Masothue', 'Tennguoimua', 'Tencongty', 'Diachi', 'Email', 'Sotaikhoan',
      'MaDL', 'Nganhang', 'HinhthucTT', 'MaSP', 'TenSP', 'Tinhchathanghoa',
      'Donvitinh', 'Soluong', 'Dongia', 'ThueGTGT', 'CCCD', 'MaQHNS',
    ]);
    const row2 = ws!.getRow(2);
    expect(row2.getCell(1).value).toBe('0110717304');
    expect(row2.getCell(10).value).toBe('HD340');
    expect(row2.getCell(12).value).toBe('1');
    expect(row2.getCell(14).value).toBe(9);
    expect(row2.getCell(15).value).toBe(430000);
    expect(row2.getCell(16).value).toBe(0.08);
    expect(row2.getCell(16).numFmt).toBe('0%');
    // hóa đơn 2 ở dòng 4 (dòng 3 trắng)
    const row3 = ws!.getRow(3);
    const row3Values = (row3.values as unknown[]) ?? [];
    expect(row3Values.filter((v) => v !== undefined && v !== null).length).toBe(0);
    const row4 = ws!.getRow(4);
    expect(row4.getCell(16).value).toBe('KCT');
    // trạng thái chuyển exported
    const inv = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(inv.body.status).toBe('exported');
  });

  it('hóa đơn đã xuất không sửa được với kế toán', async () => {
    const res = await request(app)
      .put(`/api/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ customerId, lines: [{ productId, qty: 1, unitPrice: 1, taxRate: 0.08 }] });
    expect(res.status).toBe(409);
  });
});

describe('admin', () => {
  it('kế toán không vào được /admin/users', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('admin duyệt tài khoản pending', async () => {
    process.env.REGISTRATION_MODE = 'approval';
    // tạo user pending trực tiếp trong DB (register theo mode hiện tại)
    const raw = getRawDb();
    const { hashPassword } = await import('../lib/password.js');
    const now = new Date().toISOString();
    raw
      .prepare(
        "INSERT INTO users (created_at, updated_at, email, password_hash, full_name, role, status) VALUES (?,?,?,?,?,'accountant','pending')",
      )
      .run(now, now, 'pending@test.vn', await hashPassword('Pending123'), 'Chờ duyệt');
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pending@test.vn', password: 'Pending123' });
    expect(loginRes.status).toBe(403);

    const list = await request(app)
      .get('/api/admin/users?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    const user = list.body.data.find((u: { email: string }) => u.email === 'pending@test.vn');
    expect(user).toBeTruthy();

    const patch = await request(app)
      .patch(`/api/admin/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });
    expect(patch.status).toBe(200);

    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pending@test.vn', password: 'Pending123' });
    expect(login2.status).toBe(200);
    process.env.REGISTRATION_MODE = 'open';
  });

  it('admin xem audit log có bản ghi tạo khách hàng', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((l: { entity: string }) => l.entity === 'customer')).toBe(true);
  });
});

describe('setup bị khóa sau khi hoàn tất', () => {
  it('mọi /api/setup/* trả 403', async () => {
    for (const [method, path] of [
      ['get', '/api/setup/status'],
      ['post', '/api/setup/admin'],
      ['post', '/api/setup/import/preview'],
      ['post', '/api/setup/import/commit'],
      ['post', '/api/setup/complete'],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});
