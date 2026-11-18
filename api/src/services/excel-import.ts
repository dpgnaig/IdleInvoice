import ExcelJS from 'exceljs';
import { normalizeTaxCode, parseMoney, parseQty, parseTaxRate } from '../lib/normalize.js';

export interface SheetRow {
  rowNumber: number;
  cells: string[];
}

export interface SheetData {
  name: string;
  rows: SheetRow[];
}

/** Đọc toàn bộ sheet của .xlsx (đã tính sẵn công thức) thành mảng chuỗi. */
export async function readWorkbook(buffer: Buffer): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: SheetRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cellText(cell));
      });
      if (cells.some((c) => c.trim() !== '')) rows.push({ rowNumber, cells });
    });
    return { name: ws.name, rows };
  });
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    if ('text' in v && typeof (v as { text: unknown }).text === 'string') {
      const t = (v as { text: string }).text;
      // Hyperlink object: richText fallback
      return t.trim();
    }
    if ('richText' in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((p) => p.text).join('').trim();
    }
    if ('result' in v) {
      const r = (v as ExcelJS.CellFormulaValue).result;
      if (r === null || r === undefined) return '';
      return String(r).trim();
    }
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

/** Chuẩn hóa tiêu đề cột để tìm theo tên (bỏ dấu, hoa/thường, ký tự thừa). */
export function headerKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Tìm dòng tiêu đề theo tập từ khóa: trả về số dòng + map cột. */
export function findHeader(
  rows: SheetRow[],
  requiredGroups: string[][],
  maxScan = 15,
): { rowIndex: number; columns: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const row = rows[i]!;
    const keys = row.cells.map(headerKey);
    const columns: Record<string, number> = {};
    let matched = 0;
    for (const group of requiredGroups) {
      const idx = keys.findIndex((k) => k !== '' && group.some((g) => k.includes(g)));
      if (idx >= 0) {
        columns[group[0]!] = idx;
        matched++;
      }
    }
    if (matched >= Math.ceil(requiredGroups.length * 0.6)) {
      return { rowIndex: i, columns };
    }
  }
  return null;
}

export interface CustomerRow {
  rowNumber: number;
  taxCode: string;
  name: string;
  buyerName: string;
  idCard: string;
  address: string;
  email: string;
  bankAccount: string;
  budgetUnitCode: string;
}

export interface CustomerIssue {
  rowNumber: number;
  reason: string;
  taxCode?: string;
  name?: string;
}

const CUSTOMER_HEADERS: string[][] = [
  ['masothue', 'mst', 'taxtcode', 'taxcode'],
  ['donvimuahang', 'tencongty', 'tenkhachhang', 'donvi'],
  ['tennguoimuahang', 'nguoimuahang'],
  ['cccdan', 'cccd', 'cmnd', 'socccd'],
  ['diachi', 'address'],
  ['email'],
  ['sotaikhoan', 'stk', 'taikhoan'],
  ['madvquanhengansach', 'madvquanhe', 'maqhns', 'quanhengansach'],
];

/** Phân tích sheet DSKH. Trả về tất cả dòng hợp lệ + dòng lỗi + số trùng trong file. */
export function parseCustomerSheet(sheet: SheetData): {
  rows: CustomerRow[];
  issues: CustomerIssue[];
  duplicateCount: number;
} {
  const header = findHeader(sheet.rows, CUSTOMER_HEADERS);
  const rows: CustomerRow[] = [];
  const issues: CustomerIssue[] = [];
  if (!header) {
    return { rows, issues: [{ rowNumber: 0, reason: 'Không tìm thấy dòng tiêu đề DSKH (cần cột "Mã số thuế")' }], duplicateCount: 0 };
  }
  const col = (key: string, fallback: number) => header.columns[key] ?? fallback;
  const cTax = col('masothue', 0);
  const cName = col('donvimuahang', 1);
  const cBuyer = col('tennguoimuahang', 2);
  const cIdCard = col('cccdan', 3);
  const cAddr = col('diachi', 4);
  const cEmail = col('email', 5);
  const cBank = col('sotaikhoan', 6);
  const cBudget = col('madvquanhengansach', 7);

  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const row of sheet.rows.slice(header.rowIndex + 1)) {
    const get = (i: number) => (row.cells[i] ?? '').trim();
    const taxCode = normalizeTaxCode(get(cTax));
    const name = get(cName);
    const hasData = row.cells.some((c) => c.trim() !== '');
    if (!hasData) continue;
    if (!taxCode && !name) continue;
    if (!taxCode) {
      issues.push({ rowNumber: row.rowNumber, reason: 'Thiếu Mã số thuế', name });
      continue;
    }
    if (!name) {
      issues.push({ rowNumber: row.rowNumber, reason: 'Thiếu tên đơn vị mua hàng', taxCode });
      continue;
    }
    if (/^\d{9}$/.test(taxCode)) {
      issues.push({
        rowNumber: row.rowNumber,
        reason: 'MST chỉ có 9 chữ số (có thể đã mất số 0 đầu do Excel lưu dạng số) — cần sửa định dạng cột thành Text',
        taxCode,
        name,
      });
      continue;
    }
    if (seen.has(taxCode)) {
      duplicateCount++;
      issues.push({ rowNumber: row.rowNumber, reason: 'Mã số thuế trùng trong file', taxCode, name });
      continue;
    }
    seen.add(taxCode);
    rows.push({
      rowNumber: row.rowNumber,
      taxCode,
      name,
      buyerName: get(cBuyer),
      idCard: get(cIdCard),
      address: get(cAddr),
      email: get(cEmail),
      bankAccount: get(cBank),
      budgetUnitCode: get(cBudget),
    });
  }
  return { rows, issues, duplicateCount };
}

export interface ProductRow {
  rowNumber: number;
  code: string;
  name: string;
  unit: string;
}

const PRODUCT_HEADERS: string[][] = [
  ['mahanghoa', 'mahang', 'masp', 'code'],
  ['tenhanghoa', 'tenhang', 'tensp', 'ten'],
  ['donvitinh', 'dvt', 'donvi', 'unit'],
];

export function parseProductSheet(sheet: SheetData): {
  rows: ProductRow[];
  issues: CustomerIssue[];
  duplicateCount: number;
} {
  const header = findHeader(sheet.rows, PRODUCT_HEADERS);
  const rows: ProductRow[] = [];
  const issues: CustomerIssue[] = [];
  if (!header) {
    return { rows, issues: [{ rowNumber: 0, reason: 'Không tìm thấy dòng tiêu đề DSSP (cần cột "Mã hàng hóa")' }], duplicateCount: 0 };
  }
  const cCode = header.columns['mahanghoa'] ?? 0;
  const cName = header.columns['tenhanghoa'] ?? 1;
  const cUnit = header.columns['donvitinh'] ?? 2;
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const row of sheet.rows.slice(header.rowIndex + 1)) {
    const get = (i: number) => (row.cells[i] ?? '').trim();
    const code = get(cCode);
    const name = get(cName);
    const unit = get(cUnit);
    if (!code && !name) continue;
    if (!code) {
      issues.push({ rowNumber: row.rowNumber, reason: 'Thiếu mã hàng hóa', name });
      continue;
    }
    if (!name) {
      issues.push({ rowNumber: row.rowNumber, reason: 'Thiếu tên hàng hóa', taxCode: code });
      continue;
    }
    if (!unit) {
      issues.push({ rowNumber: row.rowNumber, reason: 'Thiếu đơn vị tính', taxCode: code, name });
      continue;
    }
    if (seen.has(code.toUpperCase())) {
      duplicateCount++;
      issues.push({ rowNumber: row.rowNumber, reason: 'Mã hàng trùng trong file', taxCode: code, name });
      continue;
    }
    seen.add(code.toUpperCase());
    rows.push({ rowNumber: row.rowNumber, code, name, unit });
  }
  return { rows, issues, duplicateCount };
}

export interface HistoryRow {
  invoiceNo: string;
  invoiceDate: string | null;
  customerTaxCode: string;
  productCode: string;
  productName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  taxRate: number;
}

const HISTORY_HEADERS: string[][] = [
  ['sohd', 'soc t', 'sochungtu', 'soct'],
  ['ngayhoadon', 'ngayhd'],
  ['makhach', 'masothue'],
  ['mahanghoa', 'mahang'],
  ['tenhhoa', 'tenhanghoa', 'tenvt'],
  ['dvt'],
  ['soluong', 'soLuongQ'],
  ['dongia', 'gia2'],
  ['thuesuat', 'thuesuati'],
];

/** Phân tích file lịch sử hóa đơn ExportFast (cột động theo tiêu đề). */
export function parseHistoryWorkbook(sheets: SheetData[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows, HISTORY_HEADERS, 5);
    if (!header) continue;
    const c = header.columns;
    const pick = (keys: string[], fallback: number) => {
      for (const k of keys) if (c[k] !== undefined) return c[k]!;
      return fallback;
    };
    const cInvoice = pick(['sohd'], 1);
    const cDate = pick(['ngayhoadon'], 2);
    const cCust = pick(['makhach'], 3);
    const cCode = pick(['mahanghoa'], 5);
    const cName = pick(['tenhhoa'], 6);
    const cUnit = pick(['dvt'], 7);
    const cQty = pick(['soluong'], 8);
    const cPrice = pick(['dongia'], 12);
    const cTax = pick(['thuesuat'], 10);
    for (const row of sheet.rows.slice(header.rowIndex + 1)) {
      const get = (i: number) => (row.cells[i] ?? '').trim();
      const productCode = get(cCode);
      if (!productCode) continue;
      const qty = parseQty(get(cQty)) ?? 0;
      const price = parseMoney(get(cPrice)) ?? 0;
      const tax = parseTaxRate(get(cTax));
      out.push({
        invoiceNo: get(cInvoice),
        invoiceDate: toIsoDate(get(cDate)),
        customerTaxCode: normalizeTaxCode(get(cCust)),
        productCode,
        productName: get(cName),
        unit: get(cUnit),
        qty,
        unitPrice: price,
        taxRate: typeof tax === 'number' ? tax : 0,
      });
    }
  }
  return out;
}

export { findHeader as findSheetHeader };

/** dd/MM/yyyy hoặc ISO -> yyyy-MM-dd (null nếu không đọc được). */
export function toIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
