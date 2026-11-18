export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, msg, details, 'BAD_REQUEST');
export const unauthorized = (msg = 'Chưa đăng nhập') =>
  new AppError(401, msg, undefined, 'UNAUTHORIZED');
export const forbidden = (msg = 'Không có quyền truy cập') =>
  new AppError(403, msg, undefined, 'FORBIDDEN');
export const notFound = (msg = 'Không tìm thấy dữ liệu') =>
  new AppError(404, msg, undefined, 'NOT_FOUND');
export const conflict = (msg: string, details?: unknown) =>
  new AppError(409, msg, details, 'CONFLICT');
export const setupRequired = () =>
  new AppError(428, 'Hệ thống chưa hoàn tất thiết lập ban đầu', undefined, 'SETUP_REQUIRED');
