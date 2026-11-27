import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface ExportInvoiceLine {
  productCode: string;
  productName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  taxRate: number | string;
}

export interface ExportInvoice {
  customer: {
    taxCode: string;
    buyerName: string;
    name: string;
    address: string;
    email: string;
    bankAccount: string;
    budgetUnitCode: string;
  };
  bankName?: string;
  paymentMethod: string;
  lines: ExportInvoiceLine[];
}

const HEADER = [
  'Masothue', 'Tennguoimua', 'Tencongty', 'Diachi', 'Email', 'Sotaikhoan',
  'MaDL', 'Nganhang', 'HinhthucTT', 'MaSP', 'TenSP', 'Tinhchathanghoa',
  'Donvitinh', 'Soluong', 'Dongia', 'ThueGTGT', 'CCCD', 'MaQHNS',
];

/** ThueGTGT xuất dạng chữ ("8%", "KCT", "KKKNT"), không phải số. */
function taxText(v: number | string): string {
  if (v === 'KCT' || v === 'KKKNT') return v;
  const n = Number(v);
  const pct = n >= 1 ? n : n * 100; // phòng khi lưu 8 thay vì 0.08
  return `${Math.round(pct * 100) / 100}%`;
}

/** Ghi sheet "mẫu hđ" đúng mẫu import: dòng 1 là header; mỗi dòng hàng lặp lại
 *  đầy đủ thông tin khách; giữa các hóa đơn chèn 1 dòng trắng. */
export async function exportInvoicesXlsx(invs: ExportInvoice[], res: Response): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IdleInvoice';
  const ws = wb.addWorksheet('mẫu hđ');
  ws.addRow(HEADER);

  invs.forEach((inv, invIdx) => {
    inv.lines.forEach((l) => {
      const row = ws.addRow([
        inv.customer.taxCode,
        inv.customer.buyerName,
        inv.customer.name,
        inv.customer.address,
        inv.customer.email,
        inv.customer.bankAccount,
        '',
        inv.bankName ?? '',
        inv.paymentMethod,
        l.productCode,
        l.productName,
        '1',
        l.unit,
        l.qty,
        l.unitPrice,
        '', // ThueGTGT set riêng ở dưới
        '',
        inv.customer.budgetUnitCode,
      ]);
      // Cột text giữ dạng text (MST, mã SP, tính chất...)
      row.getCell(1).numFmt = '@';
      row.getCell(10).numFmt = '@';
      row.getCell(12).numFmt = '@';
      row.getCell(6).numFmt = '@';
      // Số lượng / đơn giá định dạng #,##0
      row.getCell(14).numFmt = '#,##0';
      row.getCell(15).numFmt = '#,##0';
      // Thuế: ghi dạng chữ "8%" (ô text)
      const c16 = row.getCell(16);
      c16.value = taxText(l.taxRate);
      c16.numFmt = '@';
    });
    if (invIdx < invs.length - 1) ws.addRow(new Array(HEADER.length).fill(null)); // 1 dòng trắng
  });

  ws.columns.forEach((c) => {
    c.width = Math.max(12, Math.min(45, (c.width ?? 12) + 4));
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mau_hd_export.xlsx"');
  await wb.xlsx.write(res as unknown as Parameters<typeof wb.xlsx.write>[0]);
  res.end();
}
