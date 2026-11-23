import { useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import AppModal from '../Layout/AppModal';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { _toast } from '../../store/toastRef';

export default function BirthdayPromptModal() {
  const user = useAuthStore(state => state.user);
  const refreshUser = useAuthStore(state => state.refreshUser);
  const [birthday, setBirthday] = useState('');
  const [saving, setSaving] = useState(false);
  const open = Boolean(user?.id && !user.birthday);
  const today = new Date().toISOString().slice(0, 10);

  const save = async () => {
    if (!birthday || saving) return;
    setSaving(true);
    try {
      await api.put('/auth/birthday', { birthday });
      await refreshUser();
      _toast.success?.('生日已保存');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '生日保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => undefined}
      closeOnOverlay={false}
      showClose={false}
      size="sm"
      title="补充生日信息"
      subtitle="完善个人资料后即可继续使用系统。"
      icon={<CalendarDays size={18} />}
      footer={<button type="button" onClick={() => void save()} disabled={!birthday || saving} className="app-button-primary h-10 w-full disabled:cursor-not-allowed disabled:opacity-40">{saving && <Loader2 size={15} className="animate-spin" />}保存并继续</button>}
    >
      <label className="block py-2">
        <span className="mb-2 block text-sm font-medium text-slate-700">生日</span>
        <input type="date" min="1900-01-01" max={today} value={birthday} onChange={event => setBirthday(event.target.value)} className="app-control h-11 w-full px-3 text-sm" autoFocus />
        <span className="mt-2 block text-xs text-slate-400">仅记录日期，可稍后在个人中心修改。</span>
      </label>
    </AppModal>
  );
}
