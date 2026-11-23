import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  BellRing,
  CheckCircle,
  FileText,
  FolderKanban,
  Grid3X3,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  MoreHorizontal,
  Palette,
  Pencil,
  Settings,
  Shield,
  ShieldOff,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Layout/Header';
import ApiKeyPanel from '../components/ApiKeyPanel';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { _toast } from '../store/toastRef';
import { useShallow } from 'zustand/react/shallow';
import { getAvatarUrl } from '../utils/avatar';
import { readAnimationsEnabled, saveAnimationsEnabled } from '../utils/motionPreference';
import { useUiPreferenceStore } from '../store/uiPreferenceStore';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { MobileBaseAppbar, MobileBaseSettingsRow } from '../components/Mobile';
import {
  browserNotificationPermission,
  browserNotificationsSupported,
  primeNotificationSound,
  readBrowserNotificationPreferences,
  requestBrowserNotificationAccess,
  saveBrowserNotificationPreferences,
  type BrowserNotificationPreferences,
} from '../utils/browserNotifications';

const ROLE_LABELS: Record<string, string> = {
  user: '普通用户',
  admin: '高级用户',
};

const BUSINESS_ROLE_LABELS: Record<string, string> = {
  intern: '实习生',
  trust_manager: '信托经理',
  developer: '开发者',
  admin: '管理员',
};

const STATUS_LABELS: Record<string, string> = {
  active: '启用',
  disabled: '禁用',
  pending: '待审核',
};

function PasswordInput({
  label,
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
  autoComplete,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder: string;
  autoComplete: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="relative block">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          autoComplete={autoComplete}
          className={`h-10 w-full border bg-white px-3 pr-10 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-100 ${
            invalid ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : 'border-slate-200'
          }`}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-700"
          aria-label={visible ? '隐藏密码' : '显示密码'}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </span>
    </label>
  );
}

function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 200;
        let width = img.width;
        let height = img.height;
        if (width > max || height > max) {
          const ratio = Math.min(max / width, max / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('无法处理图片'));
          return;
        }
        context.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const navigate = useNavigate();
  const isMobileViewport = useMobileViewport();
  const { user, refreshUser, logout } = useAuthStore(useShallow(state => ({
    user: state.user,
    refreshUser: state.refreshUser,
    logout: state.logout,
  })));
  const fileRef = useRef<HTMLInputElement>(null);
  const uiPreferences = useUiPreferenceStore(state => state.preferences);
  const updateUiPreferences = useUiPreferenceStore(state => state.updatePreferences);

  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [birthday, setBirthday] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(() => readAnimationsEnabled(user?.id));
  const [notificationPermission, setNotificationPermission] = useState(() => browserNotificationPermission());
  const [notificationPreferences, setNotificationPreferences] = useState<BrowserNotificationPreferences>(() => readBrowserNotificationPreferences(user?.id));

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPwd, setShowOldPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeSection, setActiveSection] = useState<'profile' | 'api' | 'preferences' | 'security'>('profile');
  const [profileEditing, setProfileEditing] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setAvatarSrc(getAvatarUrl(user, Date.now()));
    setDisplayName(user.display_name || '');
    setEmail(user.email || '');
    setBirthday(user.birthday || '');
  }, [user?.birthday, user?.email, user?.id, user?.display_name]);

  useEffect(() => {
    setAnimationsEnabled(readAnimationsEnabled(user?.id));
    setNotificationPermission(browserNotificationPermission());
    setNotificationPreferences(readBrowserNotificationPreferences(user?.id));
  }, [user?.id]);

  const authorizeBrowserNotifications = async () => {
    const permission = await requestBrowserNotificationAccess(user?.id);
    setNotificationPermission(permission);
    setNotificationPreferences(readBrowserNotificationPreferences(user?.id));
    if (permission === 'granted') _toast.success?.('浏览器通知已开启');
    else if (permission === 'denied') _toast.warning?.('浏览器已拒绝通知，请在网站权限设置中重新开启');
    else if (permission === 'unsupported') _toast.warning?.('当前浏览器不支持网页通知');
  };

  const updateNotificationPreference = async (key: keyof BrowserNotificationPreferences, value: boolean) => {
    if (key === 'enabled' && value && notificationPermission !== 'granted') {
      await authorizeBrowserNotifications();
      return;
    }
    const next = { ...notificationPreferences, [key]: value };
    setNotificationPreferences(next);
    saveBrowserNotificationPreferences(user?.id, next);
    if (key === 'sound' && value) {
      await primeNotificationSound();
      _toast.success?.('消息提示音已开启');
    }
  };

  const handleAnimationsChange = () => {
    const nextEnabled = !animationsEnabled;
    setAnimationsEnabled(nextEnabled);
    saveAnimationsEnabled(user?.id, nextEnabled);
    _toast.success?.(nextEnabled ? '网页动画已开启' : '网页动画已关闭');
  };

  const updateBooleanPreference = (key: 'showShortcutHints' | 'showOnlineUsers' | 'sidebarExpanded', value: boolean) => {
    void updateUiPreferences({ [key]: value }, '使用偏好保存失败');
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
  };

  const role = user?.role || 'user';
  const businessRole = user?.business_role || 'intern';
  const status = user?.status || 'active';
  const roleLabel = ROLE_LABELS[role] || role;
  const businessRoleLabel = BUSINESS_ROLE_LABELS[businessRole] || businessRole;
  const statusLabel = STATUS_LABELS[status] || status;
  const passwordMismatch = Boolean(confirmPassword && newPassword !== confirmPassword);
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id) return;
    setUploadingAvatar(true);
    try {
      const compressed = await compressAvatar(file);
      await api.post('/upload/avatar', { image: compressed });
      await refreshUser();
      setAvatarSrc(getAvatarUrl(user, Date.now()));
      _toast.success?.('头像已更新');
    } catch (error: any) {
      _toast.error?.(error.message || '头像上传失败');
    } finally {
      setUploadingAvatar(false);
      event.target.value = '';
    }
  };

  const handleSaveProfile = async () => {
    if (savingProfile) return false;
    const nextName = displayName.trim();
    const nextEmail = email.trim();
    if (!nextName) {
      _toast.warning?.('真实姓名不能为空');
      return false;
    }
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      _toast.warning?.('请输入有效的邮箱地址');
      return false;
    }
    setSavingProfile(true);
    try {
      await api.put('/auth/profile', { display_name: nextName, email: nextEmail, birthday });
      await refreshUser();
      _toast.success?.('个人资料已保存');
      return true;
    } catch (error: any) {
      _toast.error?.(error.message || '保存失败');
      return false;
    } finally {
      setSavingProfile(false);
    }
  };

  const saveProfileForm = async () => {
    if (await handleSaveProfile()) {
      setProfileEditing(false);
    }
  };

  const cancelProfileForm = () => {
    setDisplayName(user?.display_name || '');
    setEmail(user?.email || '');
    setBirthday(user?.birthday || '');
    setProfileEditing(false);
  };

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordUpdated(false);
    if (!oldPassword || !newPassword || !confirmPassword) {
      _toast.warning?.('请填写完整的密码信息');
      return;
    }
    if (newPassword.length < 6) {
      _toast.warning?.('新密码至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      _toast.error?.('两次输入的新密码不一致');
      return;
    }

    setSavingPassword(true);
    try {
      await api.put('/auth/password', { oldPassword, newPassword });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordUpdated(true);
      _toast.success?.('密码已更新');
    } catch (error: any) {
      _toast.error?.(error.message || '密码修改失败');
    } finally {
      setSavingPassword(false);
    }
  };

  const sections = [
    { key: 'profile' as const, label: '个人资料' },
    { key: 'api' as const, label: 'AI 与 API' },
    { key: 'preferences' as const, label: '使用偏好' },
    { key: 'security' as const, label: '账号安全' },
  ];

  if (isMobileViewport) {
    const emailValue = user?.email || '未填写邮箱';
    const emailParts = emailValue.split('@');
    const maskedEmail = emailParts.length === 2 && emailParts[0].length > 3
      ? `${emailParts[0].slice(0, 3)}***@${emailParts[1]}`
      : emailValue;
    return (
      <div className="mobile-base-page mobile-base-profile-page square-ui">
        <MobileBaseAppbar
          title="个人中心"
          action={<button type="button" onClick={() => navigate('/appearance')} aria-label="个人设置"><Settings size={22} /></button>}
        />
        <section className="mobile-base-profile-hero">
          <button type="button" className="mobile-base-profile-avatar" onClick={() => fileRef.current?.click()} disabled={uploadingAvatar} aria-label="更换头像">
            {avatarSrc ? <img src={avatarSrc} alt={user?.display_name || '头像'} onError={() => setAvatarSrc(null)} /> : (user?.display_name || user?.id || '?').slice(0, 1)}
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          <div>
            <h2>{user?.display_name || user?.id || '未命名用户'}</h2>
            <p>全球资本运营部 · {businessRoleLabel}</p>
            <p>{maskedEmail}</p>
          </div>
        </section>

        <div className="mobile-base-group-title">账号</div>
        <section className="mobile-base-settings-group">
          <MobileBaseSettingsRow icon={User} label="个人资料" value="已完善" onClick={() => setProfileEditing(true)} />
          <MobileBaseSettingsRow icon={KeyRound} label="账号安全" value="修改密码" onClick={() => setActiveSection('security')} />
          <MobileBaseSettingsRow icon={BellRing} label="通知权限" value={notificationPermission === 'granted' ? '已开启' : '未开启'} onClick={() => void authorizeBrowserNotifications()} />
        </section>

        <div className="mobile-base-group-title">使用偏好</div>
        <section className="mobile-base-settings-group">
          <MobileBaseSettingsRow icon={FolderKanban} label="项目显示" value="卡片视图" />
          <MobileBaseSettingsRow icon={FileText} label="周报显示" value="本周优先" />
          <MobileBaseSettingsRow icon={Palette} label="外观模式" value="跟随系统" onClick={() => navigate('/appearance')} />
        </section>

        <div className="mobile-base-group-title" />
        <section className="mobile-base-settings-group">
          <MobileBaseSettingsRow icon={Grid3X3} label="GCO Link API" value="已配置" onClick={() => setActiveSection('api')} />
          <MobileBaseSettingsRow icon={MoreHorizontal} label="关于 GCO Link" value="V2.6.0" />
          <MobileBaseSettingsRow label={loggingOut ? '正在退出…' : '退出登录'} danger onClick={() => void handleLogout()} />
        </section>
      </div>
    );
  }

  return (
    <div className="mobile-system-page mobile-profile-page square-ui flex min-h-full w-full flex-col gap-5 overflow-visible lg:h-full lg:overflow-hidden">
      <Header title="个人中心" subtitle="管理个人资料、使用偏好、连接能力与账号安全。" />

      <div className="profile-workspace flex min-h-0 flex-1 flex-col overflow-visible bg-white lg:overflow-hidden">
        <section className="profile-hero flex shrink-0 flex-col gap-5 px-6 py-5 md:flex-row md:items-center">
          <div className="relative h-20 w-20 shrink-0">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadingAvatar} className="group flex h-20 w-20 items-center justify-center overflow-hidden border border-slate-200 bg-slate-50 text-2xl font-semibold text-slate-700" title="更换头像">
              {avatarSrc ? <img src={avatarSrc} alt={user?.display_name || '头像'} className="h-full w-full object-cover" onError={() => setAvatarSrc(null)} /> : (user?.display_name || user?.id || '?').slice(0, 1)}
              <span className="absolute inset-0 flex items-center justify-center bg-slate-950/45 text-white opacity-0 transition-opacity group-hover:opacity-100">{uploadingAvatar ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-2xl font-semibold text-slate-950">{user?.display_name || user?.id || '未命名用户'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span>{user?.id || '-'}</span><span className="text-slate-300">·</span><span>{user?.email || '未填写邮箱'}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">{role === 'admin' ? <Shield size={13} /> : <ShieldOff size={13} />}{roleLabel}</span>
              <span>{businessRoleLabel}</span><span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 bg-emerald-500" />{statusLabel}</span>
            </div>
          </div>
        </section>

        <div className="grid min-h-0 flex-1 border-t border-slate-200 lg:grid-cols-[216px_minmax(0,1fr)]">
          <nav className="profile-nav flex shrink-0 overflow-x-auto border-b border-slate-200 p-3 lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <h2 className="hidden px-2 py-2 text-xs font-semibold text-slate-400 lg:block">设置索引</h2>
            <div className="flex gap-1 lg:mt-1 lg:grid">
              {sections.map(item => <button key={item.key} type="button" onClick={() => setActiveSection(item.key)} className={`profile-nav__item relative flex h-12 shrink-0 items-center px-3 text-left text-sm transition-colors before:absolute before:inset-y-2 before:left-0 before:w-0.5 ${activeSection === item.key ? 'is-active' : ''}`}><span className="truncate">{item.label}</span></button>)}
            </div>
          </nav>

          <main className="profile-content min-h-0 overflow-visible px-4 py-5 sm:px-6 sm:py-6 lg:overflow-y-auto lg:px-8">
            {activeSection === 'profile' && <section className="max-w-4xl">
              <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-slate-950">个人资料</h2><p className="mt-1 text-sm text-slate-500">姓名和邮箱会用于协作记录、通知与项目归属。</p></div>{!profileEditing && <button type="button" onClick={() => setProfileEditing(true)} className="app-button-secondary h-10"><Pencil size={15} />编辑</button>}</div>
              <div className="mt-7 divide-y divide-slate-100 border-y border-slate-200">
                <ProfileField label="真实姓名" value={user?.display_name || '-'} editing={profileEditing}><input value={displayName} onChange={event => setDisplayName(event.target.value)} className="app-control h-10 w-full max-w-md px-3 text-sm" /></ProfileField>
                <ProfileField label="工作邮箱" value={user?.email || '未填写'} editing={profileEditing}><input type="email" value={email} onChange={event => setEmail(event.target.value)} className="app-control h-10 w-full max-w-md px-3 text-sm" placeholder="填写工作邮箱" /></ProfileField>
                <ProfileField label="生日" value={user?.birthday || '未填写'} editing={profileEditing}><input type="date" min="1900-01-01" max={new Date().toISOString().slice(0, 10)} value={birthday} onChange={event => setBirthday(event.target.value)} className="app-control h-10 w-full max-w-md px-3 text-sm" /></ProfileField>
                <ProfileField label="用户编号" value={user?.id || '-'} />
                <ProfileField label="业务身份" value={businessRoleLabel} hint="由高级用户维护" />
                <ProfileField label="系统权限" value={roleLabel} hint="由高级用户维护" />
                <ProfileField label="账号状态" value={statusLabel} hint="由高级用户维护" />
              </div>
              {profileEditing && <div className="mt-6 grid max-w-md grid-cols-2 gap-3"><button type="button" onClick={cancelProfileForm} className="app-button-secondary h-10">取消</button><button type="button" onClick={() => void saveProfileForm()} disabled={savingProfile} className="app-button-primary h-10">{savingProfile && <Loader2 size={15} className="animate-spin" />}保存</button></div>}
            </section>}

            {activeSection === 'api' && <section className="max-w-4xl"><div><h2 className="text-lg font-semibold text-slate-950">AI 与 API</h2><p className="mt-1 text-sm text-slate-500">让 Agent 安全访问你在 GCO Link 中被授权的能力。</p></div><div className="mt-7"><ApiKeyPanel embedded /></div></section>}

            {activeSection === 'preferences' && <section className="max-w-4xl"><div><h2 className="text-lg font-semibold text-slate-950">使用偏好</h2><p className="mt-1 text-sm text-slate-500">按照自己的工作习惯调整表格与界面反馈。</p></div><div className="mt-7 divide-y divide-slate-100 border-y border-slate-200">
              <div className="flex min-h-[76px] items-center justify-between gap-5 py-4"><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-medium text-slate-900"><BellRing size={15} className="text-slate-500" />桌面通知权限</div><div className="mt-1 text-xs leading-5 text-slate-500">{!browserNotificationsSupported() ? '当前浏览器不支持网页通知。' : notificationPermission === 'granted' ? '已授权，可在收到协作任务和消息时显示系统通知。' : notificationPermission === 'denied' ? '已被浏览器拒绝，请在地址栏的网站权限中重新允许。' : '需要你主动授权，网站无法自行开启此权限。'}</div></div>{notificationPermission !== 'granted' && browserNotificationsSupported() && <button type="button" onClick={() => void authorizeBrowserNotifications()} className="app-button-secondary h-9 shrink-0 px-3 text-xs">申请授权</button>}</div>
              <PreferenceSwitch label="浏览器通知" description="收到协作任务、任务回复或提醒时显示系统通知，仅影响当前浏览器。" checked={notificationPermission === 'granted' && notificationPreferences.enabled} onChange={value => void updateNotificationPreference('enabled', value)} />
              <PreferenceSwitch label="消息提示音" description="浏览器通知到达时播放短提示音；首次开启需要在当前页面完成一次点击交互。" checked={notificationPreferences.sound} onChange={value => void updateNotificationPreference('sound', value)} />
              <PreferenceSwitch label="显示快捷键提示" description="在表格按钮和右键菜单中显示组合键；关闭后快捷键本身仍然可用。" checked={uiPreferences.showShortcutHints} onChange={value => updateBooleanPreference('showShortcutHints', value)} />
              <PreferenceSwitch label="显示在线人员" description="在侧栏显示当前在线成员；关闭后实时协作、编辑状态和短暂锁定仍然正常工作。" checked={uiPreferences.showOnlineUsers} onChange={value => updateBooleanPreference('showOnlineUsers', value)} />
              <PreferenceSwitch label="默认展开侧栏" description="记住侧栏展开或收起状态，并在刷新、重新登录和切换页面后恢复。" checked={uiPreferences.sidebarExpanded} onChange={value => updateBooleanPreference('sidebarExpanded', value)} />
              <PreferenceSwitch label="全局动画" description="控制页面切换、弹窗、图表和控件的过渡动画，仅影响当前浏览器。" checked={animationsEnabled} onChange={() => handleAnimationsChange()} motion />
            </div></section>}

            {activeSection === 'security' && <section className="max-w-4xl"><div><h2 className="text-lg font-semibold text-slate-950">账号安全</h2><p className="mt-1 text-sm text-slate-500">修改登录密码并管理当前登录会话。</p></div><div className="mt-7 max-w-3xl">
                {passwordUpdated && (
                  <div className="mb-4 flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    <CheckCircle size={17} />
                    密码已修改成功
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="grid gap-4">
                  <div className="text-sm font-medium text-slate-900">修改密码</div>
                  <PasswordInput
                    label="当前密码"
                    value={oldPassword}
                    onChange={setOldPassword}
                    visible={showOldPwd}
                    onToggle={() => setShowOldPwd(value => !value)}
                    placeholder="输入当前密码"
                    autoComplete="current-password"
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <PasswordInput
                      label="新密码"
                      value={newPassword}
                      onChange={setNewPassword}
                      visible={showNewPwd}
                      onToggle={() => setShowNewPwd(value => !value)}
                      placeholder="至少 6 位"
                      autoComplete="new-password"
                    />
                    <PasswordInput
                      label="确认新密码"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      visible={showConfirmPwd}
                      onToggle={() => setShowConfirmPwd(value => !value)}
                      placeholder="再次输入新密码"
                      autoComplete="new-password"
                      invalid={passwordMismatch}
                    />
                  </div>

                  {passwordMismatch && <div className="text-xs text-red-500">两次输入的新密码不一致</div>}

                  <div className="mt-1 flex justify-start">
                    <button
                      type="submit"
                      disabled={savingPassword || passwordMismatch}
                      className="profile-password-submit app-button-primary h-10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingPassword ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                      更新密码
                    </button>
                  </div>
                </form>

                <div className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">当前登录会话</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">退出后将返回登录页面，本机保存的登录状态会被清除。</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      disabled={loggingOut}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-wait disabled:opacity-50"
                    >
                      {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
                      {loggingOut ? '正在退出…' : '退出登录'}
                    </button>
                </div>
              </div></section>}
          </main>
        </div>
      </div>
    </div>
  );
}

function ProfileField({ label, value, hint, editing = false, children }: { label: string; value: string; hint?: string; editing?: boolean; children?: React.ReactNode }) {
  return <div className="grid min-h-16 items-center gap-2 py-3 sm:grid-cols-[150px_minmax(0,1fr)]"><div className="text-sm text-slate-500">{label}</div><div className="min-w-0">{editing && children ? children : <div className="flex items-center gap-3"><span className="truncate text-sm font-medium text-slate-900">{value}</span>{hint && <span className="text-xs text-slate-400">{hint}</span>}</div>}</div></div>;
}

function PreferenceSwitch({ label, description, checked, onChange, motion = false }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void; motion?: boolean }) {
  return <div className="flex min-h-[76px] items-center justify-between gap-5 py-4"><div className="min-w-0"><div className="text-sm font-medium text-slate-900">{label}</div><div className="mt-1 text-xs leading-5 text-slate-500">{description}</div></div><button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`${motion ? 'motion-preference-toggle ' : ''}relative flex h-7 w-12 shrink-0 items-center rounded-full border p-[3px] ${checked ? 'border-primary-600 bg-primary-600' : 'border-slate-300 bg-slate-200'}`}><span aria-hidden="true" className={`${motion ? 'motion-preference-toggle__thumb ' : ''}block h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>;
}
