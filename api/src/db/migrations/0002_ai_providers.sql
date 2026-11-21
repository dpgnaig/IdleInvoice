-- Migration 0002: nhà cung cấp AI cấu hình qua giao diện
-- kind: gemini | openrouter | openai (OpenAI Compatible) | anthropic
-- model: có thể là danh sách phân tách bằng dấu phẩy (chuỗi dự phòng)
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_order ON ai_providers(sort_order, id);
