import { useEffect, useMemo, useState } from 'react';
import { Check, Edit3, KeyRound, Plus, Shield, Trash2, X } from 'lucide-react';
import Header from '../components/Layout/Header';
import LoadingSpinner from '../components/LoadingSpinner';
import { useConfirm } from '../components/Toast';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { _toast } from '../store/toastRef';
import AppSelect from '../components/Form/AppSelect';
import UserProfileAvatar from '../components/UserProfileAvatar';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';

interface UserItem {
  id: string;
  display_name: string;
  email?: string;
  birthday?: string;
  role: 'user' | 'admin' | string;
  business_role?: 'intern' | 'trust_manager' | 'developer' | 'admin' | string;
  status?: 'active' | 'disabled' | 'pending';
  created_at?: string;
}

interface UserFormState {
  display_name: string;
  email: string;
  birthday: string;
  role: string;
  business_role: string;
  status: 'active' | 'disabled' | 'pending';
}

const roleLabels: Record<string, string> = {
  user: '普通用户',
  admin: '高级用户',
};

const businessRoleLabels: Record<string, string> = {
  intern: '实习生',
  trust_manager: '信托经理',
  developer: '开发者',
  admin: '管理员',
};

const roleOptions = ['user', 'admin'];
const businessRoleOptions = ['intern', 'trust_manager', 'developer', 'admin'];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function UserAvatar({ user }: { user: UserItem }) {
  return <UserProfileAvatar userId={user.id} displayName={user.display_name || user.id} className="h-12 w-12 text-base shadow-sm shadow-primary-900/15" />;
}

function buildForm(user: UserItem): UserFormState {
  return {
    display_name: user.display_name || '',
    email: user.email || '',
    birthday: user.birthday || '',
    role: roleOptions.includes(user.role) ? user.role : 'user',
    business_role: user.business_role || 'intern',
    status: user.status === 'pending' ? 'pending' : user.status === 'disabled' ? 'disabled' : 'active',
  };
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-slate-500">{children}</span>;
}

const detailInputClass = 'h-10 border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15';
const detailSelectTriggerClass = 'h-10 border-slate-200 focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15';

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      </div>
      <div className="grid gap-4 p-4">{children}</div>
    </section>
  );
}

export default function UserManagement() {
  const currentUser = useAuthStore(state => state.user);
  const { confirm: ask, ConfirmDialog } = useConfirm();

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState<UserFormState | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [createForm, setCreateForm] = useState({
    display_name: '',
    email: '',
    password: '',
    role: 'user',
    business_role: 'intern',
  });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ users: UserItem[] }>('/auth/users');
      setUsers(res.users || []);
    } catch (error) {
      _toast?.error?.(errorMessage(error, '获取人员列表失败'));
    } finally {
      setLoading(false);
    }
  };
  useRealtimeRefresh(['user'], fetchUsers);

  useEffect(() => {
    fetchUsers();
  }, []);

  const selectedLatest = useMemo(() => {
    if (!selectedUser) return null;
    return users.find(user => user.id === selectedUser.id) || selectedUser;
  }, [selectedUser, users]);

  const filteredUsers = users;

  const openEditor = (user: UserItem) => {
    setSelectedUser(user);
    setEditForm(buildForm(user));
    setShowResetPassword(false);
    setNewPassword('');
  };

  const closeEditor = () => {
    setSelectedUser(null);
    setEditForm(null);
    setShowResetPassword(false);
    setNewPassword('');
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createForm.display_name.trim() || !createForm.password.trim()) {
      _toast?.warning?.('请填写真实姓名和初始密码');
      return;
    }
    const email = createForm.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _toast?.warning?.('请输入有效的邮箱地址');
      return;
    }

    setCreating(true);
    try {
      await api.post('/auth/register', {
        display_name: createForm.display_name.trim(),
        email,
        password: createForm.password,
        role: createForm.role,
        business_role: createForm.business_role,
      });
      _toast?.success?.('人员已新增');
      setCreateForm({ display_name: '', email: '', password: '', role: 'user', business_role: 'intern' });
      setShowCreate(false);
      await fetchUsers();
    } catch (error) {
      _toast?.error?.(errorMessage(error, '新增人员失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedLatest || !editForm) return;
    if (!editForm.display_name.trim()) {
      _toast?.warning?.('真实姓名不能为空');
      return;
    }
    const email = editForm.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _toast?.warning?.('请输入有效的邮箱地址');
      return;
    }

    setSaving(true);
    try {
      await api.put(`/auth/users/${selectedLatest.id}`, {
        display_name: editForm.display_name.trim(),
        email,
        birthday: editForm.birthday,
        role: editForm.role,
        business_role: editForm.business_role,
      });
      _toast?.success?.('人员信息已更新');
      await fetchUsers();
    } catch (error) {
      _toast?.error?.(errorMessage(error, '更新人员失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedLatest) return;

    setSaving(true);
    try {
      await api.put(`/auth/users/${selectedLatest.id}`, { status: 'active' });
      _toast?.success?.('审核已通过');
      await fetchUsers();
      setEditForm(prev => prev ? { ...prev, status: 'active' } : prev);
    } catch (error) {
      _toast?.error?.(errorMessage(error, '审核失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedLatest) return;
    if (newPassword.length < 6) {
      _toast?.warning?.('新密码至少 6 位');
      return;
    }

    setResetting(true);
    try {
      await api.put(`/auth/users/${selectedLatest.id}/reset-password`, { newPassword });
      _toast?.success?.('密码已重置');
      setNewPassword('');
      setShowResetPassword(false);
    } catch (error) {
      _toast?.error?.(errorMessage(error, '重置密码失败'));
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLatest) return;
    const confirmed = await ask(`确认删除“${selectedLatest.display_name || selectedLatest.id}”吗？该操作不可恢复。`);
    if (!confirmed) return;

    try {
      await api.delete(`/auth/users/${selectedLatest.id}`);
      _toast?.success?.('人员已删除');
      closeEditor();
      await fetchUsers();
    } catch (error) {
      _toast?.error?.(errorMessage(error, '删除人员失败'));
    }
  };

  const canEditRole = Boolean(selectedLatest && currentUser?.role === 'admin');
  const canDeleteSelected = Boolean(selectedLatest && selectedLatest.id !== currentUser?.id);

  return (
    <div className="square-ui flex min-h-full min-w-0 w-full flex-col gap-5 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
      <Header title="人员管理" subtitle="集中维护系统成员、身份与访问权限。">
        <button
          type="button"
          onClick={() => setShowCreate(value => !value)}
          className="inline-flex h-10 items-center justify-center gap-2 border border-primary-600 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700"
        >
          {showCreate ? <X size={16} /> : <Plus size={16} />}
          新增人员
        </button>
      </Header>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="grid shrink-0 gap-3 border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-[minmax(150px,1fr)_minmax(190px,1.2fr)_minmax(150px,1fr)_140px_140px_auto] xl:items-center"
        >
          <input
            value={createForm.display_name}
            onChange={event => setCreateForm(prev => ({ ...prev, display_name: event.target.value }))}
            placeholder="真实姓名"
            className="h-10 border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
          />
          <input
            value={createForm.email}
            onChange={event => setCreateForm(prev => ({ ...prev, email: event.target.value }))}
            type="email"
            placeholder="邮箱（选填）"
            autoComplete="email"
            className="h-10 border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
          />
          <input
            value={createForm.password}
            onChange={event => setCreateForm(prev => ({ ...prev, password: event.target.value }))}
            type="password"
            placeholder="初始密码"
            className="h-10 border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
          />
          <AppSelect
            value={createForm.business_role}
            onChange={value => setCreateForm(prev => ({ ...prev, business_role: value }))}
            options={businessRoleOptions.map(role => ({ value: role, label: businessRoleLabels[role] }))}
            triggerClassName="h-10 border-slate-200"
          />
          <AppSelect
            value={createForm.role}
            onChange={value => setCreateForm(prev => ({ ...prev, role: value }))}
            options={roleOptions.map(role => ({ value: role, label: roleLabels[role] }))}
            triggerClassName="h-10 border-slate-200"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex h-10 items-center justify-center border border-slate-950 bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? '新增中...' : '确认新增'}
          </button>
        </form>
      )}

      <section
        className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-5 overflow-visible lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-visible lg:overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-visible lg:overflow-hidden">
            {loading ? (
              <LoadingSpinner fullPage message="加载人员列表..." />
            ) : filteredUsers.length === 0 ? (
              <div className="flex h-full min-h-[420px] items-center justify-center text-sm text-slate-400">
                暂无人员
              </div>
            ) : (
              <div className="grid h-auto auto-rows-max content-start gap-3 overflow-visible pr-0 sm:grid-cols-2 lg:h-full lg:overflow-y-auto lg:pr-1">
                {filteredUsers.map(user => (
                  <button
                    key={user.id}
                    data-user-card={user.id}
                    type="button"
                    onClick={() => openEditor(user)}
                    className={`group relative flex h-auto min-h-[144px] appearance-none items-start gap-4 self-start border-0 bg-white p-5 text-left outline-none transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-lg hover:shadow-slate-900/10 ${
                      selectedLatest?.id === user.id ? 'bg-primary-50 shadow-[0_8px_24px_rgba(15,23,42,0.08)]' : 'shadow-sm shadow-slate-900/5'
                    }`}
                  >
                    <UserAvatar user={user} />
                    <div className="flex min-h-[104px] min-w-0 flex-1 flex-col">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold tracking-tight text-slate-950">
                            {user.display_name || '未命名人员'}
                          </div>
                          <div className="mt-1.5 truncate text-xs text-slate-400" title={user.email || '未填写邮箱'}>
                            {user.email || '未填写邮箱'}
                          </div>
                        </div>
                        <Edit3 size={15} className="shrink-0 text-slate-300 transition-colors group-hover:text-primary-600" />
                      </div>
                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                        <span className="inline-flex bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {businessRoleLabels[user.business_role || 'intern'] || user.business_role || '实习生'}
                        </span>
                        <span className={`inline-flex px-2.5 py-1 text-[11px] font-medium ${selectedLatest?.id === user.id ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                          {roleLabels[user.role] || user.role || '未设置权限'}
                        </span>
                        <span className={`ml-auto truncate text-[10px] font-medium tabular-nums ${selectedLatest?.id === user.id ? 'text-primary-700' : 'text-slate-400'}`}>{user.id}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className={`${selectedLatest ? 'fixed inset-0 z-[60] flex' : 'hidden'} min-h-0 min-w-0 flex-col overflow-hidden border border-slate-200 bg-white lg:static lg:flex`}>
          {selectedLatest && editForm ? (
            <>
              <div className="shrink-0 border-b border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                      <Shield size={15} />
                      页面内编辑
                    </div>
                    <h2 className="mt-2 truncate text-lg font-semibold text-slate-950">{selectedLatest.display_name || selectedLatest.id}</h2>
                    <div className="mt-1 text-xs text-slate-500">{selectedLatest.id}</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeEditor}
                    className="flex h-9 w-9 shrink-0 items-center justify-center border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    aria-label="关闭编辑栏"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid gap-4">
                  <SectionBlock title="基础信息">
                    <label className="grid gap-1.5">
                      <FieldLabel>真实姓名</FieldLabel>
                      <input
                        value={editForm.display_name}
                        onChange={event => setEditForm(prev => prev ? { ...prev, display_name: event.target.value } : prev)}
                        className={detailInputClass}
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <FieldLabel>邮箱</FieldLabel>
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={event => setEditForm(prev => prev ? { ...prev, email: event.target.value } : prev)}
                        placeholder="填写成员邮箱，用于任务通知"
                        autoComplete="email"
                        className={detailInputClass}
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <FieldLabel>生日</FieldLabel>
                      <input
                        type="date"
                        min="1900-01-01"
                        max={new Date().toISOString().slice(0, 10)}
                        value={editForm.birthday}
                        onChange={event => setEditForm(prev => prev ? { ...prev, birthday: event.target.value } : prev)}
                        className={detailInputClass}
                      />
                    </label>
                  </SectionBlock>

                  <SectionBlock title="身份与权限">
                    <label className="grid gap-1.5">
                      <FieldLabel>业务身份</FieldLabel>
                      <AppSelect
                        value={editForm.business_role}
                        onChange={value => setEditForm(prev => prev ? { ...prev, business_role: value } : prev)}
                        options={businessRoleOptions.map(role => ({ value: role, label: businessRoleLabels[role] }))}
                        triggerClassName={detailSelectTriggerClass}
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <FieldLabel>系统权限</FieldLabel>
                      <AppSelect
                        value={editForm.role}
                        onChange={value => setEditForm(prev => prev ? { ...prev, role: value } : prev)}
                        options={roleOptions.map(role => ({
                          value: role,
                          label: roleLabels[role],
                          disabled: !canEditRole || selectedLatest.id === currentUser?.id,
                        }))}
                        triggerClassName={`${detailSelectTriggerClass} ${!canEditRole || selectedLatest.id === currentUser?.id ? 'bg-slate-100 text-slate-400' : ''}`}
                      />
                    </label>
                  </SectionBlock>

                  <SectionBlock title="安全操作">
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(value => !value)}
                      className="inline-flex h-10 items-center justify-center gap-2 border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <KeyRound size={16} />
                      重置密码
                    </button>

                    {showResetPassword && (
                      <form onSubmit={handleResetPassword} className="grid gap-2 border border-slate-200 bg-slate-50 p-3">
                        <input
                          value={newPassword}
                          onChange={event => setNewPassword(event.target.value)}
                          type="password"
                          placeholder="输入新密码"
                          className={detailInputClass}
                        />
                        <button
                          type="submit"
                          disabled={resetting}
                          className="inline-flex h-10 items-center justify-center gap-2 border border-slate-950 bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Check size={16} />
                          {resetting ? '提交中...' : '确认重置'}
                        </button>
                      </form>
                    )}

                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={!canDeleteSelected}
                      className="inline-flex h-10 items-center justify-center gap-2 border border-red-200 bg-white px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={16} />
                      删除账号
                    </button>
                  </SectionBlock>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-200 bg-white p-4">
                {selectedLatest.status === 'pending' && (
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={saving}
                    className="col-span-2 inline-flex h-10 items-center justify-center gap-2 bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check size={16} />
                    {saving ? '通过中...' : '通过审核'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeEditor}
                  className="h-10 border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="h-10 border-0 bg-slate-950 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存修改'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-6 text-center">
              <Shield size={28} className="text-slate-300" />
              <div className="mt-3 text-sm font-semibold text-slate-800">选择人员进行编辑</div>
              <div className="mt-2 max-w-[240px] text-xs leading-5 text-slate-500">
                点击左侧人员卡片后，权限、身份和密码操作会在这里显示。
              </div>
            </div>
          )}
        </aside>
      </section>

      {ConfirmDialog}
    </div>
  );
}
