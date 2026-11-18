import { and, asc, count, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

export interface Paged {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paged(page: number, pageSize: number, total: number): Paged {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export { and, asc, count, desc, eq, like, or, sql };
export type { SQL, SQLiteColumn };
