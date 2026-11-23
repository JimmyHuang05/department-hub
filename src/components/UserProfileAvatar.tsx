import { useEffect, useState, type CSSProperties } from 'react';
import { Maximize2 } from 'lucide-react';
import AppModal from './Layout/AppModal';
import { api } from '../lib/api';
import { getAvatarInitial, getAvatarUrl } from '../utils/avatar';

interface PublicUserProfile {
  id: string;
  display_name: string;
  role?: string;
  business_role?: string;
  status?: string;
}

const roleLabel: Record<string, string> = { admin: '高级用户', user: '普通用户' };
const businessRoleLabel: Record<string, string> = { intern: '实习生', trust_manager: '信托经理', developer: '开发人员', admin: '管理员' };
const statusLabel: Record<string, string> = { active: '活跃', disabled: '已禁用', pending: '待激活' };

export default function UserProfileAvatar({
  userId,
  displayName,
  className = 'h-9 w-9',
  style,
}: {
  userId: string;
  displayName: string;
  className?: string;
  style?: CSSProperties;
}) {
  const identity = { userId, displayName };
  const [src, setSrc] = useState(() => getAvatarUrl(identity));
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);

  useEffect(() => setSrc(getAvatarUrl(identity)), [userId, displayName]);

  const showProfile = () => {
    setOpen(true);
    setProfile(null);
    void api.get<{ user: PublicUserProfile }>(`/auth/directory/${encodeURIComponent(userId)}`)
      .then(result => setProfile(result.user))
      .catch(() => setProfile({ id: userId, display_name: displayName }));
  };

  const avatar = (large = false) => (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden bg-primary-600 font-semibold text-white ${large ? 'h-24 w-24 text-3xl' : className}`} style={large ? undefined : style}>
      {src ? <img src={src} alt={displayName} className="h-full w-full object-cover" onError={() => setSrc('')} /> : getAvatarInitial(identity)}
    </div>
  );

  return <>
    <button type="button" onClick={showProfile} className="shrink-0" title={`查看${displayName}的资料`} aria-label={`查看${displayName}的资料`}>
      {avatar()}
    </button>
    <AppModal open={open} onClose={() => setOpen(false)} title="用户信息" size="sm">
      <div className="flex flex-col items-center px-2 py-3 text-center">
        <button type="button" onClick={() => src && setZoomed(true)} className="group relative" disabled={!src} title={src ? '点击放大头像' : undefined}>
          {avatar(true)}
          {src && <span className="absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center bg-slate-950/70 text-white opacity-0 transition-opacity group-hover:opacity-100"><Maximize2 size={14} /></span>}
        </button>
        <h2 className="mt-4 text-lg font-semibold text-slate-950">{profile?.display_name || displayName || userId}</h2>
        <p className="mt-1 text-xs text-slate-400">{profile?.id || userId}</p>
        <dl className="mt-5 w-full divide-y divide-slate-100 border-y border-slate-100 text-sm">
          <div className="flex justify-between gap-4 py-3"><dt className="text-slate-400">系统角色</dt><dd className="text-slate-800">{roleLabel[profile?.role || ''] || profile?.role || '-'}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-slate-400">业务角色</dt><dd className="text-slate-800">{businessRoleLabel[profile?.business_role || ''] || profile?.business_role || '-'}</dd></div>
          <div className="flex justify-between gap-4 py-3"><dt className="text-slate-400">账号状态</dt><dd className="text-slate-800">{statusLabel[profile?.status || ''] || profile?.status || '-'}</dd></div>
        </dl>
      </div>
    </AppModal>
    <AppModal
      open={zoomed}
      onClose={() => setZoomed(false)}
      title="头像预览"
      subtitle={profile?.display_name || displayName}
      size="md"
      bodyClassName="bg-slate-50 p-0"
      panelClassName="overflow-hidden"
    >
      <div className="flex min-h-[420px] items-center justify-center bg-slate-50 px-8 py-8 sm:min-h-[520px]">
        {src && (
          <div className="flex max-h-[68vh] max-w-full items-center justify-center border border-slate-200 bg-white p-3 shadow-sm">
            <img src={src} alt={displayName} className="max-h-[calc(68vh-24px)] max-w-full object-contain" />
          </div>
        )}
      </div>
    </AppModal>
  </>;
}
