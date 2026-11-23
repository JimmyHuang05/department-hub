import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Check, CheckCheck, Clock3, ExternalLink, Inbox, MessageSquare, Pencil, Plus, RefreshCw, Search, Send, SquareCheck, Trash2, Users, Vote, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../components/Layout/Header';
import AppModal from '../components/Layout/AppModal';
import AppSelect from '../components/Form/AppSelect';
import UserProfileAvatar from '../components/UserProfileAvatar';
import { api } from '../lib/api';
import { _toast } from '../store/toastRef';
import { useConfirm } from '../components/Toast';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useMobileViewport } from '../hooks/useMobileViewport';

type MessageFilter = 'all' | 'unread' | 'sent';
type MobileMessageFilter = 'unread' | 'all' | 'mentions' | 'system';
type MessageType = 'manual' | 'task_created' | 'task_comment' | 'task_mention' | 'task_status';

interface NotificationItem {
  id: string;
  type: MessageType;
  title: string;
  content: string;
  senderId: string;
  senderName: string;
  direction: 'sent' | 'received';
  readAt: string | null;
  actionUrl: string;
  expiresAt: string | null;
  createdAt: string;
  recipientCount: number;
  readCount: number;
  poll: null | { options: string[]; counts: number[]; userVote: number | null };
}

interface DirectoryUser { id: string; display_name: string; hasEmail: boolean; }
interface MessageCounts { all: number; unread: number; sent: number; }

const filterLabels: Record<MessageFilter, string> = { all: '全部消息', unread: '未读', sent: '我发出的' };
const typeLabels: Record<MessageType, string> = { manual: '手动提醒', task_created: '新任务', task_comment: '任务回复', task_mention: '回复中提及你', task_status: '阶段变更' };

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function TypeIcon({ type }: { type: MessageType }) {
  if (type === 'task_comment' || type === 'task_mention') return <MessageSquare size={17} />;
  if (type === 'task_created' || type === 'task_status') return <SquareCheck size={17} />;
  return <Bell size={17} />;
}

export default function Messages() {
  const isMobileViewport = useMobileViewport();
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [counts, setCounts] = useState<MessageCounts>({ all: 0, unread: 0, sent: 0 });
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [mobileFilter, setMobileFilter] = useState<MobileMessageFilter>('unread');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<NotificationItem | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [componentType, setComponentType] = useState('none');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<{ notifications: NotificationItem[]; counts: MessageCounts }>(`/notifications?filter=${filter}`);
      setItems(result.notifications || []);
      setCounts(result.counts || { all: 0, unread: 0, sent: 0 });
      // A read receipt can trigger a realtime reload while the click that opened
      // the message is still settling. Keep the current selection when that
      // transient response does not contain the row; explicit filter changes,
      // close and delete actions remain responsible for clearing it.
      setSelected(current => current ? (result.notifications || []).find(item => item.id === current.id) || current : null);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '消息加载失败');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(['message', 'task'], load);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('ibd:notification-new', refresh);
    return () => window.removeEventListener('ibd:notification-new', refresh);
  }, [load]);
  useEffect(() => {
    api.get<{ users: DirectoryUser[] }>('/auth/directory').then(result => setDirectoryUsers(result.users || [])).catch(() => undefined);
  }, []);

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return items;
    return items.filter(item => [item.title, item.content, item.senderName, typeLabels[item.type]].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)));
  }, [items, search]);

  const mobileVisible = useMemo(() => {
    if (mobileFilter === 'all') return items;
    if (mobileFilter === 'mentions') return items.filter(item => item.type === 'task_mention');
    if (mobileFilter === 'system') return items.filter(item => item.type !== 'manual');
    return items.filter(item => item.direction === 'received' && !item.readAt);
  }, [items, mobileFilter]);

  const visibleRecipients = useMemo(() => {
    const keyword = recipientSearch.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return directoryUsers;
    return directoryUsers.filter(person => person.display_name.toLocaleLowerCase('zh-CN').includes(keyword));
  }, [directoryUsers, recipientSearch]);

  const markMessageRead = async (item: NotificationItem) => {
    try {
      const result = await api.put<{ readAt: string }>(`/notifications/${item.id}/read`, {});
      setItems(current => current.map(row => row.id === item.id ? { ...row, readAt: result.readAt } : row));
      setSelected(current => current?.id === item.id ? { ...current, readAt: result.readAt } : current);
      setCounts(current => ({ ...current, unread: Math.max(0, current.unread - 1) }));
    } catch { /* 阅读失败不阻断查看 */ }
  };

  const openMessage = (item: NotificationItem) => {
    setDetailClosing(false);
    setSelected(item);
    if (item.direction === 'received' && !item.readAt) {
      // Match the task-list interaction: commit selection first, then perform
      // secondary network work after the selected frame has painted.
      window.requestAnimationFrame(() => void markMessageRead(item));
    }
  };

  const closeMessage = () => {
    if (!selected || detailClosing) return;
    setDetailClosing(true);
    window.setTimeout(() => { setSelected(null); setDetailClosing(false); }, 180);
  };

  const deleteMessage = async (item: NotificationItem) => {
    const confirmed = await ask({ title: '删除消息', message: `确定要删除“${item.title}”吗？删除后仅从你的消息列表中移除，不影响其他接收人。`, confirmText: '删除', tone: 'danger' });
    if (!confirmed) return;
    try {
      await api.delete(`/notifications/${item.id}`);
      const index = visible.findIndex(row => row.id === item.id);
      const next = visible[index + 1] || visible[index - 1] || null;
      setSelected(current => current?.id === item.id ? next : current);
      await load();
      _toast.success?.('消息已删除');
    } catch (error) { _toast.error?.(error instanceof Error ? error.message : '删除失败'); }
  };

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.matches('input, textarea, select, button') || target.isContentEditable)) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const index = visible.findIndex(item => item.id === selected.id);
      if (index < 0) return;
      const nextIndex = event.key === 'ArrowDown' ? Math.min(visible.length - 1, index + 1) : Math.max(0, index - 1);
      if (nextIndex === index) return;
      event.preventDefault();
      void openMessage(visible[nextIndex]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, visible]);

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all', {});
      await load();
      _toast.success?.('已全部标记为已读');
    } catch (error) { _toast.error?.(error instanceof Error ? error.message : '操作失败'); }
  };

  const toggleRecipient = (id: string) => setRecipientIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);

  const createReminder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await api.post('/notifications', {
        title: form.get('title'), content: form.get('content'), recipientIds,
        componentType,
        pollOptions: String(form.get('pollOptions') || '').split('\n').map(value => value.trim()).filter(Boolean),
        expiresAt: form.get('expiresAt') || null,
      });
      setCreating(false); setRecipientIds([]); setRecipientSearch(''); setComponentType('none');
      setFilter('sent');
      if (filter === 'sent') await load();
      _toast.success?.('提醒已发送');
    } catch (error) { _toast.error?.(error instanceof Error ? error.message : '提醒发送失败'); }
    finally { setSaving(false); }
  };

  const vote = async (optionIndex: number) => {
    if (!selected) return;
    try {
      await api.post(`/notifications/${selected.id}/vote`, { optionIndex });
      await load();
      _toast.success?.('投票已提交');
    } catch (error) { _toast.error?.(error instanceof Error ? error.message : '投票失败'); }
  };

  return <div className="square-ui flex min-h-full flex-col gap-5 lg:h-full lg:overflow-hidden">
    {isMobileViewport ? <div className="mobile-slice-messages">
      <header className="mobile-slice-message-appbar">
        <span />
        <h1>协作</h1>
        <button type="button" onClick={() => setCreating(true)} aria-label="新建提醒"><Pencil size={19} /></button>
      </header>
      <div className="mobile-slice-message-segment-wrap">
        <nav className="mobile-collab-tabs" aria-label="协作内容类型">
          <Link to="/tasks" className="is-active">消息{counts.unread > 0 ? <b>{counts.unread}</b> : null}</Link>
          <Link to="/discussions">任务</Link>
        </nav>
      </div>
      <div className="mobile-message-chips">
        {([['unread', '未读'], ['all', '全部消息'], ['mentions', '@我的'], ['system', '系统提醒']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setMobileFilter(key)} className={mobileFilter === key ? 'is-active' : ''}>{label}</button>)}
      </div>
      <section className="mobile-slice-message-surface">
        {loading && !items.length ? <div className="mobile-slice-message-empty">消息加载中…</div> : mobileVisible.length === 0 ? <div className="mobile-slice-message-empty"><Inbox size={28} /><span>暂无消息</span></div> : mobileVisible.map(item => <article key={item.id} className="mobile-slice-message-row" onClick={() => openMessage(item)}>
          <span className={`mobile-slice-message-unread ${item.direction === 'received' && !item.readAt ? '' : 'is-hidden'}`} />
          <span className={`mobile-slice-message-icon is-${item.type}`}><TypeIcon type={item.type} /></span>
          <span className="mobile-slice-message-copy"><strong>{item.title}</strong><p>{item.content || '暂无内容'}</p><time>{formatDateTime(item.createdAt)}</time></span>
        </article>)}
      </section>
      <button type="button" onClick={() => setCreating(true)} className="mobile-collab-fab" aria-label="新建提醒"><Pencil size={21} /></button>
    </div> : <>
    <Header title="消息" subtitle="查看发给你的提醒和系统事件；任务协作仍在任务中心完成。">
      <button type="button" onClick={() => setCreating(true)} className="inline-flex h-10 items-center justify-center gap-2 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"><Plus size={16} />新建提醒</button>
    </Header>

    <div className="message-split-surface flex min-h-[560px] flex-1 flex-col overflow-hidden bg-white lg:min-h-0">
      <div className="app-content-toolbar shrink-0 border-b border-slate-200 p-3">
        <div className="flex h-full w-full min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 max-w-full flex-1 items-center overflow-x-auto overscroll-x-contain">{(Object.keys(filterLabels) as MessageFilter[]).map(key => <button key={key} type="button" onClick={() => { setFilter(key); setSelected(null); }} className={`relative inline-flex h-9 shrink-0 items-center gap-2 px-2 text-sm font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:content-[''] ${filter === key ? 'text-primary-600 after:bg-primary-600' : 'text-slate-500 after:bg-transparent hover:text-slate-900'}`}><span>{filterLabels[key]}</span><span className={`text-xs tabular-nums ${filter === key ? 'text-primary-600' : 'text-slate-400'}`}>{counts[key]}</span></button>)}</div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {counts.unread > 0 && <button type="button" onClick={() => void markAllRead()} className="hidden h-9 shrink-0 items-center gap-1.5 px-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-primary-700 md:inline-flex"><CheckCheck size={14} />全部标为已读</button>}
          <label className="relative min-w-0 flex-1 sm:max-w-xs"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标题、内容或发送人" className="h-10 w-full border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-primary-500" /></label>
          <button type="button" onClick={() => void load()} className="flex h-10 w-10 shrink-0 items-center justify-center border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="刷新"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>
      </div>
      <div className={`grid min-h-0 flex-1 overflow-hidden ${selected ? 'lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]' : 'grid-cols-1'}`}>
      <aside className={`${selected ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col ${selected ? 'border-r border-slate-200' : ''}`}>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {loading && !items.length ? <div className="py-20 text-center text-sm text-slate-400">消息加载中…</div> : !visible.length ? <div className="flex min-h-72 flex-col items-center justify-center text-center"><Inbox size={30} className="text-slate-300" /><div className="mt-3 text-sm font-medium text-slate-600">暂无消息</div></div> : visible.map(item => <article key={item.id} onClick={() => openMessage(item)} className={`group relative min-h-[92px] w-full cursor-pointer border-b border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50/70 ${selected?.id === item.id ? 'app-selected-border task-directory-item-active' : ''}`}>
            {item.direction === 'received' && !item.readAt && <span className="absolute right-5 top-5 h-1.5 w-1.5 bg-primary-600" />}
            <button type="button" onClick={event => { event.stopPropagation(); void deleteMessage(item); }} className="absolute bottom-2 right-3 z-10 flex h-7 w-7 items-center justify-center text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 group-focus-within:opacity-100" aria-label="删除消息"><Trash2 size={14} /></button>
            <div className="flex min-w-0 items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center border ${item.type === 'manual' ? 'border-primary-100 bg-primary-50 text-primary-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}><TypeIcon type={item.type} /></span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-baseline gap-3 pr-3"><strong className={`min-w-0 flex-1 truncate text-[14px] leading-5 ${item.direction === 'received' && !item.readAt ? 'font-semibold text-slate-950' : 'font-semibold text-slate-800'}`}>{item.title}</strong><time className="shrink-0 text-[11px] tabular-nums text-slate-400">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time></span><span className="mt-1 block truncate text-xs leading-4 text-slate-500">{item.content || '暂无内容'}</span><span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-slate-400"><span className="max-w-[120px] truncate text-slate-600">{item.direction === 'sent' ? '我发出的' : item.senderName}</span><span className="text-slate-300">·</span><span>{typeLabels[item.type]}</span>{item.poll && <><span className="text-slate-300">·</span><span className="inline-flex items-center gap-1 text-primary-600"><Vote size={10} />投票</span></>}</span></span></div>
          </article>)}
        </div>
      </aside>

      {selected && <main className={`task-detail-pane min-h-0 overflow-y-auto bg-white ${detailClosing ? 'task-detail-panel-out' : 'task-detail-panel-in'}`}>
        <article className="mx-auto w-full max-w-4xl p-6 lg:p-8">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
            <div className="flex min-w-0 gap-3"><UserProfileAvatar userId={selected.senderId} displayName={selected.senderName || '系统'} className="h-10 w-10 text-xs" /><div className="min-w-0"><h2 className="break-words text-lg font-semibold leading-7 text-slate-900">{selected.title}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span className="text-slate-600">{selected.direction === 'sent' ? '我发出的提醒' : `${selected.senderName} 发给你`}</span><span>·</span><span>{typeLabels[selected.type]}</span><span>·</span><time>{formatDateTime(selected.createdAt)}</time></div></div></div>
            <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => void deleteMessage(selected)} className="flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="删除消息"><Trash2 size={16} /></button><button type="button" onClick={closeMessage} className="flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭消息"><X size={17} /></button></div>
          </header>
          <div className="py-6 whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-700">{selected.content}</div>
          {selected.expiresAt && <div className="mb-5 inline-flex items-center gap-2 bg-slate-50 px-3 py-2 text-xs text-slate-600"><Clock3 size={14} />截止时间：{formatDateTime(selected.expiresAt)}</div>}
          {selected.poll && <section className="mb-6 border-t border-slate-200 pt-5"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Vote size={16} />投票</div><div className="space-y-2">{selected.poll.options.map((option, index) => { const count = selected.poll?.counts[index] || 0; const checked = selected.poll?.userVote === index; const total = selected.poll?.counts.reduce((sum, value) => sum + (value || 0), 0) || 0; return <button key={option} type="button" disabled={selected.direction === 'sent'} onClick={() => void vote(index)} className={`relative flex w-full items-center gap-3 overflow-hidden border px-4 py-3 text-left text-sm ${checked ? 'border-primary-500 text-primary-700' : 'border-slate-200 text-slate-700 hover:border-primary-300'} disabled:cursor-default`}><span className="absolute inset-y-0 left-0 bg-primary-50" style={{ width: `${total ? (count / total) * 100 : 0}%` }} /><span className={`relative flex h-4 w-4 items-center justify-center border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check size={11} />}</span><span className="relative min-w-0 flex-1">{option}</span><span className="relative text-xs tabular-nums text-slate-400">{count} 票</span></button>; })}</div></section>}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5"><div className="text-xs text-slate-400">{selected.direction === 'sent' ? `已发送 ${selected.recipientCount} 人 · ${selected.readCount} 人已读` : selected.readAt ? `已读于 ${formatDateTime(selected.readAt)}` : '未读'}</div>{selected.actionUrl && <button type="button" onClick={() => navigate(selected.actionUrl)} className="inline-flex h-9 items-center gap-2 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800"><ExternalLink size={14} />前往任务</button>}</footer>
        </article>
      </main>}
      </div>
    </div>
    </>}

    {ConfirmDialog}
    <AppModal open={creating} onClose={() => setCreating(false)} title="新建提醒" subtitle="把需要知晓的信息，准确地送达给相关人员" icon={<Bell size={19} />} size="xl" bodyClassName="p-0" panelClassName="border-t-4 border-t-primary-700" footer={<div className="flex w-full items-center justify-between gap-4"><div className="hidden text-xs text-slate-400 sm:block">提醒只用于通知；需要协作和持续讨论时，请创建任务。</div><div className="ml-auto flex gap-2"><button type="button" onClick={() => setCreating(false)} className="h-10 border border-slate-300 bg-white px-5 text-sm text-slate-700 hover:bg-slate-50">取消</button><button type="submit" form="create-reminder-form" disabled={saving || recipientIds.length === 0} className="inline-flex h-10 items-center gap-2 bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-slate-300"><Send size={14} />{saving ? '发送中…' : `发送提醒${recipientIds.length ? ` · ${recipientIds.length}人` : ''}`}</button></div></div>}>
      <form id="create-reminder-form" onSubmit={createReminder} className="grid min-h-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
        <section className="min-w-0 border-b border-slate-200 p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <div className="mb-5 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center bg-primary-700 text-xs font-semibold text-white">01</span><div><h3 className="text-sm font-semibold text-slate-900">提醒内容</h3><p className="mt-0.5 text-xs text-slate-400">标题用于快速识别，正文补充必要背景和行动信息</p></div></div>
          <div className="border border-slate-200 bg-white focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-100">
            <input name="title" required autoFocus maxLength={200} placeholder="输入提醒标题" className="reminder-composer-title h-14 w-full px-4 text-base font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400" />
            <textarea name="content" required maxLength={4000} placeholder="说明需要对方知晓的事项、背景或注意内容……" className="reminder-composer-body min-h-52 w-full resize-y p-4 text-sm leading-7 text-slate-700 placeholder:text-slate-400" />
          </div>
          {componentType === 'poll' && <div className="mt-5 border border-primary-200 bg-primary-50/40 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary-800"><Vote size={16} />投票选项</div><textarea name="pollOptions" required placeholder={'每行填写一个选项\n例如：同意\n不同意'} className="min-h-28 w-full resize-y border border-primary-200 bg-white p-3 text-sm leading-6 outline-none focus:border-primary-500" /><p className="mt-2 text-xs text-slate-500">每行生成一个选项，接收人可在消息详情中投票。</p></div>}
        </section>

        <aside className="min-w-0 bg-slate-50/70 p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center border border-slate-300 bg-white text-xs font-semibold text-slate-600">02</span><h3 className="text-sm font-semibold text-slate-900">接收对象</h3></div><span className={`text-xs ${recipientIds.length ? 'text-primary-700' : 'text-slate-400'}`}>已选 {recipientIds.length} 人</span></div>
          <label className="relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={recipientSearch} onChange={event => setRecipientSearch(event.target.value)} placeholder="搜索姓名" className="h-10 w-full border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary-500" /></label>
          <div className="mt-2 max-h-52 overflow-y-auto border border-slate-200 bg-white">{visibleRecipients.length ? visibleRecipients.map(person => { const checked = recipientIds.includes(person.id); return <button key={person.id} type="button" onClick={() => toggleRecipient(person.id)} className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 ${checked ? 'bg-primary-50' : 'hover:bg-slate-50'}`}><UserProfileAvatar userId={person.id} displayName={person.display_name} className="h-8 w-8 shrink-0 text-[10px]" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{person.display_name}</span><span className="block text-[10px] text-slate-400">{person.hasEmail ? '站内消息 · 邮箱已配置' : '站内消息'}</span></span><span className={`flex h-5 w-5 shrink-0 items-center justify-center border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check size={13} />}</span></button>; }) : <div className="flex h-24 flex-col items-center justify-center text-xs text-slate-400"><Users size={20} className="mb-2 text-slate-300" />没有匹配的人员</div>}</div>

          <div className="mb-4 mt-6 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center border border-slate-300 bg-white text-xs font-semibold text-slate-600">03</span><h3 className="text-sm font-semibold text-slate-900">附加设置</h3></div>
          <div className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">互动组件 <span className="font-normal text-slate-400">（可选）</span></span><AppSelect value={componentType} options={[{ value: 'none', label: '不添加组件' }, { value: 'poll', label: '添加投票' }]} onChange={setComponentType} size="md" className="w-full" triggerClassName="h-10 bg-white text-sm" /></label><label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">截止时间 <span className="font-normal text-slate-400">（可选）</span></span><input name="expiresAt" type="datetime-local" className="h-10 w-full border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary-500" /><span className="mt-1.5 block text-[11px] leading-4 text-slate-400">用于标记信息的有效期限，不会自动创建待办。</span></label></div>
        </aside>
      </form>
    </AppModal>
  </div>;
}
