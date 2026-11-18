-- Migration 0001: toàn bộ bảng theo prompt (lưu tiền VND dạng INTEGER, thuế suất dạng REAL 0.08)
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'accountant',
  status TEXT NOT NULL DEFAULT 'active',
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  replaced_by TEXT,
  user_agent TEXT,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tax_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '',
  id_card TEXT NOT NULL DEFAULT '',
  bank_account TEXT NOT NULL DEFAULT '',
  budget_unit_code TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'MANUAL'
);
CREATE INDEX IF NOT EXISTS idx_customers_tax_code ON customers(tax_code);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);

CREATE TABLE IF NOT EXISTS product_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  alias_text TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  alias_text TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quote_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  uploaded_by INTEGER REFERENCES users(id),
  parse_status TEXT NOT NULL,
  parsed_json TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  quote_no TEXT NOT NULL UNIQUE,
  quote_date TEXT,
  customer_id INTEGER REFERENCES customers(id),
  quote_file_id INTEGER REFERENCES quote_files(id),
  declared_subtotal INTEGER,
  declared_vat INTEGER,
  declared_total INTEGER,
  validity_days INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_quotes_quote_no ON quotes(quote_no);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  quote_id INTEGER REFERENCES quotes(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  payment_method TEXT NOT NULL DEFAULT 'Chuyển khoản',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id),
  exported_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0.08,
  tax_rate_code TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  invoice_no TEXT NOT NULL DEFAULT '',
  invoice_date TEXT,
  customer_tax_code TEXT NOT NULL DEFAULT '',
  product_code TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0.08
);
CREATE INDEX IF NOT EXISTS idx_sales_history_cust_prod ON sales_history(customer_tax_code, product_code);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}'
);

PRAGMA foreign_keys = ON;
