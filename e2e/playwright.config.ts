import { defineConfig, devices } from '@playwright/test';

/**
 * E2E chạy trên môi trường đã khởi động sẵn (parser + api + web).
 * BASE_URL mặc định là vite dev server.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    locale: 'vi-VN',
    viewport: { width: 1366, height: 820 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } } }],
});
