import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setupTestEnv } from './helpers.js';

const env = setupTestEnv();

const { createApp } = await import('../index.js');
const { closeDb } = await import('../db/index.js');

const app = createApp();
const SAMPLE = path.resolve(import.meta.dirname, '..', '..', '..', 'sample');
const hasSample = (name: string) => {
  try {
    readFileSync(path.join(SAMPLE, name));
    return true;
  } catch {
    return false;
  }
};

let accessToken = '';

beforeAll(() => {
  env.dir; // giữ tham chiếu để tránh bị dọn sớm
});

afterAll(() => {
  closeDb();
  env.cleanup();
});

describe('setup wizard (DB trống)', () => {
  it('status báo chưa thiết lập và bước 1', async () => {
    const res = await request(app).get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body.setupCompleted).toBe(false);
    expect(res.body.hasAdmin).toBe(false);
    expect(res.body.step).toBe(1);
  });

  it('nghiệp vụ bị chặn trước khi setup (428)', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(428);
  });

  it('tạo admin (bước 1) rồi status sang bước 2', async () => {
    const res = await request(app).post('/api/setup/admin').send({
      fullName: 'Chủ hệ thống',
      email: 'owner@test.vn',
      password: 'Owner12345',
    });
    expect(res.status).toBe(201);
    const status = await request(app).get('/api/setup/status');
    expect(status.body.hasAdmin).toBe(true);
    expect(status.body.step).toBe(2);
  });

  it('đăng nhập được bằng admin vừa tạo', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.vn', password: 'Owner12345' });
    expect(res.status).toBe(200);
    accessToken = res.body.accessToken;
  });

  it('preview + commit import DSKH/DSSP từ file mẫu', async () => {
    if (!hasSample('HĐ-_mẫu.xlsx')) {
      console.warn('Bỏ qua: không có file mẫu HĐ-_mẫu.xlsx');
      return;
    }
    const file = readFileSync(path.join(SAMPLE, 'HĐ-_mẫu.xlsx'));
    const preview = await request(app)
      .post('/api/setup/import/preview')
      .attach('file', file, 'mau.xlsx');
    expect(preview.status).toBe(200);
    expect(preview.body.customers.total).toBeGreaterThan(1000);
    expect(preview.body.products.total).toBeGreaterThan(500);
    expect(preview.body.customers.sample.length).toBeLessThanOrEqual(10);
    expect(preview.body.customers.issueCount).toBeGreaterThan(0);

    const commit = await request(app)
      .post('/api/setup/import/commit')
      .send({ uploadId: preview.body.uploadId });
    expect(commit.status).toBe(200);
    expect(commit.body.customersAdded).toBeGreaterThan(1000);
    expect(commit.body.productsAdded).toBeGreaterThan(500);

    const status = await request(app).get('/api/setup/status');
    expect(status.body.step).toBe(3);
    expect(status.body.counts.customers).toBe(commit.body.customersAdded);
  });

  it('import lại cùng file: không thêm trùng (idempotent)', async () => {
    if (!hasSample('HĐ-_mẫu.xlsx')) return;
    const file = readFileSync(path.join(SAMPLE, 'HĐ-_mẫu.xlsx'));
    const preview = await request(app)
      .post('/api/setup/import/preview')
      .attach('file', file, 'mau.xlsx');
    const commit = await request(app)
      .post('/api/setup/import/commit')
      .send({ uploadId: preview.body.uploadId });
    expect(commit.status).toBe(200);
    expect(commit.body.customersAdded).toBe(0);
    expect(commit.body.productsAdded).toBe(0);
  });

  it('import lịch sử hóa đơn ExportFast (tùy chọn)', async () => {
    if (!hasSample('ExportFast.xlsx')) return;
    const file = readFileSync(path.join(SAMPLE, 'ExportFast.xlsx'));
    const preview = await request(app)
      .post('/api/setup/import/history/preview')
      .attach('file', file, 'exportfast.xlsx');
    expect(preview.status).toBe(200);
    expect(preview.body.total).toBeGreaterThan(1000);
    const commit = await request(app)
      .post('/api/setup/import/history/commit')
      .send({ uploadId: preview.body.uploadId });
    expect(commit.status).toBe(200);
    expect(commit.body.added).toBe(preview.body.total);
  });

  it('hoàn tất setup rồi mọi /api/setup/* bị khóa 403 vĩnh viễn', async () => {
    const done = await request(app).post('/api/setup/complete');
    expect(done.status).toBe(200);
    for (const [method, url] of [
      ['get', '/api/setup/status'],
      ['post', '/api/setup/admin'],
      ['post', '/api/setup/import/preview'],
      ['post', '/api/setup/import/commit'],
      ['post', '/api/setup/complete'],
    ] as const) {
      const res = await request(app)[method](url);
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });

  it('sau setup, nghiệp vụ hoạt động bình thường', async () => {
    const res = await request(app)
      .get('/api/customers?pageSize=1')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });
});
