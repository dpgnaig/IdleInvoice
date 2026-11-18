import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { refreshTokens, users } from '../db/schema.js';
import { getEnv } from '../env.js';
import { unauthorized } from '../lib/errors.js';
import { signAccessToken, type AuthUser } from '../middleware/auth.js';

const REFRESH_TTL_DAYS = 7;

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function refreshExpiry(): string {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000).toISOString();
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

function toAuthUser(u: typeof users.$inferSelect): AuthUser {
  return { id: u.id, email: u.email, role: u.role, fullName: u.fullName };
}

export function issueTokens(
  user: AuthUser,
  meta: { userAgent?: string; ip?: string },
  familyRoot?: string,
): IssuedTokens {
  const db = getDb();
  const now = new Date().toISOString();
  const raw = crypto.randomBytes(48).toString('base64url');
  // Refresh token là JWT ký bằng secret riêng, chứa jti ngẫu nhiên; DB chỉ lưu hash.
  const tokenHash = sha256(raw);
  const refreshToken = jwt.sign(
    { sub: user.id, jti: raw, fam: familyRoot ?? sha256(raw) },
    getEnv().JWT_REFRESH_SECRET,
    { expiresIn: `${REFRESH_TTL_DAYS}d` },
  );
  db.insert(refreshTokens)
    .values({
      userId: user.id,
      tokenHash,
      expiresAt: refreshExpiry(),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return { accessToken: signAccessToken(user), refreshToken, user };
}

export function revokeAllForUser(userId: number): void {
  const now = new Date().toISOString();
  getDb()
    .update(refreshTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .run();
}

/** Xoay vòng refresh token. Dùng lại token cũ -> revoke toàn bộ phiên của user. */
export function rotateRefreshToken(
  presented: string,
  meta: { userAgent?: string; ip?: string },
): IssuedTokens {
  let payload: { sub: number; jti: string; fam: string };
  try {
    payload = jwt.verify(presented, getEnv().JWT_REFRESH_SECRET) as unknown as typeof payload;
  } catch {
    throw unauthorized('Refresh token không hợp lệ hoặc đã hết hạn');
  }
  const db = getDb();
  const tokenHash = sha256(payload.jti);
  const row = db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).get();
  if (!row) throw unauthorized('Refresh token không hợp lệ');

  if (row.revokedAt) {
    // Token đã bị thu hồi nhưng vẫn được dùng lại => nghi bị đánh cắp.
    revokeAllForUser(row.userId);
    throw unauthorized('Phiên đăng nhập không còn hợp lệ, vui lòng đăng nhập lại');
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    throw unauthorized('Phiên đăng nhập đã hết hạn');
  }

  const userRow = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!userRow || userRow.status !== 'active') {
    revokeAllForUser(row.userId);
    throw unauthorized('Tài khoản không khả dụng');
  }

  const now = new Date().toISOString();
  const issued = issueTokens(toAuthUser(userRow), meta, payload.fam);
  const newHash = sha256(
    (jwt.verify(issued.refreshToken, getEnv().JWT_REFRESH_SECRET) as unknown as { jti: string }).jti,
  );
  db.update(refreshTokens)
    .set({ revokedAt: now, replacedBy: newHash, updatedAt: now })
    .where(eq(refreshTokens.id, row.id))
    .run();
  return issued;
}

export function revokeRefreshToken(presented: string): void {
  try {
    const payload = jwt.verify(presented, getEnv().JWT_REFRESH_SECRET) as unknown as { jti: string };
    const now = new Date().toISOString();
    getDb()
      .update(refreshTokens)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(refreshTokens.tokenHash, sha256(payload.jti)), isNull(refreshTokens.revokedAt)))
      .run();
  } catch {
    /* token hỏng thì bỏ qua */
  }
}

/** Dọn refresh token hết hạn (gọi định kỳ khi khởi động). */
export function purgeExpiredTokens(): void {
  const now = new Date().toISOString();
  getDb()
    .delete(refreshTokens)
    .where(or(lt(refreshTokens.expiresAt, now), lt(refreshTokens.revokedAt, now)))
    .run();
}

export const __test = { REFRESH_TTL_DAYS };
