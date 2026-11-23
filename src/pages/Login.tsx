import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, User, Loader2, UserPlus, LogIn, BriefcaseBusiness, GraduationCap } from 'lucide-react';
import TerrainContourBackground from '../components/TerrainContourBackground';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';

const REMEMBER_LOGIN_STORAGE_KEY = 'ibd-remember-login';
const REMEMBER_LOGIN_DAYS = 7;
const DEMO_IDENTIFIER = 'IBD-00001';
const DEMO_PASSWORD = '123456';

function getLocalPreviewCredentials() {
  const isLocalPreview = import.meta.env.DEV
    && ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
  if (!isLocalPreview) return { identifier: '', password: '' };
  return {
    identifier: import.meta.env.VITE_LOCAL_PREVIEW_UID || '',
    password: import.meta.env.VITE_LOCAL_PREVIEW_PASSWORD || '',
  };
}

export default function Login() {
  const localPreviewCredentials = getLocalPreviewCredentials();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState(localPreviewCredentials.identifier);
  const [password, setPassword] = useState(localPreviewCredentials.password);
  const [rememberLogin, setRememberLogin] = useState(false);
  const loginEdited = useRef(false);
  const demoPrefilled = useRef(false);
  const [confirmPwd, setConfirmPwd] = useState('');
  const [businessRole, setBusinessRole] = useState<'intern' | 'trust_manager'>('intern');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const navigate = useNavigate();
  const login = useAuthStore(s => s.login);
  const loginConflict = useAuthStore(s => s.loginConflict);
  const clearLoginConflict = useAuthStore(s => s.clearLoginConflict);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_LOGIN_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { identifier?: string; expiresAt?: number };
      if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) {
        window.localStorage.removeItem(REMEMBER_LOGIN_STORAGE_KEY);
        return;
      }
      setIdentifier(parsed.identifier || '');
      setRememberLogin(true);
    } catch {
      window.localStorage.removeItem(REMEMBER_LOGIN_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'login') return;
    let active = true;
    api.get<{ enabled: boolean; identifier?: string; password?: string }>('/demo-login').then(({ enabled, identifier, password }) => {
      if (!active || loginEdited.current || !enabled) return;
      demoPrefilled.current = true;
      setRememberLogin(false);
      setIdentifier(identifier ?? DEMO_IDENTIFIER);
      setPassword(password ?? DEMO_PASSWORD);
    }).catch(() => {});
    return () => { active = false; };
  }, [mode]);

  const switchMode = () => {
    if (mode === 'login' && demoPrefilled.current) {
      setIdentifier('');
      setPassword('');
      demoPrefilled.current = false;
    }
    loginEdited.current = false;
    setMode(m => m === 'login' ? 'register' : 'login');
    setError('');
    setSuccessMsg('');
  };

  const completeLogin = () => {
    if (rememberLogin) {
      window.localStorage.setItem(REMEMBER_LOGIN_STORAGE_KEY, JSON.stringify({
        identifier,
        expiresAt: Date.now() + REMEMBER_LOGIN_DAYS * 24 * 60 * 60 * 1000,
      }));
    } else {
      window.localStorage.removeItem(REMEMBER_LOGIN_STORAGE_KEY);
    }
    navigate('/dashboard');
  };

  const handleForceLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const success = await login(identifier, password, true);
      if (success) completeLogin();
    } catch {
      setError('登录失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    if (mode === 'login') {
      try {
        const success = await login(identifier, password);
        if (success) {
          completeLogin();
        } else {
          setError('编号/姓名或密码错误');
        }
      } catch (err: any) {
        if (err?.code === 'DEVICE_LIMIT_REACHED') {
          setError('');
        } else {
          setError('登录失败，请重试');
        }
      } finally {
        setIsLoading(false);
      }
    } else {
      if (!identifier.trim() || !password.trim()) {
        setError('请填写真实姓名和密码'); setIsLoading(false); return;
      }
      if (password.length < 6) {
        setError('密码至少 6 个字符'); setIsLoading(false); return;
      }
      if (password !== confirmPwd) {
        setError('两次输入的密码不一致'); setIsLoading(false); return;
      }
      try {
        await api.post('/auth/register-self', {
          display_name: identifier.trim(),
          password,
          business_role: businessRole,
        });
        setSuccessMsg('注册成功，等待高级用户审核通过后即可登录');
        setMode('login');
        setPassword('');
        setConfirmPwd('');
        setError('');
      } catch (err: any) {
        setError(err.message || '注册失败');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const inputClass = 'w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm outline-none transition-all placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20';
  const iconClass = 'absolute left-3 top-1/2 -translate-y-1/2 text-slate-400';
  const secondaryActionClass = 'text-sm font-medium text-primary-600 transition-colors hover:text-primary-700';
  const handleForgotPassword = () => {
    setError('');
    setSuccessMsg('请联系高级用户重置密码。');
  };
  return (
    <div className="login-page relative flex min-h-[100svh] items-start justify-center overflow-y-auto overflow-x-hidden bg-slate-50 px-5 pb-28 pt-24 text-slate-950 transition-colors duration-700 md:min-h-screen md:items-center md:overflow-hidden md:px-0 md:py-0">
      <TerrainContourBackground />
      <div className="login-side-panel pointer-events-none absolute inset-y-0 right-0 z-[1] hidden w-2/5 bg-white shadow-[-18px_0_60px_rgba(15,23,42,0.08)] md:block" />
      <div className="login-top-line absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-300 to-transparent" />

      <div className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-3 md:left-8 md:top-8 md:translate-x-0">
        <div className="login-brand flex h-11 items-center gap-2">
          <img src="/lianheng-mark.png" alt="" className="h-7 w-7 object-contain" /><span className="text-base font-semibold tracking-[0.05em] text-slate-900">联衡信托</span>
        </div>
      </div>

      <div className="relative z-10 grid w-full gap-8 px-0 py-0 md:min-h-screen md:grid-cols-5 md:gap-12 md:px-0 md:py-0">
        <div className="login-hero relative flex min-h-[210px] flex-col items-center justify-center text-center text-slate-950 md:col-span-3 md:min-h-screen">
          <div className="mx-auto flex w-full max-w-[520px] flex-col items-center text-center md:-translate-y-2">
          <h1 className="login-hero-title w-full text-center text-4xl font-semibold leading-tight tracking-normal text-slate-950 sm:text-5xl md:text-6xl">
            随时随地，
          </h1>
          <p className="login-hero-subtitle mt-3 w-full text-center text-2xl font-medium leading-tight text-slate-950 sm:text-3xl md:mt-6 md:text-4xl">访问全球资本运营部。</p>
          <div className="login-mode-switcher mt-6 w-full text-center text-sm leading-7 text-slate-600 md:mt-10">
            <p>{mode === 'login' ? '还没有账号？' : '已经有账号？'}</p>
            <p>
              你可以
              <button type="button" onClick={switchMode} className="ml-2 font-semibold text-primary-600 transition-colors hover:text-primary-700">
                {mode === 'login' ? '在这里注册账号' : '返回登录'}
              </button>
            </p>
          </div>
          <h1 className="hidden">
            全球资本运营部
          </h1>
          <p className="hidden">
            {mode === 'login' ? '请登录以继续' : '创建新账号'}
          </p>
          </div>
        </div>

        <div className="login-panel-form flex h-fit w-full max-w-[360px] self-center justify-self-center flex-col rounded-2xl border border-slate-200 bg-white px-5 py-6 text-slate-950 shadow-sm md:col-span-2 md:rounded-none md:border-0 md:bg-transparent md:px-6 md:py-8 md:shadow-none">
          <div className="mb-6 md:mb-8">
            <h2 className="login-panel-title text-2xl font-semibold tracking-normal text-slate-950 md:text-3xl">
              {mode === 'login' ? '登录到 GCO Link' : '注册 GCO Link 账户'}
            </h2>
            <h2 className="hidden">
              {mode === 'login' ? '登录' : '注册账号'}
            </h2>
            <p className="hidden">
              {mode === 'login' ? '使用 UID 或真实姓名继续。' : '填写真实姓名并设置密码。'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'register' && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'intern', label: '实习生', icon: GraduationCap },
                  { value: 'trust_manager', label: '信托经理', icon: BriefcaseBusiness },
                ].map(({ value, label, icon: Icon }) => {
                  const active = businessRole === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setBusinessRole(value as 'intern' | 'trust_manager')}
                      className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                        active
                          ? 'border-primary-600 bg-primary-600 text-primary-contrast shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div>
              <label className="sr-only">
                {mode === 'login' ? '账号编号 / 真实姓名' : '真实姓名'}
              </label>
              <div className="relative">
                <User className={iconClass} size={18} />
                <input
                  type="text"
                  value={identifier}
                  onChange={event => { loginEdited.current = true; setIdentifier(event.target.value); }}
                  className={inputClass}
                  aria-label={mode === 'login' ? '账号编号 / 真实姓名' : '真实姓名'}
                  placeholder={mode === 'login' ? '输入编号或真实姓名' : '您的真实姓名'}
                  autoComplete={mode === 'login' ? 'username' : 'off'}
                />
              </div>
            </div>

            <div>
              <label className="sr-only">密码</label>
              <div className="relative">
                <Lock className={iconClass} size={18} />
                <input type="password" value={password} onChange={e => { loginEdited.current = true; setPassword(e.target.value); }}
                  className={inputClass}
                  aria-label="密码"
                  placeholder={mode === 'login' ? '请输入密码' : '至少 6 位'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              </div>
            </div>

            {mode === 'login' && (
              <div className="flex flex-col items-start gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={e => setRememberLogin(e.target.checked)}
                    className="h-4 w-4 rounded border border-slate-300 text-primary-600 focus:ring-2 focus:ring-primary-500/20"
                  />
                  <span>保持登录状态（7天）</span>
                </label>
                <button type="button" onClick={handleForgotPassword} className={secondaryActionClass}>
                  忘记密码？
                </button>
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="sr-only">确认密码</label>
                <div className="relative">
                  <Lock className={iconClass} size={18} />
                  <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                    className={inputClass}
                    aria-label="确认密码"
                    placeholder="再次输入密码" autoComplete="new-password" />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">{error}</div>
            )}
            {successMsg && (
              <div className="rounded-lg border border-info-200 bg-info-50 p-3 text-sm text-info-700">{successMsg}</div>
            )}

            <button type="submit" disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 text-sm font-semibold text-primary-contrast shadow-sm transition-all hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {isLoading ? (
                <><Loader2 className="animate-spin" size={20} /><span>{mode === 'login' ? '登录中...' : '注册中...'}</span></>
              ) : (
                <span>{mode === 'login' ? '登录' : '注册'}</span>
              )}
            </button>
          </form>

          <div className="hidden">
            <button onClick={switchMode}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 transition-colors hover:text-primary-700">
              {mode === 'login' ? (
                <><UserPlus size={15} /> 没有账号？立即注册</>
              ) : (
                <><LogIn size={15} /> 已有账号？去登录</>
              )}
            </button>
          </div>

        </div>
      </div>
      {loginConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4">
          <div className="w-full max-w-sm border border-slate-200 bg-white p-5 shadow-xl">
            <div className="text-base font-semibold text-slate-950">
              {loginConflict.deviceType === 'mobile' ? '移动端已登录' : '桌面端已登录'}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-600">
              该账号已在 {loginConflict.deviceName || '另一台设备'} 登录。继续登录会使之前的{loginConflict.deviceType === 'mobile' ? '移动端' : '桌面端'}下线。
            </div>
            <div className="mt-4 border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
              <div>登录设备：{loginConflict.deviceName || '-'}</div>
              <div>登录时间：{loginConflict.loginAt ? new Date(loginConflict.loginAt).toLocaleString('zh-CN') : '-'}</div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={clearLoginConflict}
                className="h-10 border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleForceLogin}
                disabled={isLoading}
                className="inline-flex h-10 items-center justify-center bg-slate-950 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : '继续登录'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
