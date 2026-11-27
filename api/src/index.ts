import './load-env.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { getDb } from './db/index.js';
import { getEnv } from './env.js';
import { logger } from './lib/logger.js';
import { isSetupCompleted } from './lib/settings.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { requireAuth } from './middleware/auth.js';
import { setupRequired } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { setupRouter } from './routes/setup.js';
import { customersRouter } from './routes/customers.js';
import { productsRouter } from './routes/products.js';
import { exportRouter } from './routes/export-catalog.js';
import { quotesRouter } from './routes/quotes.js';
import { invoicesRouter } from './routes/invoices.js';
import { adminRouter, customersAdminExtras } from './routes/admin.js';
import { aiProvidersRouter } from './routes/ai-providers.js';
import { historyRouter } from './routes/history.js';
import { salesHistoryRouter } from './routes/sales-history.js';
import { purgeExpiredTokens } from './services/tokens.js';
import { startUploadCleanup } from './services/upload-cleanup.js';

export function createApp() {
  const env = getEnv();
  const app = express();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') {
    app.use(
      rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }),
    );
  }

  const uploadRoot = process.env.UPLOAD_DIR ?? './uploads';
  if (!existsSync(uploadRoot)) mkdirSync(uploadRoot, { recursive: true });

  // Khởi động DB + dọn token hết hạn
  getDb();
  try {
    purgeExpiredTokens();
  } catch (err) {
    logger.warn({ err }, 'Không dọn được refresh token hết hạn');
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'api' }));
  app.get('/health', (_req, res) => res.json({ ok: true, service: 'api' }));

  app.use('/api/auth', authRouter);
  app.use('/api/setup', setupRouter);

  // Chặn nghiệp vụ khi chưa hoàn tất setup
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/setup') || req.path === '/health') {
      return next();
    }
    if (!isSetupCompleted()) return next(setupRequired());
    next();
  });

  app.use('/api/customers', requireAuth, customersRouter);
  app.use('/api/products', requireAuth, productsRouter);
  app.use('/api/quotes', requireAuth, quotesRouter);
  app.use('/api/invoices', requireAuth, invoicesRouter);
  app.use('/api/history', requireAuth, historyRouter);
  app.use('/api/sales-history', requireAuth, salesHistoryRouter);
  app.use('/api/export', requireAuth, exportRouter);
  app.use('/api/admin/ai-providers', requireAuth, aiProvidersRouter);
  app.use('/api/admin', requireAuth, adminRouter);
  app.use('/api', requireAuth, customersAdminExtras);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  // Production: phục vụ React build tĩnh
  if (env.SERVE_WEB) {
    const webDist = path.resolve(process.cwd(), 'public');
    if (existsSync(webDist)) {
      app.use(express.static(webDist));
      app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    }
  }

  return app;
}

const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  const env = getEnv();
  const app = createApp();
  startUploadCleanup();
  app.listen(env.PORT, () => {
    logger.info(`API chạy tại http://localhost:${env.PORT}`);
  });
}
