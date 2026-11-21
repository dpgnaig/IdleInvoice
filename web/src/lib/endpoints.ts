/**
 * Toàn bộ đường dẫn API của backend nằm ở đây.
 * Đổi route phía server thì chỉ sửa file này, không phải lùng string trong từng trang.
 * `api` đã có baseURL '/api' nên các path ở đây không cần tiền tố đó.
 */
export const endpoints = {
  auth: {
    me: '/auth/me',
    login: '/auth/login',
    register: '/auth/register',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    changePassword: '/auth/change-password',
  },
  setup: {
    status: '/setup/status',
    admin: '/setup/admin',
    complete: '/setup/complete',
    importPreview: '/setup/import/preview',
    importCommit: '/setup/import/commit',
    historyPreview: '/setup/import/history/preview',
    historyCommit: '/setup/import/history/commit',
  },
  customers: {
    list: '/customers',
    byId: (id: number) => `/customers/${id}`,
    lookupTax: '/customers/lookup-tax',
  },
  products: {
    list: '/products',
    byId: (id: number) => `/products/${id}`,
  },
  quotes: {
    list: '/quotes',
    byId: (id: number) => `/quotes/${id}`,
    job: (jobId: string) => `/quotes/jobs/${jobId}`,
    parse: '/quotes/parse',
    confirm: '/quotes/confirm',
    file: (fileHash: string) => `/quotes/file/${fileHash}`,
    preview: (fileHash: string) => `/quotes/preview/${fileHash}`,
  },
  invoices: {
    list: '/invoices',
    byId: (id: number) => `/invoices/${id}`,
    duplicateCheck: (id: number) => `/invoices/${id}/duplicate-check`,
    export: '/invoices/export',
  },
  admin: {
    users: '/admin/users',
    user: (id: number) => `/admin/users/${id}`,
    auditLogs: '/admin/audit-logs',
    aiProviders: {
      list: '/admin/ai-providers',
      byId: (id: number) => `/admin/ai-providers/${id}`,
      enabled: '/admin/ai-providers/enabled',
      reorder: '/admin/ai-providers/reorder',
      backup: '/admin/ai-providers/backup',
      restore: '/admin/ai-providers/restore',
      test: '/admin/ai-providers/test',
      models: '/admin/ai-providers/models',
    },
  },
} as const;
