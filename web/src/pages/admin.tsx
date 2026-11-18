import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScrollText, Shield } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { Pagination } from './customers';
import { cn, formatDate } from '@/lib/utils';

interface AdminUser {
  id: number;
  email: string;
  fullName: string;
  role: 'admin' | 'accountant';
  status: 'pending' | 'active' | 'locked';
  createdAt: string;
}

interface AuditRow {
  id: number;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
  userId: number | null;
  detailJson: string;
}

export default function AdminPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'users' | 'logs'>('users');
  const [page, setPage] = useState(1);

  const users = useQuery({
    queryKey: ['admin-users', page],
    queryFn: async () => {
      const { data } = await api.get('/admin/users', { params: { page, pageSize: 20 } });
      return data as { data: AdminUser[]; pagination: { totalPages: number } };
    },
    enabled: tab === 'users',
  });

  const logs = useQuery({
    queryKey: ['admin-logs', page],
    queryFn: async () => {
      const { data } = await api.get('/admin/audit-logs', { params: { page, pageSize: 50 } });
      return data as { data: AuditRow[]; pagination: { totalPages: number } };
    },
    enabled: tab === 'logs',
  });

  const patch = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Record<string, string> }) =>
      api.patch(`/admin/users/${id}`, body),
    onSuccess: () => {
      toast.success('Đã cập nhật tài khoản');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const userColumns: Column<AdminUser>[] = [
    { key: 'name', header: 'Họ tên', render: (r) => <span className="font-medium">{r.fullName}</span> },
    { key: 'email', header: 'Email', render: (r) => <span className="text-muted-foreground">{r.email}</span> },
    { key: 'role', header: 'Vai trò', render: (r) => (r.role === 'admin' ? 'Quản trị' : 'Kế toán') },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (r) => (
        <span
          className={cn(
            'badge',
            r.status === 'active' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
            r.status === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            r.status === 'locked' && 'bg-destructive/10 text-destructive',
          )}
        >
          {r.status === 'active' ? 'Hoạt động' : r.status === 'pending' ? 'Chờ duyệt' : 'Đã khóa'}
        </span>
      ),
    },
    { key: 'createdAt', header: 'Ngày tạo', render: (r) => formatDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {r.status === 'pending' && (
            <button className="btn-primary h-7 px-2.5 text-xs" onClick={() => patch.mutate({ id: r.id, body: { status: 'active' } })}>
              Duyệt
            </button>
          )}
          {r.status === 'active' && (
            <button className="btn-outline h-7 px-2.5 text-xs" onClick={() => patch.mutate({ id: r.id, body: { status: 'locked' } })}>
              Khóa
            </button>
          )}
          {r.status === 'locked' && (
            <button className="btn-outline h-7 px-2.5 text-xs" onClick={() => patch.mutate({ id: r.id, body: { status: 'active' } })}>
              Mở khóa
            </button>
          )}
          <select
            aria-label="Đổi vai trò"
            value={r.role}
            onChange={(e) => patch.mutate({ id: r.id, body: { role: e.target.value } })}
            className="input h-7 w-auto px-2 text-xs"
          >
            <option value="accountant">Kế toán</option>
            <option value="admin">Quản trị</option>
          </select>
        </div>
      ),
    },
  ];

  const logColumns: Column<AuditRow>[] = [
    { key: 'createdAt', header: 'Thời gian', render: (r) => formatDate(r.createdAt) },
    { key: 'action', header: 'Thao tác', render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: 'entity', header: 'Đối tượng', render: (r) => `${r.entity} #${r.entityId}` },
    { key: 'userId', header: 'Người dùng', render: (r) => (r.userId ? `#${r.userId}` : 'hệ thống') },
    { key: 'detail', header: 'Chi tiết', render: (r) => <span className="line-clamp-1 max-w-[380px] text-xs text-muted-foreground">{r.detailJson}</span> },
  ];

  return (
    <div>
      <PageHeader title="Quản trị" description="Quản lý người dùng và nhật ký thao tác." />
      <div className="mb-4 flex rounded-xl border p-0.5 w-fit" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'users'}
          onClick={() => { setTab('users'); setPage(1); }}
          className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm', tab === 'users' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
        >
          <Shield className="h-4 w-4" /> Người dùng
        </button>
        <button
          role="tab"
          aria-selected={tab === 'logs'}
          onClick={() => { setTab('logs'); setPage(1); }}
          className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm', tab === 'logs' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
        >
          <ScrollText className="h-4 w-4" /> Nhật ký
        </button>
      </div>

      {tab === 'users' ? (
        <>
          <DataTable
            rows={users.data?.data ?? []}
            columns={userColumns}
            rowKey={(r) => r.id}
            loading={users.isLoading}
            empty={<EmptyState title="Không có người dùng" />}
          />
          {users.data && users.data.pagination.totalPages > 1 && (
            <Pagination page={page} totalPages={users.data.pagination.totalPages} onChange={setPage} />
          )}
        </>
      ) : (
        <>
          <DataTable
            rows={logs.data?.data ?? []}
            columns={logColumns}
            rowKey={(r) => r.id}
            loading={logs.isLoading}
            empty={<EmptyState title="Chưa có nhật ký" />}
          />
          {logs.data && logs.data.pagination.totalPages > 1 && (
            <Pagination page={page} totalPages={logs.data.pagination.totalPages} onChange={setPage} />
          )}
        </>
      )}
    </div>
  );
}
