import { api } from './api';

/**
 * Tải file .xlsx kèm access token (mọi route /api/* đều yêu cầu đăng nhập).
 * Dùng <a href> trực tiếp sẽ bị 401 vì trình duyệt không gửi header Authorization.
 */
export async function downloadXlsx(url: string, filename: string, body?: unknown): Promise<void> {
  const res = body
    ? await api.post(url, body, { responseType: 'blob' })
    : await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
