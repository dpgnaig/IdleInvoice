import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/sonner';
import { Bot, KeyRound, Pencil, ScrollText, Shield, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { endpoints } from '@/lib/endpoints';
import { useAuth } from '@/lib/auth';
import AiSettingsPage, { fetchAiProviders } from '@/pages/ai-settings';
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
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

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
  const [tab, setTab] = useState<'users' | 'logs' | 'ai'>('users');
  const [page, setPage] = useState(1);
  const { ref: tableRef, pageSize } = useAutoPageSize();
  // Số dòng/trang đổi theo kích thước cửa sổ -> quay về trang 1 để không vượt quá số trang
  useEffect(() => setPage(1), [pageSize]);

  // Nạp sẵn cấu hình AI ngay khi mở Quản trị để chuyển tab không bị trống/spinner
  useEffect(() => {
    void qc.prefetchQuery({ queryKey: ['ai-providers'], queryFn: fetchAiProviders });
  }, [qc]);

  const users = useQuery({
    queryKey: ['admin-users', page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get(endpoints.admin.users, { params: { page, pageSize } });
      return data as { data: AdminUser[]; pagination: { totalPages: number; total: number } };
    },
    enabled: tab === 'users',
  });

  const logs = useQuery({
    queryKey: ['admin-logs', page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await api.get(endpoints.admin.auditLogs, { params: { page, pageSize } });
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
        { value: 'ai', label: 'AI Agent', icon: <Bot className="h-3.5 w-3.5" /> },
      ]}
    />
  );

  const approve = useMutation({
    mutationFn: async (id: number) => api.patch(endpoints.admin.user(id), { status: 'active' }),
    onSuccess: () => {
      toast.success('Đã duyệt tài khoản');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [delUser, setDelUser] = useState<AdminUser | null>(null);

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(endpoints.admin.user(id)),
    onSuccess: () => {
      toast.success('Đã xóa người dùng');
      setDelUser(null);
      setEditUser(null);
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
      key: 'actions', width: '170px',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === 'pending' && (
            <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>
              Duyệt
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditUser(r)}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Sửa
          </Button>
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
      <PageHeader title="Quản trị" description="Quản lý người dùng, cấu hình AI và nhật ký thao tác." />

      {/* Tab ở tab AI nằm chung hàng với nút thao tác (do panel AI render),
          các tab khác vẫn dùng hàng tab riêng bên dưới tiêu đề. */}
      {tab !== 'ai' && <div className="mb-3">{tabs}</div>}

      {/* Giữ panel AI mount sẵn (ẩn khi không chọn) để chuyển tab là hiện ngay */}
      <div className={tab === 'ai' ? '' : 'hidden'} aria-hidden={tab !== 'ai'}>
        <AiSettingsPage embedded embeddedToolbar={tabs} />
      </div>

      {tab === 'users' && (
        <DataTable
          cardRef={tableRef}
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
      )}

      <EditUserDialog user={editUser} onClose={() => setEditUser(null)} onDelete={(u) => setDelUser(u)} />

      <ConfirmDialog
        open={delUser !== null}
        onOpenChange={(v) => { if (!v) setDelUser(null); }}
        title="Xóa người dùng"
        description={delUser ? `Xóa tài khoản ${delUser.fullName} (${delUser.email})? Hành động này không thể hoàn tác. Báo giá, hóa đơn và nhật ký do người này tạo vẫn được giữ lại.` : ''}
        confirmLabel="Xóa"
        destructive
        loading={remove.isPending}
        onConfirm={async () => { if (delUser) await remove.mutateAsync(delUser.id).catch(() => undefined); }}
      />

      {tab === 'logs' && (
        <DataTable
          cardRef={tableRef}
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

/** Modal sửa người dùng: thông tin, vai trò, khóa/mở khóa, đổi mật khẩu và xóa tài khoản. */
function EditUserDialog({
  user,
  onClose,
  onDelete,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onDelete: (u: AdminUser) => void;
}) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('accountant');
  const [status, setStatus] = useState<AdminUser['status']>('active');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (!user) return;
    setFullName(user.fullName);
    setRole(user.role);
    setStatus(user.status);
    setNewPassword('');
  }, [user]);

  const isSelf = user !== null && me?.id === user.id;
  const trimmedName = fullName.trim();
  const dirty =
    user !== null && (trimmedName !== user.fullName || role !== user.role || status !== user.status);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const body: Record<string, string> = {};
      if (trimmedName !== user.fullName) body.fullName = trimmedName;
      if (role !== user.role) body.role = role;
      if (status !== user.status) body.status = status;
      await api.patch(endpoints.admin.user(user.id), body);
    },
    onSuccess: () => {
      toast.success('Đã cập nhật tài khoản');
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const resetPw = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await api.post(endpoints.admin.resetPassword(user.id), { password: newPassword });
    },
    onSuccess: () => {
      toast.success('Đã đặt lại mật khẩu');
      setNewPassword('');
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <Dialog
      open={user !== null}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title="Sửa người dùng"
      description={user ? user.email : undefined}
      className="max-w-lg"
    >
      {user && (
        <div className="grid gap-5">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && trimmedName.length > 0) save.mutate();
            }}
          >
            <Field label="Họ tên" htmlFor="admin-edit-name">
              <Input id="admin-edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Vai trò" htmlFor="admin-edit-role" hint={isSelf ? 'Không thể tự hạ quyền của mình' : undefined}>
                <NativeSelect
                  id="admin-edit-role"
                  value={role}
                  disabled={isSelf}
                  onChange={(e) => setRole(e.target.value as AdminUser['role'])}
                >
                  <option value="accountant">Kế toán</option>
                  <option value="admin">Quản trị</option>
                </NativeSelect>
              </Field>
              <Field label="Trạng thái" htmlFor="admin-edit-status" hint={isSelf ? 'Không thể tự khóa tài khoản của mình' : undefined}>
                <NativeSelect
                  id="admin-edit-status"
                  value={status}
                  disabled={isSelf}
                  onChange={(e) => setStatus(e.target.value as AdminUser['status'])}
                >
                  <option value="pending">Chờ duyệt</option>
                  <option value="active">Hoạt động</option>
                  <option value="locked">Đã khóa</option>
                </NativeSelect>
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!dirty || trimmedName.length === 0 || save.isPending}>
                Lưu thay đổi
              </Button>
            </div>
          </form>

          <form
            className="grid gap-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (newPassword.length >= 8) resetPw.mutate();
            }}
          >
            <Field
              label="Đặt lại mật khẩu"
              htmlFor="admin-edit-password"
              hint="Tối thiểu 8 ký tự. Người dùng sẽ bị đăng xuất khỏi mọi phiên."
              error={newPassword.length > 0 && newPassword.length < 8 ? 'Mật khẩu phải có ít nhất 8 ký tự' : undefined}
            >
              <Input
                id="admin-edit-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="outline" disabled={newPassword.length < 8 || resetPw.isPending}>
                <KeyRound className="mr-1 h-3.5 w-3.5" />
                Đổi mật khẩu
              </Button>
            </div>
          </form>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Xóa tài khoản</p>
              <p className="text-xs text-muted-foreground">
                {isSelf ? 'Không thể tự xóa tài khoản của mình.' : 'Không thể hoàn tác. Dữ liệu nghiệp vụ vẫn được giữ lại.'}
              </p>
            </div>
            <Button variant="outline" disabled={isSelf} onClick={() => onDelete(user)}>
              <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
              Xóa
            </Button>
          </div>

          <DialogFooter className="pt-0">
            <Button type="button" variant="outline" onClick={onClose}>
              Đóng
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  );
}
