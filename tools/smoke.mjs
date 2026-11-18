// Smoke test luồng chính trên server đang chạy (localhost).
// Chạy: node tools/smoke.mjs   (cần API + parser đang chạy, DB đã seed)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3010/api';
const ROOT = path.resolve(import.meta.dirname, '..');

async function json(res) {
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), headers: res.headers };
  } catch {
    return { status: res.status, body: text, headers: res.headers };
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('✗', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('✓', msg);
}

// 1) đăng nhập admin seed
const login = await json(
  await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Admin12345' }),
  }),
);
assert(login.status === 200, `đăng nhập admin (${login.status})`);
const token = login.body.accessToken;
const auth = { Authorization: `Bearer ${token}` };
const cookie = login.headers.getSetCookie?.()[0]?.split(';')[0] ?? '';
assert(Boolean(cookie), 'nhận refresh cookie');

// 2) upload 4 báo giá mẫu
const files = ['an_phát.xls', 'BG-6_26-Asia.xls', 'nguyên phát.pdf', '111126_QM-ARK_NA-BGM.pdf'];
const fd = new FormData();
for (const f of files) {
  const buf = readFileSync(path.join(ROOT, 'sample', f));
  fd.append('files', new Blob([buf]), f);
}
const parsed = await json(await fetch(`${BASE}/quotes/parse`, { method: 'POST', headers: auth, body: fd }));
assert(parsed.status === 200, `parse 4 file (${parsed.status})`);
const drafts = parsed.body.drafts;
assert(drafts.length === 4, `có 4 draft (${drafts.length})`);
for (const d of drafts) {
  console.log('   -', d.originalName, '| status:', d.status, '| khách:', d.customerMatch?.status,
    '| dòng:', d.lines?.length, '| MST:', d.parsed?.buyerTaxCode || '—');
}

// 3) xác nhận 2 báo giá đã ghép khách đủ
const ready = drafts.filter((d) => d.customerMatch?.status === 'matched' && d.lines?.length);
assert(ready.length >= 2, `ít nhất 2 báo giá ghép được khách trực tiếp (${ready.length})`);

const invoiceIds = [];
for (const d of ready.slice(0, 2)) {
  // chọn mã hàng: matched hoặc ứng viên đầu
  const lines = d.lines.map((l) => {
    const pid = l.productMatch.productId ?? l.productMatch.candidates?.[0]?.id ?? null;
    return pid
      ? {
          productId: pid,
          qty: l.qty ?? 1,
          unitPrice: l.unitPrice ?? 0,
          taxRate: typeof l.taxRate === 'number' ? l.taxRate : 0.08,
          rememberAlias: true,
        }
      : null;
  });
  if (lines.some((l) => l === null)) {
    console.log('   (bỏ qua', d.originalName, '- có dòng chưa ghép mã)');
    continue;
  }
  const conf = await json(
    await fetch(`${BASE}/quotes/confirm`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteNo: d.parsed.quoteNo || `BG-${Date.now()}`,
        quoteDate: d.parsed.quoteDate || null,
        customerId: d.customerMatch.customerId,
        fileHash: d.fileHash,
        declaredSubtotal: d.parsed.declaredSubtotal,
        declaredVat: d.parsed.declaredVat,
        declaredTotal: d.parsed.declaredTotal,
        validityDays: d.parsed.validityDays,
        lines,
        rememberCustomerAlias: true,
        aliasText: d.parsed.buyerName,
      }),
    }),
  );
  assert(conf.status === 201, `confirm ${d.parsed.quoteNo} (${conf.status}) ${JSON.stringify(conf.body).slice(0, 120)}`);
  invoiceIds.push(conf.body.invoice.id);
}

assert(invoiceIds.length >= 1, `đã tạo hóa đơn nháp (${invoiceIds.length})`);

// 4) xuất Excel
const exp = await fetch(`${BASE}/invoices/export`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: invoiceIds }),
});
assert(exp.status === 200, `export excel (${exp.status})`);
const outPath = path.join(ROOT, '.run', 'mau_hd_export.xlsx');
writeFileSync(outPath, Buffer.from(await exp.arrayBuffer()));
console.log('   →', outPath);

// 5) kiểm tra file kết quả
const ExcelJS = createRequire(path.join(ROOT, 'api', 'package.json'))('exceljs');
{
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(outPath));
  const ws = wb.getWorksheet('mẫu hđ');
  const header = ws.getRow(1).values.slice(1);
  assert(ws && header[0] === 'Masothue' && header[17] === 'MaQHNS', 'header đúng mẫu');
  const r2 = ws.getRow(2);
  console.log('   dòng 2:', {
    mst: r2.getCell(1).value, maSP: r2.getCell(10).value, ten: r2.getCell(11).value,
    sl: r2.getCell(14).value, dongia: r2.getCell(15).value, thue: r2.getCell(16).value, fmt: r2.getCell(16).numFmt,
  });
  assert(r2.getCell(16).numFmt === '0%' || r2.getCell(16).value === 'KCT', 'thuế định dạng 0%');
}

// 6) duplicate-check + suggest
const dup = await json(await fetch(`${BASE}/invoices/${invoiceIds[0]}/duplicate-check`, { headers: auth }));
assert(dup.status === 200, `duplicate-check (${dup.status})`);
const sug = await json(await fetch(`${BASE}/products/suggest?q=HD340`, { headers: auth }));
assert(sug.status === 200 && Array.isArray(sug.body), `suggest products (${sug.status})`);

// 7) danh sách hóa đơn
const list = await json(await fetch(`${BASE}/invoices`, { headers: auth }));
assert(list.status === 200 && list.body.pagination.total >= 1, `danh sách hóa đơn (${list.body.pagination?.total})`);

console.log('\nSMOKE OK');
