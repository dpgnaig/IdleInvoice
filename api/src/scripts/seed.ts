/**
 * Seed dữ liệu demo cho môi trường dev.
 * Chạy: npm run seed   (từ thư mục api/, sau khi đã đặt biến môi trường)
 * An toàn: bỏ qua nếu DB đã có dữ liệu.
 */
import '../load-env.js';
import { getDb } from '../db/index.js';
import { customers, products, users, salesHistory } from '../db/schema.js';
import { hashPassword } from '../lib/password.js';
import { setSetting } from '../lib/settings.js';

const db = getDb();
const now = new Date().toISOString();

const existing = db.select().from(customers).all().length;
if (existing > 0) {
  console.log('DB đã có dữ liệu, bỏ qua seed.');
  process.exit(0);
}

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin12345';

const admin = db
  .insert(users)
  .values({
    email: adminEmail,
    fullName: 'Quản trị viên',
    passwordHash: await hashPassword(adminPassword),
    role: 'admin',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  .returning()
  .get();

db.insert(customers)
  .values([
    {
      taxCode: '0110717304',
      name: 'CÔNG TY CỔ PHẦN TM VÀ XNK NGUYÊN PHÁT',
      address: 'Số 12, Tổ 15 Phố Hưng Phúc, Phường Yên Sở, Hà Nội',
      email: 'tuoi.kd@quangminhvn.com',
      buyerName: 'Chị Tú',
      idCard: '',
      bankAccount: '',
      budgetUnitCode: '',
      source: 'IMPORT',
      createdAt: now,
      updatedAt: now,
    },
    {
      taxCode: '2400573873',
      name: 'CÔNG TY TNHH ARK VIỆT NAM',
      address: 'Khu công nghiệp, Bắc Ninh',
      email: 'anh.kd@quangminhvn.com',
      buyerName: 'Mr Trúc',
      idCard: '',
      bankAccount: '',
      budgetUnitCode: '',
      source: 'IMPORT',
      createdAt: now,
      updatedAt: now,
    },
    {
      taxCode: '0110277854',
      name: 'CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ MÔI TRƯỜNG AN PHÁT',
      address: 'Hà Nội',
      email: 'van.kd@quangminhvn.com',
      buyerName: 'Anh Trường',
      idCard: '',
      bankAccount: '',
      budgetUnitCode: '',
      source: 'IMPORT',
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

db.insert(products)
  .values([
    { code: 'HD340', name: 'Đĩa phân phối khí tinh Jaeger HD340', unit: 'Cái', createdAt: now, updatedAt: now },
    { code: 'HD340.F053A', name: 'Đĩa phân phối khí Jaeger HD340 (màng F053A)', unit: 'Cái', createdAt: now, updatedAt: now },
    { code: 'CBD105', name: 'Đĩa phân phối khí Jaeger CBD105', unit: 'Cái', createdAt: now, updatedAt: now },
    { code: 'HD270F053', name: 'Đĩa phân phối khí Jaeger HD270 (Trung Quốc)', unit: 'Cái', createdAt: now, updatedAt: now },
    { code: 'LT040', name: 'Máy thổi khí Longtech LT-040', unit: 'Bộ', createdAt: now, updatedAt: now },
    { code: '1M120P1115SVBSMV0M3-001', name: 'Bơm hóa chất OBL 1M120P1115SVBSMV0M3-001', unit: 'Cái', createdAt: now, updatedAt: now },
    { code: '1M50P1155SVBSMV0M3-001', name: 'Bơm hóa chất OBL 1M50P1155SVBSMV0M3-001', unit: 'Cái', createdAt: now, updatedAt: now },
    { code: '1M421P1155SVBSMV0M3-003', name: 'Bơm hóa chất OBL 1M421P1155SVBSMV0M3-003', unit: 'Cái', createdAt: now, updatedAt: now },
  ])
  .run();

db.insert(salesHistory)
  .values([
    {
      invoiceNo: '1',
      invoiceDate: '2026-01-05',
      customerTaxCode: '2400573873',
      productCode: 'HD340',
      productName: 'Đĩa phân phối khí Jaeger HD340',
      unit: 'Cái',
      qty: 20,
      unitPrice: 406700,
      taxRate: 0.08,
      createdAt: now,
      updatedAt: now,
    },
    {
      invoiceNo: '2',
      invoiceDate: '2026-01-06',
      customerTaxCode: '0110717304',
      productCode: 'HD340',
      productName: 'Đĩa phân phối khí Jaeger HD340',
      unit: 'Cái',
      qty: 34,
      unitPrice: 260000,
      taxRate: 0.08,
      createdAt: now,
      updatedAt: now,
    },
  ])
  .run();

setSetting('setup_completed', 'true');
console.log(`Seed xong. Admin: ${adminEmail} / ${adminPassword}`);
console.log(`Người dùng id=${admin.id}`);
