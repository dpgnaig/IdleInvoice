import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const nf = new Intl.NumberFormat('vi-VN');

export function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${nf.format(Math.round(v))} ₫`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return nf.format(v);
}

/** dd/MM/yyyy */
export function formatDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function formatTaxRate(v: number | string | null | undefined): string {
  if (v === 'KCT' || v === 'KKKNT') return v;
  if (typeof v === 'number') return `${Math.round(v * 100)}%`;
  return '—';
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
