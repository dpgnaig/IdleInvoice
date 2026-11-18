import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

const base = {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
};

export const users = sqliteTable('users', {
  ...base,
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role', { enum: ['admin', 'accountant'] }).notNull().default('accountant'),
  status: text('status', { enum: ['pending', 'active', 'locked'] }).notNull().default('active'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: text('locked_until'),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  ...base,
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  revokedAt: text('revoked_at'),
  replacedBy: text('replaced_by'),
  userAgent: text('user_agent'),
  ip: text('ip'),
});

export const appSettings = sqliteTable('app_settings', {
  ...base,
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
});

export const customers = sqliteTable(
  'customers',
  {
    ...base,
    taxCode: text('tax_code').notNull().unique(),
    name: text('name').notNull(),
    address: text('address').notNull().default(''),
    email: text('email').notNull().default(''),
    buyerName: text('buyer_name').notNull().default(''),
    idCard: text('id_card').notNull().default(''),
    bankAccount: text('bank_account').notNull().default(''),
    budgetUnitCode: text('budget_unit_code').notNull().default(''),
    source: text('source', { enum: ['IMPORT', 'MANUAL', 'TAX_LOOKUP'] })
      .notNull()
      .default('MANUAL'),
  }
);

export const products = sqliteTable(
  'products',
  {
    ...base,
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    unit: text('unit').notNull().default(''),
  }
);

export const productAliases = sqliteTable('product_aliases', {
  ...base,
  aliasText: text('alias_text').notNull().unique(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
});

export const customerAliases = sqliteTable('customer_aliases', {
  ...base,
  aliasText: text('alias_text').notNull().unique(),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
});

export const quoteFiles = sqliteTable('quote_files', {
  ...base,
  originalName: text('original_name').notNull(),
  storedPath: text('stored_path').notNull(),
  fileHash: text('file_hash').notNull().unique(),
  uploadedBy: integer('uploaded_by').references(() => users.id),
  parseStatus: text('parse_status', { enum: ['parsed', 'needs_review', 'failed'] }).notNull(),
  parsedJson: text('parsed_json'),
  errorMessage: text('error_message'),
});

export const quotes = sqliteTable(
  'quotes',
  {
    ...base,
    quoteNo: text('quote_no').notNull().unique(),
    quoteDate: text('quote_date'),
    customerId: integer('customer_id').references(() => customers.id),
    quoteFileId: integer('quote_file_id').references(() => quoteFiles.id),
    declaredSubtotal: integer('declared_subtotal'),
    declaredVat: integer('declared_vat'),
    declaredTotal: integer('declared_total'),
    validityDays: integer('validity_days'),
    note: text('note').notNull().default(''),
  }
);

export const invoices = sqliteTable('invoices', {
  ...base,
  quoteId: integer('quote_id').references(() => quotes.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  paymentMethod: text('payment_method').notNull().default('Chuyển khoản'),
  status: text('status', { enum: ['draft', 'exported'] }).notNull().default('draft'),
  createdBy: integer('created_by').references(() => users.id),
  exportedAt: text('exported_at'),
});

export const invoiceLines = sqliteTable('invoice_lines', {
  ...base,
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  qty: real('qty').notNull(),
  unitPrice: integer('unit_price').notNull(),
  taxRate: real('tax_rate').notNull().default(0.08),
  taxRateCode: text('tax_rate_code'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const salesHistory = sqliteTable(
  'sales_history',
  {
    ...base,
    invoiceNo: text('invoice_no').notNull().default(''),
    invoiceDate: text('invoice_date'),
    customerTaxCode: text('customer_tax_code').notNull().default(''),
    productCode: text('product_code').notNull().default(''),
    productName: text('product_name').notNull().default(''),
    unit: text('unit').notNull().default(''),
    qty: real('qty').notNull().default(0),
    unitPrice: integer('unit_price').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0.08),
  }
);

export const auditLogs = sqliteTable('audit_logs', {
  ...base,
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull().default(''),
  detailJson: text('detail_json').notNull().default('{}'),
});

export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
