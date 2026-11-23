import { useNavigate } from 'react-router-dom';
import { MonitorSmartphone } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

function deviceTypeLabel(type?: string) {
  if (type === 'mobile') return '移动端';
  return '桌面端';
}

export default function ForcedLogoutModal() {
  const navigate = useNavigate();
  const info = useAuthStore(s => s.forcedLogoutInfo);
  const clearForcedLogout = useAuthStore(s => s.clearForcedLogout);

  if (!info) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 px-4">
      <div className="w-full max-w-sm border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-slate-950 text-white">
            <MonitorSmartphone size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-950">账号已在另一台设备登录</div>
            <div className="mt-1 text-sm leading-6 text-slate-600">
              {info.message || '为了保证账号安全，本设备已自动下线。'}
            </div>
          </div>
        </div>

        <div className="mt-4 border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-6 text-slate-500">
          <div>登录设备：{info.deviceName || '-'}</div>
          <div>设备类型：{deviceTypeLabel(info.deviceType)}</div>
          <div>登录时间：{info.loginAt ? new Date(info.loginAt).toLocaleString('zh-CN') : '-'}</div>
        </div>

        <button
          type="button"
          onClick={() => {
            clearForcedLogout();
            navigate('/login', { replace: true });
          }}
          className="mt-5 h-10 w-full bg-slate-950 text-sm font-medium text-white hover:bg-slate-800"
        >
          重新登录
        </button>
      </div>
    </div>
  );
}
