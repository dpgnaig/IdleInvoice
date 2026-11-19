import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ScrollText, Shield } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { SegmentedControl } from '@/components/ui/toolbar';
import { Pagination } from '@/components/ui/pagination';
import { useAutoPageSize } from '@/lib/use-auto-page-size';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';

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
  const { ref: tableRef, pageSize } = useAutoPageSize();
  // Số dòng/trang đổi theo kích thước cửa sổ -> quay về trang 1 để không vượt quá số trang
  useEffect(() => setPage(1), [pageSize]);

  const users = useQuery({
    queryKey: ['admin-users', page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get('/admin/users', { params: { page, pageSize } });
      return data as { data: AdminUser[]; pagination: { totalPages: number; total: number } };
    },
    enabled: tab === 'users',
  });

  const logs = useQuery({
    queryKey: ['admin-logs', page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get('/admin/audit-logs', { params: { page, pageSize } });
      return data as { data: AuditRow[]; pagination: { totalPages: number; total: number } };
    },
    enabled: tab === 'logs',
  });

  const tabs = (
    <SegmentedControl
      ariaLabel="Chọn mục quản trị"
      value={tab}
      onChange={(v) => { setTab(v); setPage(1); }}
      options={[
        { value: 'users', label: 'Người dùng', icon: <Shield className="h-3.5 w-3.5" /> },
        { value: 'logs', label: 'Nhật ký', icon: <ScrollText className="h-3.5 w-3.5" /> },
      ]}
    />
  );

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
    { key: 'email', width: '260px', header: 'Email', render: (r) => <span className="text-muted-foreground">{r.email}</span> },
    { key: 'role', width: '120px', header: 'Vai trò', render: (r) => (r.role === 'admin' ? 'Quản trị' : 'Kế toán') },
    {
      key: 'status', width: '130px',
      header: 'Trạng thái',
      render: (r) => (
        <Badge variant={r.status === 'active' ? 'success' : r.status === 'pending' ? 'warning' : 'destructive'}>
          {r.status === 'active' ? 'Hoạt động' : r.status === 'pending' ? 'Chờ duyệt' : 'Đã khóa'}
        </Badge>
      ),
    },
    { key: 'createdAt', width: '130px', header: 'Ngày tạo', render: (r) => formatDate(r.createdAt) },
    {
      key: 'actions', width: '200px',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === 'pending' && (
            <Button size="sm" onClick={() => patch.mutate({ id: r.id, body: { status: 'active' } })}>
              Duyệt
            </Button>
          )}
          {r.status === 'active' && (
            <Button variant="outline" size="sm" onClick={() => patch.mutate({ id: r.id, body: { status: 'locked' } })}>
              Khóa
            </Button>
          )}
          {r.status === 'locked' && (
            <Button variant="outline" size="sm" onClick={() => patch.mutate({ id: r.id, body: { status: 'active' } })}>
              Mở khóa
            </Button>
          )}
          <NativeSelect
            aria-label="Đổi vai trò"
            value={r.role}
            onChange={(e) => patch.mutate({ id: r.id, body: { role: e.target.value } })}
            className="w-24"
            selectClassName="h-8 text-xs"
          >
            <option value="accountant">Kế toán</option>
            <option value="admin">Quản trị</option>
          </NativeSelect>
        </div>
      ),
    },
  ];

  const logColumns: Column<AuditRow>[] = [
    { key: 'createdAt', width: '130px', header: 'Thời gian', render: (r) => formatDate(r.createdAt) },
    { key: 'action', width: '200px', header: 'Thao tác', render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: 'entity', width: '180px', header: 'Đối tượng', render: (r) => `${r.entity} #${r.entityId}` },
    { key: 'userId', width: '120px', header: 'Người dùng', render: (r) => (r.userId ? `#${r.userId}` : 'hệ thống') },
    { key: 'detail', header: 'Chi tiết', render: (r) => <span className="text-xs text-muted-foreground" title={r.detailJson}>{r.detailJson}</span> },
  ];

  return (
    <div>
      <PageHeader title="Quản trị" description="Quản lý người dùng và nhật ký thao tác." />
      {tab === 'users' ? (
        <DataTable
          cardRef={tableRef}
          toolbar={tabs}
          footer={
            <Pagination
              page={page}
              totalPages={users.data?.pagination.totalPages ?? 1}
              total={users.data?.pagination.total}
              pageSize={pageSize}
              unit="người dùng"
              onChange={setPage}
            />
          }
          rows={users.data?.data ?? []}
          pageSize={pageSize}
          fetching={users.isPlaceholderData}
          columns={userColumns}
          rowKey={(r) => r.id}
          loading={users.isLoading}
          empty={<EmptyState title="Không có người dùng" />}
        />
      ) : (
        <DataTable
          cardRef={tableRef}
          toolbar={tabs}
          footer={
            <Pagination
              page={page}
              totalPages={logs.data?.pagination.totalPages ?? 1}
              total={logs.data?.pagination.total}
              pageSize={pageSize}
              unit="bản ghi"
              onChange={setPage}
            />
          }
          rows={logs.data?.data ?? []}
          pageSize={pageSize}
          fetching={logs.isPlaceholderData}
          columns={logColumns}
          rowKey={(r) => r.id}
          loading={logs.isLoading}
          empty={<EmptyState title="Chưa có nhật ký" />}
        />
      )}
    </div>
  );
}
