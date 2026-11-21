import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { setupTestEnv } from './helpers.js';

const env = setupTestEnv();
// import sau khi env đã set
const { createApp } = await import('../index.js');
const { getRawDb } = await import('../db/index.js');
const { setSetting } = await import('../lib/settings.js');
const { matchProduct } = await import('../services/match.js');

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

  it('tìm theo tên không dấu, khác hoa thường', async () => {
    const res = await request(app)
      .get('/api/customers')
      .query({ search: 'cong nghe xu ly nuoc', pageSize: 10 })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { id: number }) => c.id)).toContain(id);
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

describe('tra cứu MST (VietQR)', () => {
  const lookup = (taxCode: string) =>
    request(app)
      .post('/api/customers/lookup-tax')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taxCode });

  const vietqrOk = (data: Record<string, unknown>) =>
    new Response(JSON.stringify({ code: '00', desc: 'Success - Thành công', data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('MST đã có trong DB thì trả về bản ghi, không gọi mạng', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await lookup('0102744230-002');
    expect(res.status).toBe(200);
    expect(res.body.inDb).toBe(true);
    expect(res.body.found).toBe(true);
    expect(res.body.customer.taxCode).toBe('0102744230-002');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('MST chưa có thì gọi VietQR và trả đủ trường để điền form', async () => {
    const { __adminInternals } = await import('../routes/admin.js');
    __adminInternals.TAX_CACHE.clear();
    const fetchSpy = vi.fn(async () =>
      vietqrOk({
        id: '2400573873',
        name: 'CÔNG TY TNHH ARK VIỆT NAM',
        internationalName: 'ARK VIETNAM COMPANY LIMITED',
        shortName: 'ARK VIETNAM CO.,LTD',
        address: 'Lô FJ-11 KCN Song Khê - Nội Hoàng, TP Bắc Ninh',
        status: 'NNT đang hoạt động',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const res = await lookup('2400573873');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      found: true,
      inDb: false,
      info: {
        taxCode: '2400573873',
        name: 'CÔNG TY TNHH ARK VIỆT NAM',
        address: 'Lô FJ-11 KCN Song Khê - Nội Hoàng, TP Bắc Ninh',
        shortName: 'ARK VIETNAM CO.,LTD',
        status: 'NNT đang hoạt động',
        source: 'vietqr',
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String((fetchSpy.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('api.vietqr.io/v2/business/2400573873');
  });

  it('MST không tồn tại (VietQR code 51) trả found=false kèm thông báo', async () => {
    const { __adminInternals } = await import('../routes/admin.js');
    __adminInternals.TAX_CACHE.clear();
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ code: '51', desc: 'Tax not found - Mã số thuế không tồn tại', data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await lookup('9999999999');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.message).toContain('Không tìm thấy');
  });

  it('dịch vụ lỗi mạng trả thông báo thay vì 500', async () => {
    const { __adminInternals } = await import('../routes/admin.js');
    __adminInternals.TAX_CACHE.clear();
    vi.stubGlobal('fetch', async () => { throw new TypeError('network down'); });
    const res = await lookup('0801172667');
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.message).toBeTruthy();
  });

  it('cache theo MST: bấm tra cứu lại không gọi mạng lần hai', async () => {
    const { __adminInternals } = await import('../routes/admin.js');
    __adminInternals.TAX_CACHE.clear();
    const fetchSpy = vi.fn(async () =>
      vietqrOk({ id: '0101243150', name: 'CÔNG TY CỔ PHẦN MISA', address: 'Hà Nội', status: 'NNT đang hoạt động' }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const first = await lookup('0101243150');
    const second = await lookup('0101243150');
    expect(first.body.found).toBe(true);
    expect(second.body.found).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('tìm + ghép mã hàng theo model', () => {
  const SEED = [
    { code: 'LT-040-0.75kw', name: 'Máy thổi khí Longtech LT-040, P=0.75kw', unit: 'Bộ' },
    { code: 'LT-040-1.5kw', name: 'Máy thổi khí Longtech LT-040, P=1.5kw', unit: 'Bộ' },
    { code: 'THANLT-040', name: 'Thân máy thổi khí Longtech LT-040', unit: 'Bộ' },
    { code: 'HD-270', name: 'Đĩa phân phối khí Jaeger HD-270, màng EPDM', unit: 'Cái' },
    { code: 'HD-270bgkhau', name: 'Đĩa phân phối khí Jaeger HD-270 kèm khớp nối', unit: 'Cái' },
    { code: 'HD270KHAU', name: 'Đĩa phân phối khí Jaeger HD270 loại có màng', unit: 'Bộ' },
    { code: '1M421P1155SVBSMV0M3-003', name: 'Bơm hoá chất', unit: 'Cái' },
  ];

  beforeAll(async () => {
    for (const p of SEED) {
      await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(p);
    }
  });

  const search = async (q: string) => {
    const res = await request(app)
      .get('/api/products')
      .query({ search: q, pageSize: 50 })
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    return (res.body.data as Array<{ code: string }>).map((p) => p.code.toUpperCase());
  };

  it('tìm được LT-040 khi gõ "LT 040" / "lt-040" / "LT - 040"', async () => {
    for (const q of ['LT 040', 'lt-040', 'LT - 040']) {
      const codes = await search(q);
      expect(codes, q).toContain('LT-040-0.75KW');
      expect(codes, q).toContain('LT-040-1.5KW');
    }
  });

  it('tìm được HD-270 khi gõ "HD270"', async () => {
    const codes = await search('HD270');
    expect(codes).toContain('HD-270');
    expect(codes).toContain('HD270KHAU');
  });

  it('tìm theo tên hàng không dấu, khác hoa thường', async () => {
    for (const q of ['may thoi khi', 'MÁY THỔI KHÍ']) {
      const codes = await search(q);
      expect(codes, q).toContain('LT-040-0.75KW');
    }
  });

  it('model trùng khít mã hàng -> matched đúng mã, ưu tiên hơn tên hàng', () => {
    const line = {
      line_no: 1, name: 'THÂN MÁY THỔI KHÍ LONGTECH', unit: 'Bộ',
      qty: 1, unit_price: 1, amount: 1,
      model: 'LT - 040', brand: '', origin: '', spec_text: '', confidence: 'high' as const,
    };
    // "LT - 040" không trùng khít mã nào -> phải ra candidate nhóm LT-040-*,
    // chứ không được nhảy sang THANLT-040 chỉ vì tên hàng giống.
    const r = matchProduct(line, null, null);
    expect(r.status).toBe('candidate');
    const codes = (r.candidates ?? []).map((c) => c.code);
    expect(codes).toContain('LT-040-0.75KW');
    expect(codes).toContain('LT-040-1.5KW');
    expect(codes).not.toContain('THANLT-040');
  });

  it('model "HD-270" trùng khít -> matched chính xác', () => {
    const line = {
      line_no: 1, name: 'ĐĨA PHÂN PHỐI KHÍ TINH', unit: 'Cái',
      qty: 1, unit_price: 1, amount: 1,
      model: 'HD-270', brand: '', origin: '', spec_text: '', confidence: 'high' as const,
    };
    const r = matchProduct(line, null, null);
    expect(r.status).toBe('matched');
    expect(r.product?.code).toBe('HD-270');
    expect(r.method).toBe('model_exact');
  });

  it('model lạ hoàn toàn -> unmatched, cho phép tạo mới', () => {
    const line = {
      line_no: 1, name: 'MÔ TẢ KHÔNG CÓ TRONG DANH MỤC', unit: 'Cái',
      qty: 1, unit_price: 1, amount: 1,
      model: 'ZZZ-999-XYZ', brand: '', origin: '', spec_text: '', confidence: 'high' as const,
    };
    const r = matchProduct(line, null, null);
    expect(r.status).toBe('unmatched');
    expect(r.productId).toBeNull();
  });
});

describe('ghép tên công ty + ứng viên cho AI', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ taxCode: '0399999999', name: 'CÔNG TY TNHH THƯƠNG MẠI QUANG MINH' });
    for (let i = 1; i <= 8; i++) {
      await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: `ABC-00${i}`, name: `Thiết bị ABC số ${i}`, unit: 'Cái' });
    }
  });

  it('ghép tên công ty có tiền tố "CTY", không dấu', async () => {
    const { matchCustomer } = await import('../services/match.js');
    const r = matchCustomer('CTY QUANG MINH', '');
    expect(r.status).toBe('matched');
    expect(r.customer?.name).toContain('QUANG MINH');
  });

  it('chỉ có tên công ty (viết tắt) -> matched và điền được MST', async () => {
    const { matchCustomer } = await import('../services/match.js');
    const r = matchCustomer('CTY TM QUANG MINH', '');
    expect(r.status).toBe('matched');
    expect(r.customer?.taxCode).toBe('0399999999');
  });

  it('AI trả candidate không ghi đè khách đã ghép chắc chắn', async () => {
    const { buildDraft } = await import('../services/quotes.js');
    const parsed = {
      buyer_name: 'CTY TM QUANG MINH', buyer_tax_code: '', quote_no: 'Q-AI-1', quote_date: '',
      lines: [], declared_subtotal: null, declared_vat: null, declared_total: null,
      tax_rate: null, payment_terms: '', validity_days: null, warnings: [],
    };
    const ai = {
      customer: {
        customerMatch: {
          status: 'candidate',
          customerId: null,
          candidates: [{ id: 1, taxCode: '0000000000', name: 'Công ty khác', score: 0.6 }],
        },
      },
      lines: {},
      status: { ran: true, notes: [] },
    };
    const draft = buildDraft(parsed as never, 'x.pdf', 'hash-ai-1', ai as never);
    expect(draft.customerMatch.status).toBe('matched');
    expect(draft.customerMatch.customer?.taxCode).toBe('0399999999');
  });

  it('candidatesForAi trả nhiều hơn 5 ứng viên, gồm mã ngoài top-5 tất định', async () => {
    const { candidatesForAi } = await import('../services/match.js');
    const line = {
      line_no: 1, name: 'Thiết bị ABC', unit: 'Cái', qty: 1, unit_price: 1, amount: 1,
      model: 'ABC', brand: '', origin: '', spec_text: '', confidence: 'high' as const,
    };
    const det = matchProduct(line, null, null);
    expect((det.candidates ?? []).length).toBeLessThanOrEqual(5);
    const list = candidatesForAi(line, 20);
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.map((p) => p.code)).toContain('ABC-008');
  });
});

describe('bổ sung bằng AI (chuỗi dự phòng + trộn kết quả)', () => {
  const raw = getRawDb();
  const insertProvider = (
    kind: string,
    model: string,
    opts: { baseUrl?: string; apiKey?: string; enabled?: number } = {},
  ) => {
    const now = new Date().toISOString();
    raw
      .prepare(
        `INSERT INTO ai_providers (created_at, updated_at, name, kind, base_url, api_key, model, enabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(now, now, `test-${kind}`, kind, opts.baseUrl ?? '', opts.apiKey ?? 'k', model, opts.enabled ?? 1, 0);
  };

  afterEach(() => {
    raw.prepare('DELETE FROM ai_providers').run();
    raw.prepare("DELETE FROM app_settings WHERE key = 'ai_enabled'").run();
    delete process.env.AI_ATTEMPT_TIMEOUT_MS;
  });

  it('chưa cấu hình provider -> aiComplete trả null, không throw', async () => {
    const { aiComplete, aiEnabled, __aiInternals } = await import('../services/ai.js');
    __aiInternals.breakers.clear();
    expect(aiEnabled()).toBe(false);
    await expect(aiComplete('x', Date.now() + 2000)).resolves.toBeNull();
  });

  it('model lỗi -> chuyển model kế; model lỗi vào cầu dao, lần sau bỏ qua', async () => {
    insertProvider('openai', 'a,b', { baseUrl: 'https://llm.local/v1' });
    process.env.AI_ATTEMPT_TIMEOUT_MS = '800';
    const { aiComplete, __aiInternals } = await import('../services/ai.js');
    __aiInternals.breakers.clear();

    const called: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      called.push(model);
      if (model === 'a') return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ten":"X"}' } }] }), { status: 200 });
    });

    try {
      await expect(aiComplete('x', Date.now() + 5000)).resolves.toBe('{"ten":"X"}');
      expect(called).toEqual(['a', 'b']);

      called.length = 0;
      await aiComplete('x', Date.now() + 5000);
      expect(called).toEqual(['b']);
    } finally {
      vi.unstubAllGlobals();
      __aiInternals.breakers.clear();
    }
  });

  it('mọi provider lỗi -> null (báo giá vẫn dùng kết quả ghép tất định)', async () => {
    insertProvider('openai', 'm', { baseUrl: 'https://down.local/v1' });
    process.env.AI_ATTEMPT_TIMEOUT_MS = '500';
    const { aiComplete, __aiInternals } = await import('../services/ai.js');
    __aiInternals.breakers.clear();
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    try {
      await expect(aiComplete('x', Date.now() + 3000)).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
      __aiInternals.breakers.clear();
    }
  });

  it('AI chỉ chọn mã hàng trong danh sách ứng viên, id bịa bị bỏ qua', async () => {
    insertProvider('openai', 'm', { baseUrl: 'https://llm.local/v1' });
    process.env.AI_ATTEMPT_TIMEOUT_MS = '800';
    const { enrichWithAi } = await import('../services/ai-enrich.js');
    const { __aiInternals } = await import('../services/ai.js');
    __aiInternals.breakers.clear();

    // AI trả id=999999 (không có trong ứng viên) + tên đã tách gọn
    vi.stubGlobal('fetch', async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"name":"Đĩa phân phối khí","model":"HD-270","productId":999999}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const pq = {
      buyer_name: '', buyer_tax_code: '', quote_no: '', quote_date: '',
      lines: [{
        line_no: 1, name: 'ĐĨA PHÂN PHỐI KHÍ TINH\nMODEL: HD-270', unit: 'Cái',
        qty: 1, unit_price: 1000, amount: 1000,
        model: 'HD-270', brand: '', origin: '', spec_text: '', confidence: 'high' as const,
      }],
      declared_subtotal: null, declared_vat: null, declared_total: null,
      tax_rate: 0.08, payment_terms: '', validity_days: null, warnings: [],
    };
    const match = { status: 'matched' as const, productId: 1, product: { id: 1, code: 'HD-270', name: 'Đĩa', unit: 'Cái' }, method: 'model_exact' };

    try {
      const ai = await enrichWithAi(pq as never, [match as never]);
      expect(ai).toBeTruthy();
      expect(ai!.lines[0]?.name).toBe('Đĩa phân phối khí');
      expect(ai!.lines[0]?.productId).toBeUndefined();
      // Giao diện cần biết provider nào đã thực sự trả lời
      expect(ai!.status.providers).toContain('openai/m');
    } finally {
      vi.unstubAllGlobals();
      __aiInternals.breakers.clear();
    }
  });

  it('prompt AI khách hàng chứa ứng viên gần đúng từ toàn bộ danh sách', async () => {
    insertProvider('openai', 'm', { baseUrl: 'https://llm.local/v1' });
    process.env.AI_ATTEMPT_TIMEOUT_MS = '800';
    const { enrichWithAi } = await import('../services/ai-enrich.js');
    const { __aiInternals } = await import('../services/ai.js');
    __aiInternals.breakers.clear();

    let prompt = '';
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      prompt = String((JSON.parse(String(init.body)) as { messages: Array<{ content: string }> }).messages[0]!.content);
      return new Response(
        JSON.stringify({
          choices: [{
            message: { content: '{"name":"CÔNG TY TNHH THƯƠNG MẠI QUANG MINH","taxCode":""}' },
          }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const pq = {
      buyer_name: 'CTY QUANG MINH', buyer_tax_code: '', quote_no: '', quote_date: '',
      lines: [], declared_subtotal: null, declared_vat: null, declared_total: null,
      tax_rate: null, payment_terms: '', validity_days: null, warnings: [],
    };

    try {
      const ai = await enrichWithAi(pq as never, []);
      expect(prompt).toContain('QUANG MINH');
      expect(ai?.customer?.customerMatch.status).toBe('matched');
    } finally {
      vi.unstubAllGlobals();
      __aiInternals.breakers.clear();
    }
  });

  it('tắt AI toàn cục -> enrich trả undefined dù có provider', async () => {
    insertProvider('openai', 'm', { baseUrl: 'https://llm.local/v1' });
    setSetting('ai_enabled', 'false');
    const { enrichWithAi } = await import('../services/ai-enrich.js');
    const pq = { buyer_name: '', buyer_tax_code: '', quote_no: '', quote_date: '', lines: [], declared_subtotal: null, declared_vat: null, declared_total: null, tax_rate: null, payment_terms: '', validity_days: null, warnings: [] };
    await expect(enrichWithAi(pq as never, [])).resolves.toBeUndefined();
  });
});
