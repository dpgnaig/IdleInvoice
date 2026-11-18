import { Router } from 'express';
import ExcelJS from 'exceljs';
import { getDb } from '../db/index.js';
import { customers, products } from '../db/schema.js';
import { asyncHandler } from '../middleware/error.js';

export const exportRouter: Router = Router();

exportRouter.get(
  '/customers.xlsx',
  asyncHandler(async (_req, res) => {
    const rows = getDb().select().from(customers).all();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DSKH');
    ws.addRow(['Mã số thuế', 'Đơn vị mua hàng', 'Tên người mua hàng', 'CCCDan', 'Địa chỉ', 'Email', 'Số tài khoản', 'Mã DV quan hệ ngân sách']);
    for (const r of rows) {
      const row = ws.addRow([r.taxCode, r.name, r.buyerName, r.idCard, r.address, r.email, r.bankAccount, r.budgetUnitCode]);
      row.getCell(1).numFmt = '@'; // giữ TEXT cho MST
    }
    ws.columns.forEach((c) => {
      c.width = 30;
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="DSKH.xlsx"');
    await wb.xlsx.write(res as unknown as Parameters<typeof wb.xlsx.write>[0]);
    res.end();
  }),
);

exportRouter.get(
  '/products.xlsx',
  asyncHandler(async (_req, res) => {
    const rows = getDb().select().from(products).all();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('DSSP');
    ws.addRow(['Mã hàng hóa', 'Tên hàng hóa', 'Đơn vị tính']);
    for (const r of rows) {
      const row = ws.addRow([r.code, r.name, r.unit]);
      row.getCell(1).numFmt = '@';
    }
    ws.columns.forEach((c) => {
      c.width = 35;
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="DSSP.xlsx"');
    await wb.xlsx.write(res as unknown as Parameters<typeof wb.xlsx.write>[0]);
    res.end();
  }),
);
