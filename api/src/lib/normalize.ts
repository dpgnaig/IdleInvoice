/** Bỏ dấu tiếng Việt, đ→d, chữ thường, gộp khoảng trắng. */
export function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeText(s: string): string {
  return stripDiacritics(String(s ?? ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hóa MST: bỏ khoảng trắng, dấu chấm, giữ dấu gạch ngang. */
export function normalizeTaxCode(s: string): string {
  return String(s ?? '')
    .replace(/[\s.]/g, '')
    .trim();
}

/** Chuẩn hóa mã hàng: bỏ khoảng trắng, hoa/thường như nhau. */
export function normalizeCode(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

const LEGAL_WORDS = [
  'cong ty',
  'tnhh',
  'mtv',
  'mot thanh vien',
  'co phan',
  'cp',
  'chi nhanh',
  'thuong mai',
  'dich vu',
  'va',
  'tnhh mtv',
  'doanh nghiep',
  'tap doan',
  'tong cong ty',
];

/** Tên rút gọn để so khớp gần đúng: bỏ dấu, bỏ từ pháp lý, bỏ dấu câu. */
export function simplifyCompanyName(name: string): string {
  let s = normalizeText(name).replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  for (const w of LEGAL_WORDS) {
    s = s.replace(new RegExp(`(^|\\s)${w}(\\s|$)`, 'g'), ' ');
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** Đọc số tiền kiểu 11,200,000 / 11.200.000 / 11 200 000 -> 11200000. */
export function parseMoney(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Math.round(raw);
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()₫đvndVND\s]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // dấu nào đứng sau là dấu thập phân
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // 11,200,000 (dấu phẩy phân nghìn) hoặc 1,5 (thập phân)
    const parts = s.split(',');
    s = parts.length > 2 || parts[parts.length - 1]!.length === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot > -1) {
    const parts = s.split('.');
    s = parts.length > 2 || parts[parts.length - 1]!.length === 3 ? s.replace(/\./g, '') : s;
  }
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return Math.round(negative ? -n : n);
}

/** Đọc số lượng: 1,5 / 1.5 / 101 */
export function parseQty(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** Đọc thuế suất: "8%", 0.08, "KCT", "KKKNT" */
export function parseTaxRate(raw: unknown): number | 'KCT' | 'KKKNT' | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw > 1 ? raw / 100 : raw;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (s.includes('KCT')) return 'KCT';
  if (s.includes('KKKNT')) return 'KKKNT';
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (m) return Number(m[1]!.replace(',', '.')) / 100;
  const n = Number(s.replace(',', '.'));
  if (!Number.isNaN(n)) return n > 1 ? n / 100 : n;
  return null;
}
