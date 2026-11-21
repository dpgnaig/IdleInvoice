import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { endpoints } from './endpoints';

/** Access token chỉ giữ trong bộ nhớ (không localStorage). */
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    accessToken = t;
  },
};

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 120_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function refresh(): Promise<string | null> {
  if (!refreshing) {
    refreshing = api
      .post<{ accessToken: string }>(endpoints.auth.refresh)
      .then((r) => {
        accessToken = r.data.accessToken;
        return r.data.accessToken;
      })
      .catch(() => {
        accessToken = null;
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    if (error.response?.status === 428 && window.location.pathname !== '/setup') {
      window.location.assign('/setup');
      return Promise.reject(error);
    }
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refresh();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

export async function attemptRefresh(): Promise<string | null> {
  return refresh();
}

export function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; details?: unknown } | undefined;
    if (data?.error) {
      if (Array.isArray(data.details) && data.details.length) {
        const first = data.details[0] as { message?: string };
        return first?.message ? `${data.error}: ${first.message}` : data.error;
      }
      return data.error;
    }
    if (err.code === 'ERR_NETWORK') return 'Không kết nối được máy chủ';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Đã có lỗi xảy ra';
}
