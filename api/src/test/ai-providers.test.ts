import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { setupTestEnv } from './helpers.js';

const env = setupTestEnv();
const { createApp } = await import('../index.js');
const { getRawDb, closeDb } = await import('../db/index.js');
const { setSetting } = await import('../lib/settings.js');

const app = createApp();
const raw = getRawDb();
let adminToken = '';
let accountantToken = '';

const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);

beforeAll(async () => {
  setSetting('setup_completed', 'true');
  await request(app).post('/api/auth/register').send({
    fullName: 'Quản trị viên',
    email: 'ai-admin@test.vn',
    password: 'Admin1234',
  });
  raw.prepare("UPDATE users SET role='admin', status='active' WHERE email='ai-admin@test.vn'").run();
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'ai-admin@test.vn', password: 'Admin1234' });
  adminToken = login.body.accessToken;
  expect(adminToken).toBeTruthy();

  await request(app).post('/api/auth/register').send({
    fullName: 'Kế toán',
    email: 'ai-kt@test.vn',
    password: 'Ketoan123',
  });
  const acc = await request(app)
    .post('/api/auth/login')
    .send({ email: 'ai-kt@test.vn', password: 'Ketoan123' });
  accountantToken = acc.body.accessToken;
});

afterEach(() => {
  raw.prepare('DELETE FROM ai_providers').run();
  raw.prepare("DELETE FROM app_settings WHERE key = 'ai_enabled'").run();
  delete process.env.AI_ATTEMPT_TIMEOUT_MS;
  vi.unstubAllGlobals();
});

afterAll(() => {
  closeDb();
  env.cleanup();
});

describe('cấu hình AI Agent', () => {
  it('chỉ quản trị viên được cấu hình AI', async () => {
    const res = await request(app)
      .get('/api/admin/ai-providers')
      .set('Authorization', `Bearer ${accountantToken}`);
    expect(res.status).toBe(403);
  });

  it('tạo provider, danh sách chỉ trả key đã che', async () => {
    const created = await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'OpenRouter cá nhân',
      kind: 'openrouter',
      baseUrl: '',
      model: 'a:free, b:free',
      apiKey: 'sk-test-12345678',
      enabled: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.hasKey).toBe(true);
    expect(created.body.data.apiKeyMasked).toBe('••••5678');
    expect(JSON.stringify(created.body)).not.toContain('sk-test-12345678');

    const list = await asAdmin(request(app).get('/api/admin/ai-providers'));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].model).toBe('a:free, b:free');
    expect(list.body.data[0].apiKeyMasked).toBe('••••5678');
    expect(list.body.kinds.map((k: { value: string }) => k.value)).toEqual([
      'gemini',
      'openrouter',
      'openai',
      'anthropic',
    ]);
  });

  it('cập nhật: bỏ trống apiKey thì giữ key cũ', async () => {
    const created = await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'Gemini',
      kind: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-old-key-1111',
    });
    const id = created.body.data.id;

    const patched = await asAdmin(request(app).patch(`/api/admin/ai-providers/${id}`)).send({
      name: 'Gemini mới',
      apiKey: '',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe('Gemini mới');
    expect(patched.body.data.apiKeyMasked).toBe('••••1111');

    const changed = await asAdmin(request(app).patch(`/api/admin/ai-providers/${id}`)).send({
      apiKey: 'AIza-new-key-2222',
    });
    expect(changed.body.data.apiKeyMasked).toBe('••••2222');
  });

  it('kiểm tra kết nối gửi đúng định dạng OpenAI Compatible', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: unknown, init: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        headers: init.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await asAdmin(request(app).post('/api/admin/ai-providers/test')).send({
      name: 'Local',
      kind: 'openai',
      baseUrl: 'https://llm.local/v1/',
      model: 'm-1',
      apiKey: 'secret-key',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://llm.local/v1/chat/completions');
    expect(calls[0]!.body.model).toBe('m-1');
    expect(calls[0]!.headers.Authorization).toBe('Bearer secret-key');
  });

  it('kiểm tra kết nối dùng Messages API cho Anthropic', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: unknown, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await asAdmin(request(app).post('/api/admin/ai-providers/test')).send({
      name: 'Claude',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-haiku-5-5',
      apiKey: 'sk-ant-1',
    });
    expect(res.body.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.headers['x-api-key']).toBe('sk-ant-1');
    expect(calls[0]!.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('provider cấu hình trong DB được dùng làm chuỗi dự phòng', async () => {
    process.env.AI_ATTEMPT_TIMEOUT_MS = '2000';
    await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'DB provider',
      kind: 'openai',
      baseUrl: 'https://from-db.local/v1',
      model: 'db-model',
      apiKey: 'db-key',
    });

    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ten":"DB"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const { aiComplete, __aiInternals } = await import('../services/ai.js');
    __aiInternals.breakers.clear();
    await expect(aiComplete('x', Date.now() + 5000)).resolves.toBe('{"ten":"DB"}');
    expect(urls).toEqual(['https://from-db.local/v1/chat/completions']);
    __aiInternals.breakers.clear();
  });

  it('từ chối Base URL sai và bật/tắt AI toàn cục', async () => {
    const bad = await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'Sai',
      kind: 'openai',
      baseUrl: 'ftp://khong-hop-le',
      model: 'm',
    });
    expect(bad.status).toBe(400);

    const off = await asAdmin(request(app).patch('/api/admin/ai-providers/enabled')).send({
      enabled: false,
    });
    expect(off.body.enabled).toBe(false);
    const list = await asAdmin(request(app).get('/api/admin/ai-providers'));
    expect(list.body.enabled).toBe(false);
  });

  it('xóa provider', async () => {
    const created = await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'Tạm',
      kind: 'openai',
      model: 'm',
      apiKey: 'k',
    });
    const id = created.body.data.id;
    const del = await asAdmin(request(app).delete(`/api/admin/ai-providers/${id}`));
    expect(del.status).toBe(200);
    const list = await asAdmin(request(app).get('/api/admin/ai-providers'));
    expect(list.body.data).toHaveLength(0);
    const missing = await asAdmin(request(app).delete(`/api/admin/ai-providers/${id}`));
    expect(missing.status).toBe(404);
  });

  it('sao lưu ra JSON mã hóa rồi khôi phục lại', async () => {
    await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'Gemini',
      kind: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-secret-9999',
    });

    const backup = await asAdmin(request(app).post('/api/admin/ai-providers/backup')).send({
      passphrase: 'mat-khau-123',
    });
    expect(backup.status).toBe(200);
    expect(backup.body.filename).toMatch(/^ai-config-\d{8}\.json$/);
    expect(backup.body.content).not.toContain('AIza-secret-9999');
    const envelope = JSON.parse(backup.body.content);
    expect(envelope.format).toBe('idleinvoice.ai-config');
    expect(envelope.cipher).toBe('aes-256-gcm');
    expect(envelope.data).toBeTruthy();

    raw.prepare('DELETE FROM ai_providers').run();

    const restored = await asAdmin(request(app).post('/api/admin/ai-providers/restore')).send({
      passphrase: 'mat-khau-123',
      content: backup.body.content,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.providers).toBe(1);

    const list = await asAdmin(request(app).get('/api/admin/ai-providers'));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].name).toBe('Gemini');
    expect(list.body.data[0].apiKeyMasked).toBe('••••9999');
  });

  it('sai mật khẩu hoặc file hỏng bị từ chối', async () => {
    await asAdmin(request(app).post('/api/admin/ai-providers')).send({
      name: 'A',
      kind: 'openai',
      model: 'm',
      apiKey: 'k',
    });
    const backup = await asAdmin(request(app).post('/api/admin/ai-providers/backup')).send({
      passphrase: 'mat-khau-123',
    });

    const wrong = await asAdmin(request(app).post('/api/admin/ai-providers/restore')).send({
      passphrase: 'mat-khau-sai',
      content: backup.body.content,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toContain('Mật khẩu sai');

    const broken = await asAdmin(request(app).post('/api/admin/ai-providers/restore')).send({
      passphrase: 'mat-khau-123',
      content: '{"format":"x"}',
    });
    expect(broken.status).toBe(400);
  });

  it('không có cấu hình thì không tạo được bản sao lưu', async () => {
    const res = await asAdmin(request(app).post('/api/admin/ai-providers/backup')).send({
      passphrase: 'mat-khau-123',
    });
    expect(res.status).toBe(400);
  });

  it('đổi thứ tự ưu tiên bằng danh sách id', async () => {
    const a = await asAdmin(request(app).post('/api/admin/ai-providers')).send({ name: 'A', kind: 'openai', model: 'a', apiKey: 'k' });
    const b = await asAdmin(request(app).post('/api/admin/ai-providers')).send({ name: 'B', kind: 'openai', model: 'b', apiKey: 'k' });
    const c = await asAdmin(request(app).post('/api/admin/ai-providers')).send({ name: 'C', kind: 'openai', model: 'c', apiKey: 'k' });
    const ids = [c.body.data.id, b.body.data.id, a.body.data.id];

    const res = await asAdmin(request(app).patch('/api/admin/ai-providers/reorder')).send({ ids });
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { id: number }) => r.id)).toEqual(ids);

    const list = await asAdmin(request(app).get('/api/admin/ai-providers'));
    expect(list.body.data.map((r: { id: number }) => r.id)).toEqual(ids);

    const bad = await asAdmin(request(app).patch('/api/admin/ai-providers/reorder')).send({
      ids: [a.body.data.id],
    });
    expect(bad.status).toBe(400);
  });
});
