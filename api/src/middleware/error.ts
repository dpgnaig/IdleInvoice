import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Không tìm thấy đường dẫn' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, details: err.details, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Dữ liệu không hợp lệ',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const e = err as { type?: string; code?: string; message?: string };
  if (e?.type === 'entity.too.large' || e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File quá lớn (tối đa 10 MB)' });
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau' });
}

/** Bọc async handler để lỗi được đưa vào errorHandler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
