import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getEnv } from '../env.js';
import { AppError, forbidden, unauthorized } from '../lib/errors.js';

export interface AuthUser {
  id: number;
  email: string;
  role: 'admin' | 'accountant';
  fullName: string;
}

export interface AccessPayload extends AuthUser {
  type: 'access';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(user: AuthUser): string {
  const payload: AccessPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    type: 'access',
  };
  return jwt.sign(payload, getEnv().JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, getEnv().JWT_ACCESS_SECRET) as AccessPayload;
    if (decoded.type !== 'access') return next(unauthorized('Token không hợp lệ'));
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      fullName: decoded.fullName,
    };
    next();
  } catch {
    next(unauthorized('Phiên đăng nhập đã hết hạn'));
  }
}

export function requireRole(role: 'admin' | 'accountant') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (role === 'admin' && req.user.role !== 'admin') return next(forbidden('Chỉ quản trị viên được thực hiện'));
    next();
  };
}

export { AppError };
