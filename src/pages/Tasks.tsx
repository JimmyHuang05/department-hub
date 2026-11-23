import { FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, Check, ChevronDown, ChevronLeft, ChevronUp, Clock3, GripHorizontal, ListTodo, MessageSquare,
  Download, FileText, Filter, MoreHorizontal, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Trash2, UserRound, X,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/Layout/Header';
import AppModal from '../components/Layout/AppModal';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import ListCardShell from '../components/Layout/ListCardShell';
import UserProfileAvatar from '../components/UserProfileAvatar';
import AppSelect from '../components/Form/AppSelect';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useProjectStore } from '../store/projectStore';
import { _toast } from '../store/toastRef';
import { generateId } from '../utils/id';
import { readPageSnapshot, restoreElementScroll, writePageSnapshot } from '../utils/pageSnapshot';
import { useConfirm } from '../components/Toast';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useRealtimeConflictGuard } from '../hooks/useRealtimeConflictGuard';
import RealtimeConflictBanner from '../components/RealtimeConflictBanner';
import { useMobileViewport } from '../hooks/useMobileViewport';

type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
type Priority = 'low' | 'normal' | 'high' | 'urgent';
type TaskFilter = 'active' | 'done' | 'all';
type ScopeFilter = 'all' | 'created' | 'collaborated';
type MobileMessageFilter = 'unread' | 'all' | 'mentions' | 'system';
type MobileTaskFilter = 'pending' | 'assigned' | 'created';
type OwnershipType = 'self_developed' | 'business_center';
type BusinessRegion = 'east' | 'central' | 'west' | 'north' | 'south';

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  remark?: string;
  ownershipType: OwnershipType;
  businessRegion?: BusinessRegion | '';
  projectId?: string;
  projectName?: string;
  assignedToId: string;
  assignedToName?: string;
  createdById: string;
  createdByName?: string;
  status: TaskStatus;
  priority: Priority;
  recipientIds?: string[];
  recipientNames?: string[];
  dueAt?: string;
  sourceType?: string;
  itemType?: 'task' | 'reminder';
  commentCount?: number;
  recommendation?: TaskRecommendation | '';
  createdAt: string;
  updatedAt: string;
  attachments?: TaskAttachment[];
}

type TaskRecommendation = '推荐' | '中性偏推荐' | '中性' | '中性偏谨慎' | '谨慎';

interface TaskAttachment { id: string; fileName: string; fileSize: number; mimeType?: string; uploadedAt: string; }

interface TaskComment {
  id: string;
  userId: string;
  userName: string;
  content: string;
  mentionIds?: string[];
  mentionNames?: string[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

interface DirectoryUser { id: string; display_name: string; hasEmail: boolean; }

interface TaskPageSnapshot {
  filter: TaskFilter;
  scope: ScopeFilter;
  recommendations?: TaskRecommendation[];
  ownershipFilters?: string[];
  search: string;
  selectedTaskId: string | null;
  commentDrafts: Record<string, string>;
  creating: boolean;
  ownershipType: OwnershipType;
  selectedRecipientIds: string[];
  createDraft: Record<string, string>;
  listScrollTop: number;
  detailInfoScrollTop: number;
  commentsScrollTop: number;
}

const statusLabels: Record<TaskStatus, string> = {
  todo: '待处理', in_progress: '进行中', waiting: '等待反馈', done: '已完成', cancelled: '已取消',
};
const filterLabels: Record<TaskFilter, string> = { active: '待处理', done: '已完成', all: '全部状态' };
const scopeLabels: Record<ScopeFilter, string> = { all: '所有任务', created: '我创建的', collaborated: '我协作的' };
const regionLabels: Record<BusinessRegion, string> = { east: '华东', central: '华中', west: '西部', north: '北方', south: '南方' };
const recommendationOptions: TaskRecommendation[] = ['推荐', '中性偏推荐', '中性', '中性偏谨慎', '谨慎'];
const ownershipFilterOptions = [
  { value: 'self_developed', label: '自主开发' },
  ...(Object.keys(regionLabels) as BusinessRegion[]).map(region => ({ value: `business_center:${region}`, label: `${regionLabels[region]}业务中心` })),
];

const taskRecommendationTone: Record<TaskRecommendation, string> = {
  推荐: 'bg-emerald-50 text-emerald-700',
  中性偏推荐: 'bg-emerald-50 text-emerald-700',
  中性: 'bg-amber-50 text-amber-700',
  中性偏谨慎: 'bg-amber-50 text-amber-700',
  谨慎: 'bg-red-50 text-red-700',
};

function extractTaskRecommendation(content: string): TaskRecommendation | '' {
  const match = content.match(/【\s*(中性偏推荐|中性偏谨慎|推荐|中性|谨慎)(?=\s*[，,、；;：:]|\s*】)/);
  return (match?.[1] as TaskRecommendation | undefined) || '';
}

function taskDueEndTime(value?: string) {
  const date = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!date) return NaN;
  return Date.parse(`${date[1]}-${date[2]}-${date[3]}T23:59:59.999+08:00`);
}
const statusTone: Record<TaskStatus, string> = {
  todo: 'bg-slate-400', in_progress: 'bg-primary-600', waiting: 'bg-amber-500', done: 'bg-emerald-500', cancelled: 'bg-slate-300',
};
const statusSurface: Record<TaskStatus, string> = {
  todo: '!bg-slate-100 !text-slate-700 hover:!bg-slate-200',
  in_progress: '!bg-blue-50 !text-blue-700 hover:!bg-blue-100',
  waiting: '!bg-amber-50 !text-amber-700 hover:!bg-amber-100',
  done: '!bg-emerald-50 !text-emerald-700 hover:!bg-emerald-100',
  cancelled: '!bg-slate-100 !text-slate-500 hover:!bg-slate-200',
};

function TaskStatusSelect({ value, onChange, disabled, compact = false, topic = false }: {
  value: TaskStatus;
  onChange: (status: TaskStatus) => void;
  disabled?: boolean;
  compact?: boolean;
  topic?: boolean;
}) {
  const options = (Object.keys(statusLabels) as TaskStatus[]).map(status => ({
    value: status,
    label: <span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 ${statusTone[status]}`} />{statusLabels[status]}</span>,
    searchText: statusLabels[status],
  }));
  return <div className={`shrink-0 ${compact ? 'min-w-0 flex-1' : topic ? 'w-[92px]' : 'w-28'}`} onClick={event => event.stopPropagation()}>
    <AppSelect
      value={value}
      options={options}
      onChange={status => onChange(status as TaskStatus)}
      disabled={disabled}
      size="sm"
      leading={<span className={`h-1.5 w-1.5 ${statusTone[value]}`} />}
      triggerContent={statusLabels[value]}
      triggerClassName={topic ? `task-topic-status-trigger !h-7 !min-h-7 !border-0 px-2.5 !text-xs font-medium ${statusSurface[value]}` : 'h-9 !text-sm'}
      panelClassName="min-w-36"
    />
  </div>;
}

function TaskFormSelect({ name, value, options, onChange, placeholder = '请选择' }: {
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <>
    <input type="hidden" name={name} value={value} />
    <AppSelect value={value} options={options} onChange={onChange} placeholder={placeholder} size="md" className="w-full" triggerClassName="h-10 text-sm" />
  </>;
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatTaskDate(value?: string) {
  if (!value) return '无';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTaskDueLabel(value?: string) {
  if (!value) return '无截止日期';
  const due = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(due.getTime())) return value;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (days === 0) return '今天截止';
  if (days === 1) return '明天截止';
  if (days > 1 && days < 7) return `${dueDay.toLocaleDateString('zh-CN', { weekday: 'short' })}截止`;
  return `${dueDay.getMonth() + 1}月${dueDay.getDate()}日截止`;
}

function renderCommentContent(content: string, mentionNames: string[] = []) {
  const names = [...new Set(mentionNames.filter(Boolean))].sort((left, right) => right.length - left.length);
  if (!names.length) return content;
  const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = content.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return parts.map((part, index) => names.some(name => part === `@${name}`)
    ? <span key={`${part}-${index}`} className="font-medium text-primary-700">{part}</span>
    : part);
}

function ownershipLabel(task: TaskItem) {
  return task.ownershipType === 'business_center'
    ? (task.businessRegion ? `${regionLabels[task.businessRegion]}业务中心` : '未指定业务中心')
    : '自主开发';
}

interface TasksProps {
  mode?: 'messages' | 'tasks';
}

export default function Tasks({ mode = 'tasks' }: TasksProps) {
  const isMobileViewport = useMobileViewport();
  const { confirm: ask, ConfirmDialog } = useConfirm();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') || '';
  const requestedTaskId = params.get('taskId') || '';
  const requestedCommentId = params.get('commentId') || '';
  const products = useProjectStore(state => state.products);
  const user = useAuthStore(state => state.user);
  const isMessages = mode === 'messages';
  const itemLabel = isMessages ? '提醒' : '任务';
  const snapshotKey = `${mode}:${projectId || 'all'}`;
  const initialSnapshot = useMemo(() => readPageSnapshot<TaskPageSnapshot>(snapshotKey, user?.id), [snapshotKey, user?.id]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(Boolean(initialSnapshot.creating));
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>(initialSnapshot.selectedRecipientIds || []);
  const [ownershipType, setOwnershipType] = useState<OwnershipType>(initialSnapshot.ownershipType || 'self_developed');
  const [filter, setFilter] = useState<TaskFilter>(initialSnapshot.filter || 'active');
  const [mobileMessageFilter, setMobileMessageFilter] = useState<MobileMessageFilter>('unread');
  const [mobileTaskFilter, setMobileTaskFilter] = useState<MobileTaskFilter>('pending');
  const [scope, setScope] = useState<ScopeFilter>(() => {
    if (isMessages) return initialSnapshot.scope === 'created' ? 'created' : 'all';
    return initialSnapshot.scope === 'created' || initialSnapshot.scope === 'collaborated' ? initialSnapshot.scope : 'all';
  });
  const [recommendations, setRecommendations] = useState<TaskRecommendation[]>(initialSnapshot.recommendations || []);
  const [ownershipFilters, setOwnershipFilters] = useState<string[]>(initialSnapshot.ownershipFilters || []);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState(String(initialSnapshot.search || ''));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);
  const [editingTask, setEditingTask] = useState(false);
  const taskConflict = useRealtimeConflictGuard('task', selectedTask?.id, editingTask);
  const [editOwnershipType, setEditOwnershipType] = useState<OwnershipType>('self_developed');
  const [editRecipientIds, setEditRecipientIds] = useState<string[]>([]);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [editAttachments, setEditAttachments] = useState<File[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentInputHeight, setCommentInputHeight] = useState<number | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentMentionIds, setCommentMentionIds] = useState<string[]>([]);
  const [mentionState, setMentionState] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [highlightedCommentId, setHighlightedCommentId] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(initialSnapshot.commentDrafts || {});
  const [createDraft, setCreateDraft] = useState<Record<string, string>>(initialSnapshot.createDraft || {});
  const [createAttachments, setCreateAttachments] = useState<File[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const detailInfoScrollRef = useRef<HTMLElement>(null);
  const commentsScrollRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const restoredTaskRef = useRef(false);

  const mentionCandidates = useMemo(() => {
    if (!mentionState) return [];
    const keyword = mentionState.query.toLocaleLowerCase('zh-CN');
    return directoryUsers
      .filter(person => person.id !== user?.id && (!keyword || person.display_name.toLocaleLowerCase('zh-CN').includes(keyword)))
      .slice(0, 8);
  }, [directoryUsers, mentionState, user?.id]);

  useEffect(() => {
    if (mentionActiveIndex < mentionCandidates.length) return;
    setMentionActiveIndex(0);
  }, [mentionActiveIndex, mentionCandidates.length]);

  useEffect(() => {
    setCommentMentionIds([]);
    setMentionState(null);
  }, [selectedTask?.id]);

  useEffect(() => setCommentInputHeight(null), [selectedTask?.id]);

  useEffect(() => {
    const input = commentInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const naturalHeight = Math.min(144, Math.max(40, input.scrollHeight));
    const nextHeight = Math.min(320, Math.max(naturalHeight, commentInputHeight || 40));
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > nextHeight ? 'auto' : 'hidden';
  }, [commentInputHeight, commentText, selectedTask?.id]);

  const resizeCommentInput = (delta: number) => {
    const currentHeight = commentInputRef.current?.getBoundingClientRect().height || 40;
    setCommentInputHeight(Math.min(320, Math.max(40, currentHeight + delta)));
  };

  const startCommentResize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = commentInputRef.current?.getBoundingClientRect().height || 40;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    const move = (moveEvent: globalThis.MouseEvent) => {
      setCommentInputHeight(Math.min(320, Math.max(40, startHeight + startY - moveEvent.clientY)));
    };
    const end = () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  };

  const captureSnapshot = useCallback((): TaskPageSnapshot => ({
    filter, scope, search, selectedTaskId: selectedTask?.id || (!restoredTaskRef.current ? initialSnapshot.selectedTaskId || null : null), commentDrafts,
    creating, ownershipType, selectedRecipientIds, createDraft, recommendations, ownershipFilters,
    listScrollTop: listScrollRef.current?.scrollTop ?? Number(initialSnapshot.listScrollTop || 0),
    detailInfoScrollTop: detailInfoScrollRef.current?.scrollTop ?? Number(initialSnapshot.detailInfoScrollTop || 0),
    commentsScrollTop: commentsScrollRef.current?.scrollTop ?? Number(initialSnapshot.commentsScrollTop || 0),
  }), [commentDrafts, createDraft, creating, filter, initialSnapshot.commentsScrollTop, initialSnapshot.detailInfoScrollTop, initialSnapshot.listScrollTop, ownershipFilters, ownershipType, recommendations, scope, search, selectedRecipientIds, selectedTask?.id]);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFilterMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [filterMenuOpen]);

  useEffect(() => {
    writePageSnapshot(snapshotKey, user?.id, captureSnapshot());
  }, [captureSnapshot, snapshotKey, user?.id]);

  useEffect(() => () => writePageSnapshot(snapshotKey, user?.id, captureSnapshot()), [captureSnapshot, snapshotKey, user?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (projectId) query.set('projectId', projectId);
      query.set('type', isMessages ? 'reminder' : 'task');
      const result = await api.get<{ tasks: TaskItem[] }>(`/tasks${query.size ? `?${query}` : ''}`);
      setTasks(result.tasks || []);
      setSelectedTask(current => current ? (result.tasks || []).find(item => item.id === current.id) || current : null);
    } catch (error: unknown) {
      _toast.error?.(error instanceof Error ? error.message : '任务加载失败');
    } finally {
      setLoading(false);
    }
  }, [isMessages, projectId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeRefresh(['task'], load);
  useEffect(() => {
    api.get<{ users: DirectoryUser[] }>('/auth/directory')
      .then(result => setDirectoryUsers(result.users || []))
      .catch(error => _toast.error?.(error instanceof Error ? error.message : '人员列表加载失败'));
  }, []);

  const loadComments = useCallback(async (taskId: string) => {
    setCommentsLoading(true);
    try {
      const result = await api.get<{ comments: TaskComment[] }>(`/tasks/${taskId}/comments`);
      setComments(result.comments || []);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '留言加载失败');
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (restoredTaskRef.current || tasks.length === 0) return;
    restoredTaskRef.current = true;
    const task = tasks.find(item => item.id === requestedTaskId)
      || tasks.find(item => item.id === initialSnapshot.selectedTaskId);
    if (!task) return;
    setSelectedTask(task);
    setCommentText(commentDrafts[task.id] || '');
    void loadComments(task.id);
    window.requestAnimationFrame(() => {
      restoreElementScroll(detailInfoScrollRef.current, initialSnapshot.detailInfoScrollTop);
      restoreElementScroll(commentsScrollRef.current, initialSnapshot.commentsScrollTop);
    });
  }, [commentDrafts, initialSnapshot.commentsScrollTop, initialSnapshot.detailInfoScrollTop, initialSnapshot.selectedTaskId, loadComments, requestedTaskId, tasks]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => restoreElementScroll(listScrollRef.current, initialSnapshot.listScrollTop));
    return () => window.cancelAnimationFrame(frame);
  }, [initialSnapshot.listScrollTop]);

  const openTask = (task: TaskItem) => {
    setDetailClosing(false);
    setSelectedTask(task);
    setSummaryExpanded(false);
    setCommentText(commentDrafts[task.id] || '');
    void loadComments(task.id);
  };

  const closeTaskDetail = () => {
    if (isMessages) {
      setSelectedTask(null);
      return;
    }
    setDetailClosing(true);
    window.setTimeout(() => {
      setSelectedTask(null);
      setDetailClosing(false);
    }, 220);
  };

  useEffect(() => {
    if (!requestedCommentId || !selectedTask || commentsLoading || !comments.some(comment => comment.id === requestedCommentId)) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`task-comment-${requestedCommentId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightedCommentId(requestedCommentId);
    });
    const timer = window.setTimeout(() => setHighlightedCommentId(''), 2400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [comments, commentsLoading, requestedCommentId, selectedTask]);

  const updateMentionState = (value: string, caret: number) => {
    const beforeCaret = value.slice(0, caret);
    const match = beforeCaret.match(/(?:^|[\s，。！？、:：;；(（])@([^@\s，。！？、:：;；()（）]*)$/);
    if (!match) {
      setMentionState(null);
      return;
    }
    const query = match[1] || '';
    setMentionState({ start: caret - query.length - 1, end: caret, query });
    setMentionActiveIndex(0);
  };

  const insertMention = (person: DirectoryUser) => {
    if (!mentionState || !selectedTask) return;
    const inserted = `@${person.display_name} `;
    const next = `${commentText.slice(0, mentionState.start)}${inserted}${commentText.slice(mentionState.end)}`.slice(0, 2000);
    const nextCaret = Math.min(mentionState.start + inserted.length, next.length);
    setCommentText(next);
    setCommentDrafts(current => ({ ...current, [selectedTask.id]: next }));
    setCommentMentionIds(current => current.includes(person.id) ? current : [...current, person.id]);
    setMentionState(null);
    window.requestAnimationFrame(() => {
      commentInputRef.current?.focus();
      commentInputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const canEditSelectedTask = Boolean(selectedTask && user?.id && (
    selectedTask.createdById === user.id
    || selectedTask.assignedToId === user.id
    || selectedTask.recipientIds?.includes(user.id)
  ));

  const openEditTask = () => {
    if (!selectedTask || !canEditSelectedTask) return;
    setEditOwnershipType(selectedTask.ownershipType);
    setEditRecipientIds(selectedTask.recipientIds || []);
    setEditDraft({
      businessRegion: selectedTask.businessRegion || '',
      assignedToId: selectedTask.assignedToId || '',
      projectId: selectedTask.projectId || '',
    });
    setEditAttachments([]);
    setEditingTask(true);
  };

  const toggleEditRecipient = (id: string) => {
    setEditRecipientIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const openCreateModal = () => {
    setCreating(true);
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipientIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  const counts = useMemo(() => ({
    active: tasks.filter(task => !['done', 'cancelled'].includes(task.status)).length,
    done: tasks.filter(task => task.status === 'done').length,
    all: tasks.length,
  }), [tasks]);

  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN');
    return tasks.filter(task => {
      if (isMessages && filter !== 'all' && (filter === 'done' ? task.status !== 'done' : ['done', 'cancelled'].includes(task.status))) return false;
      if (scope === 'collaborated' && !task.recipientIds?.includes(user?.id || '')) return false;
      if (scope === 'created' && task.createdById !== user?.id) return false;
      if (recommendations.length > 0 && (!task.recommendation || !recommendations.includes(task.recommendation))) return false;
      if (ownershipFilters.length > 0) {
        const ownershipKey = task.ownershipType === 'business_center'
          ? `business_center:${task.businessRegion || ''}`
          : 'self_developed';
        if (!ownershipFilters.includes(ownershipKey)) return false;
      }
      if (keyword && ![task.title, task.description, task.remark, task.projectName, task.assignedToName, task.createdByName, ownershipLabel(task)].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword))) return false;
      return true;
    }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }, [filter, isMessages, ownershipFilters, recommendations, scope, search, tasks, user?.id]);

  const displayedVisible = useMemo(() => {
    if (!isMobileViewport) return visible;
    if (!isMessages) {
      if (mobileTaskFilter === 'assigned') return visible.filter(task => task.assignedToId === user?.id);
      if (mobileTaskFilter === 'created') return visible.filter(task => task.createdById === user?.id);
      return visible.filter(task => !['done', 'cancelled'].includes(task.status));
    }
    if (mobileMessageFilter === 'all') return tasks;
    if (mobileMessageFilter === 'mentions') return tasks.filter(task => task.recipientIds?.includes(user?.id || ''));
    if (mobileMessageFilter === 'system') return tasks.filter(task => task.sourceType && task.sourceType !== 'manual');
    return tasks.filter(task => !['done', 'cancelled'].includes(task.status));
  }, [isMessages, isMobileViewport, mobileMessageFilter, mobileTaskFilter, tasks, user?.id, visible]);

  useEffect(() => {
    if (isMessages || !selectedTask || creating || editingTask) return;
    const handleDirectoryKeys = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="listbox"]')) return;
      const currentIndex = visible.findIndex(task => task.id === selectedTask.id);
      if (currentIndex < 0) return;
      const nextIndex = Math.max(0, Math.min(visible.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      const nextTask = visible[nextIndex];
      if (!nextTask || nextTask.id === selectedTask.id) return;
      event.preventDefault();
      openTask(nextTask);
      window.requestAnimationFrame(() => {
        const item = Array.from(document.querySelectorAll<HTMLElement>('[data-task-directory-id]')).find(element => element.dataset.taskDirectoryId === nextTask.id);
        item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    };
    window.addEventListener('keydown', handleDirectoryKeys);
    return () => window.removeEventListener('keydown', handleDirectoryKeys);
  }, [creating, editingTask, isMessages, selectedTask, visible]);

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const linked = products.find(product => product.id === String(form.get('projectId') || ''));
    if (isMessages && selectedRecipientIds.length === 0) {
      _toast.error?.('请至少选择一位通知人员');
      return;
    }
    try {
      setCreatingTask(true);
      const componentType = String(form.get('componentType') || 'none');
      const pollOptions = String(form.get('pollOptions') || '').split('\n').map(item => item.trim()).filter(Boolean);
      if (isMessages && componentType === 'poll' && pollOptions.length < 2) {
        _toast.error?.('投票至少需要两个选项');
        return;
      }
      const created = await api.post<{ task: TaskItem }>('/tasks', { task: {
        id: generateId(), title: form.get('title'), description: form.get('description'), remark: form.get('remark'),
        ownershipType, businessRegion: ownershipType === 'business_center' ? form.get('businessRegion') : '',
        projectId: linked?.id || '', projectName: linked?.productName || '',
        assignedToId: user?.id, assignedToName: user?.display_name, status: 'todo', priority: form.get('priority') || 'normal',
        recipientIds: selectedRecipientIds, dueAt: form.get('dueAt') || '', sourceType: projectId ? 'project' : 'manual',
        itemType: isMessages ? 'reminder' : 'task',
        reminderComponent: isMessages && componentType === 'poll' ? { type: 'poll', options: pollOptions } : null,
      } } as never);
      if (!isMessages && createAttachments.length) {
        const attachmentForm = new FormData();
        createAttachments.forEach(file => attachmentForm.append('files', file));
        const token = localStorage.getItem('auth_token');
        const uploadResponse = await fetch(`/api/tasks/${created.task.id}/attachments`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: attachmentForm });
        if (!uploadResponse.ok) throw new Error((await uploadResponse.json().catch(() => ({}))).error || '任务已创建，但附件上传失败');
      }
      setCreating(false);
      setCreateDraft({});
      setSelectedRecipientIds([]);
      setOwnershipType('self_developed');
      setCreateAttachments([]);
      await load();
      _toast.success?.(`${itemLabel}已创建，全体成员均可查看`);
    } catch (error: unknown) {
      _toast.error?.(error instanceof Error ? error.message : `${itemLabel}创建失败`);
    } finally { setCreatingTask(false); }
  };

  const updateStatus = async (task: TaskItem, status: TaskStatus) => {
    setSavingId(task.id);
    try {
      const result = await api.put<{ task: TaskItem }>(`/tasks/${task.id}`, { task: { status } });
      const updated = result.task || { ...task, status };
      setTasks(current => current.map(item => item.id === task.id ? { ...item, ...updated } : item));
      setSelectedTask(current => current?.id === task.id ? { ...current, ...updated } : current);
    } catch (error: unknown) {
      _toast.error?.(error instanceof Error ? error.message : '任务状态更新失败');
    } finally {
      setSavingId(null);
    }
  };

  const saveTaskEdits = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTask || !canEditSelectedTask) return;
    const form = new FormData(event.currentTarget);
    const project = products.find(item => item.id === String(form.get('projectId') || ''));
    setSavingId(selectedTask.id);
    try {
      const result = await api.put<{ task: TaskItem }>(`/tasks/${selectedTask.id}`, { task: {
        title: form.get('title'), description: form.get('description'), remark: form.get('remark'),
        ownershipType: editOwnershipType,
        businessRegion: editOwnershipType === 'business_center' ? form.get('businessRegion') : '',
        projectId: project?.id || '', projectName: project?.productName || '',
        assignedToId: form.get('assignedToId'),
        dueAt: form.get('dueAt') || '', recipientIds: editRecipientIds,
      } });
      let updatedTask = result.task;
      if (editAttachments.length) {
        const attachmentForm = new FormData();
        editAttachments.forEach(file => attachmentForm.append('files', file));
        const token = localStorage.getItem('auth_token');
        const uploadResponse = await fetch(`/api/tasks/${selectedTask.id}/attachments`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: attachmentForm });
        if (!uploadResponse.ok) throw new Error((await uploadResponse.json().catch(() => ({}))).error || '任务信息已保存，但附件上传失败');
        const uploaded = await uploadResponse.json() as { attachments?: TaskAttachment[] };
        updatedTask = { ...updatedTask, attachments: [...(selectedTask.attachments || []), ...(uploaded.attachments || [])] };
      }
      setTasks(current => current.map(item => item.id === selectedTask.id ? { ...item, ...updatedTask } : item));
      setSelectedTask(updatedTask);
      setEditAttachments([]);
      setEditingTask(false);
      _toast.success?.('任务信息已更新');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '任务信息更新失败');
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (task: TaskItem) => {
    const confirmed = await ask({ title: `删除${itemLabel}`, message: `确定要删除“${task.title}”吗？删除后无法恢复。`, confirmText: '删除', tone: 'danger' });
    if (!confirmed) return;
    setSavingId(task.id);
    try {
      await api.delete(`/tasks/${task.id}`);
      setTasks(current => current.filter(item => item.id !== task.id));
      if (selectedTask?.id === task.id) setSelectedTask(null);
      _toast.success?.('任务已删除');
    } catch (error: unknown) {
      _toast.error?.(error instanceof Error ? error.message : '任务删除失败');
    } finally {
      setSavingId(null);
    }
  };

  const sendComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTask || !commentText.trim()) return;
    setCommentSaving(true);
    try {
      const result = await api.post<{ comment: TaskComment }>(`/tasks/${selectedTask.id}/comments`, { content: commentText.trim(), mentionIds: commentMentionIds });
      const recommendation = extractTaskRecommendation(result.comment.content);
      setComments(current => [...current, result.comment]);
      setTasks(current => current.map(item => item.id === selectedTask.id ? { ...item, commentCount: (item.commentCount || 0) + 1, recommendation: recommendation || item.recommendation } : item));
      setSelectedTask(current => current ? { ...current, commentCount: (current.commentCount || 0) + 1, recommendation: recommendation || current.recommendation } : current);
      setCommentText('');
      setCommentMentionIds([]);
      setMentionState(null);
      setCommentDrafts(current => ({ ...current, [selectedTask.id]: '' }));
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '留言发送失败');
    } finally {
      setCommentSaving(false);
    }
  };

  const deleteComment = async (comment: TaskComment) => {
    if (!selectedTask) return;
    const confirmed = await ask({ title: `删除${isMessages ? '留言' : '回复'}`, message: `确定要删除这条${isMessages ? '留言' : '回复'}吗？删除后无法恢复。`, confirmText: '删除', tone: 'danger' });
    if (!confirmed) return;
    try {
      await api.delete(`/tasks/${selectedTask.id}/comments/${comment.id}`);
      const recommendation = [...comments]
        .filter(item => item.id !== comment.id && !item.deleted)
        .reverse()
        .map(item => extractTaskRecommendation(item.content))
        .find(Boolean) || '';
      setComments(current => current.map(item => item.id === comment.id ? { ...item, content: '', deleted: true } : item));
      setTasks(current => current.map(item => item.id === selectedTask.id ? { ...item, commentCount: Math.max(0, (item.commentCount || 0) - 1), recommendation } : item));
      setSelectedTask(current => current ? { ...current, commentCount: Math.max(0, (current.commentCount || 0) - 1), recommendation } : current);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '留言删除失败');
    }
  };

  return (
    <div className={`app-task-center square-ui min-h-full gap-y-5 lg:h-full lg:overflow-hidden ${!isMessages && selectedTask ? 'task-workspace-open' : ''} ${isMessages || !selectedTask ? 'flex flex-col' : 'flex flex-col lg:grid lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-0'}`}>
      <div className={`${isMessages || !selectedTask ? '' : 'lg:col-span-2'} ${isMobileViewport && selectedTask && !editingTask && !isMessages ? 'hidden lg:block' : ''}`}>
      <Header
        title={isMobileViewport ? '协作' : isMessages ? '消息' : '任务'}
        info={<FeatureInfo label={`${isMessages ? '消息' : '任务'}功能说明`}>{isMessages ? '集中查看任务分派和协作过程产生的提醒。' : '创建并查看支持交流协作的任务。'}</FeatureInfo>}
        subtitle={isMessages ? '集中查看任务分派、协作进展和待处理提醒。' : '统一创建、跟踪任务，并在任务详情中开展交流协作。'}
      >
        {!creating && <button type="button" onClick={openCreateModal} className="mobile-collab-create inline-flex h-10 items-center justify-center gap-2 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800">{isMessages ? <Pencil size={16} /> : <Plus size={16} />}新建{itemLabel}</button>}
      </Header>
      </div>

      {!creating && <div className={`${selectedTask ? 'hidden lg:flex' : 'flex'} ${!isMessages && selectedTask ? 'task-directory-pane' : ''} min-h-0 flex-col ${isMessages || !selectedTask ? 'flex-1 overflow-hidden' : 'lg:col-start-1 lg:row-start-2 lg:overflow-hidden'}`}><ListCardShell id="task-center-list-shell" views={[]} metrics={[]} hideViews stickyWorkspace mergeToolbarWithContent contentClassName={isMessages ? 'px-4 pb-4 pt-0' : 'p-0'} toolbar={(
        <div className={`flex w-full flex-col gap-3 ${isMessages ? 'lg:flex-row lg:items-center' : ''}`}>
          <nav className="mobile-collab-tabs lg:hidden" aria-label="协作内容类型">
            <Link to="/tasks" className={isMessages ? 'is-active' : ''}>消息{isMessages && counts.active > 0 ? <b>{counts.active}</b> : null}</Link>
            <Link to="/discussions" className={!isMessages ? 'is-active' : ''}>任务{!isMessages && counts.active > 0 ? <b>{counts.active}</b> : null}</Link>
          </nav>
          {isMessages && <div className="mobile-message-chips lg:hidden">{([['unread', '未读'], ['all', '全部消息'], ['mentions', '@我的'], ['system', '系统提醒']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setMobileMessageFilter(key)} className={mobileMessageFilter === key ? 'is-active' : ''}>{label}</button>)}</div>}
          {isMessages && <div className="hidden min-w-0 flex-wrap items-center gap-1 lg:flex">{(Object.keys(filterLabels) as TaskFilter[]).map(key => <button key={key} type="button" onClick={() => setFilter(key)} className={`relative inline-flex h-9 items-center gap-2 px-2 text-sm font-medium after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 ${filter === key ? 'text-primary-600 after:bg-primary-600' : 'text-slate-500 after:bg-transparent hover:text-slate-900'}`}>{filterLabels[key]}<span className="text-xs tabular-nums text-slate-400">{counts[key]}</span></button>)}</div>}
          <div className={`min-w-0 flex-1 items-center gap-2 ${isMessages ? 'hidden flex-wrap lg:flex lg:justify-end' : 'flex flex-nowrap'}`}>
            {isMessages ? <AppSelect value={scope} options={(['all', 'created'] as ScopeFilter[]).map(key => ({ value: key, label: scopeLabels[key] }))} onChange={value => setScope(value as ScopeFilter)} size="md" className="w-32 shrink-0" triggerClassName="!h-10 !min-h-10 text-sm" /> : <div ref={filterMenuRef} className="relative w-32 shrink-0">
              <button type="button" onClick={() => setFilterMenuOpen(current => !current)} aria-expanded={filterMenuOpen} aria-label="筛选任务" className={`flex h-10 w-full items-center justify-between border px-3 text-sm ${filterMenuOpen || scope !== 'all' || recommendations.length || ownershipFilters.length ? 'border-primary-400 text-primary-700' : 'border-slate-200 text-slate-700 hover:border-slate-300'}`}>
                <span className="flex min-w-0 items-center gap-2"><Filter size={14} className="shrink-0" /><span className="truncate">筛选{recommendations.length + ownershipFilters.length > 0 ? ` · ${recommendations.length + ownershipFilters.length}` : ''}</span></span>
                <ChevronDown size={14} className={`shrink-0 transition-transform ${filterMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {filterMenuOpen && <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-72 border border-slate-200 bg-white py-2 shadow-[0_16px_36px_rgba(15,23,42,.14)]">
                <div className="px-3 pb-2 pt-1 text-[11px] font-medium text-slate-400">任务范围</div>
                {(['all', 'created', 'collaborated'] as ScopeFilter[]).map(key => <button key={key} type="button" onClick={() => setScope(key)} className={`flex h-9 w-full items-center justify-between px-3 text-left text-sm ${scope === key ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-700 hover:bg-slate-50'}`}><span>{scopeLabels[key]}</span>{scope === key && <Check size={15} />}</button>)}
                <div className="mx-3 my-2 border-t border-slate-100" />
                <div className="px-3 pb-1 text-[11px] font-medium text-slate-400">判断标签 · 可多选</div>
                <div className="grid grid-cols-2 gap-1 px-2 py-1">{recommendationOptions.map(value => { const checked = recommendations.includes(value); return <button key={value} type="button" onClick={() => setRecommendations(current => checked ? current.filter(item => item !== value) : [...current, value])} className={`flex h-8 items-center gap-2 px-2 text-left text-xs ${checked ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-600 hover:bg-slate-50'}`}><span className={`flex h-4 w-4 shrink-0 items-center justify-center border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 text-transparent'}`}><Check size={11} /></span><span className="truncate">{value}</span></button>; })}</div>
                <div className="mx-3 my-2 border-t border-slate-100" />
                <div className="px-3 pb-1 text-[11px] font-medium text-slate-400">任务归属 · 可多选</div>
                <div className="max-h-52 overflow-y-auto px-2 py-1">{ownershipFilterOptions.map(option => { const checked = ownershipFilters.includes(option.value); return <button key={option.value} type="button" onClick={() => setOwnershipFilters(current => checked ? current.filter(item => item !== option.value) : [...current, option.value])} className={`flex h-8 w-full items-center gap-2 px-2 text-left text-xs ${checked ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-600 hover:bg-slate-50'}`}><span className={`flex h-4 w-4 shrink-0 items-center justify-center border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 text-transparent'}`}><Check size={11} /></span>{option.label}</button>; })}</div>
                {(scope !== 'all' || recommendations.length > 0 || ownershipFilters.length > 0) && <div className="mt-2 border-t border-slate-100 px-3 pt-2"><button type="button" onClick={() => { setScope('all'); setRecommendations([]); setOwnershipFilters([]); }} className="h-8 w-full text-xs text-slate-500 hover:bg-slate-50 hover:text-primary-700">清除全部筛选</button></div>}
              </div>}
            </div>}
            <label className={`relative flex-1 lg:max-w-xs ${isMessages ? 'min-w-48' : 'min-w-0'}`}><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索任务、项目或负责人" className="h-10 w-full border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-primary-500" /></label>
            <button type="button" onClick={() => void load()} disabled={loading} className="flex h-10 w-10 items-center justify-center border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="刷新任务"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          </div>
          {!isMessages && <div className="mobile-collab-chips lg:hidden" aria-label="任务范围筛选">
            <button type="button" onClick={() => setMobileTaskFilter('pending')} className={mobileTaskFilter === 'pending' ? 'is-active' : ''}>待处理 <span>{tasks.filter(task => !['done', 'cancelled'].includes(task.status)).length}</span></button>
            <button type="button" onClick={() => setMobileTaskFilter('assigned')} className={mobileTaskFilter === 'assigned' ? 'is-active' : ''}>我负责的</button>
            <button type="button" onClick={() => setMobileTaskFilter('created')} className={mobileTaskFilter === 'created' ? 'is-active' : ''}>我创建的</button>
          </div>}
        </div>
      )}>
        <div ref={listScrollRef} className={`task-directory-scroll-hidden min-h-0 flex-1 overflow-y-auto bg-white ${!isMessages && selectedTask ? 'task-directory-list' : ''} ${isMessages ? 'pt-3' : 'pt-1.5'}`}>
          {loading && tasks.length === 0 ? <div className="py-20 text-center text-sm text-slate-400">任务加载中…</div> : displayedVisible.length === 0 ? <div className="flex min-h-[360px] flex-col items-center justify-center text-center"><ListTodo size={34} className="text-slate-300" /><div className="mt-4 text-sm font-semibold text-slate-800">没有符合条件的任务</div><div className="mt-1 text-xs text-slate-500">调整筛选条件，或创建一项新任务。</div></div> : <div className={isMessages ? 'space-y-1.5' : 'space-y-0'}>{displayedVisible.map(task => {
            const done = isMessages && task.status === 'done';
            const overdue = Boolean(task.dueAt && taskDueEndTime(task.dueAt) < Date.now());
            const canEdit = Boolean(user?.id && (task.createdById === user.id || task.assignedToId === user.id || task.recipientIds?.includes(user.id)));
            return <article key={task.id} data-task-directory-id={task.id} onClick={() => openTask(task)} className={`group relative cursor-pointer bg-white transition-colors ${!isMessages ? 'task-directory-item' : isMobileViewport ? 'mobile-message-item' : ''} ${isMessages ? `border border-slate-200 hover:border-slate-300 ${selectedTask?.id === task.id ? 'app-selected-border task-directory-item-active' : ''}` : `border-b border-slate-200 hover:bg-slate-50/70 ${selectedTask?.id === task.id ? 'app-selected-border task-directory-item-active' : ''}`}`}>
              <div className={`min-w-0 ${isMessages ? 'p-3' : 'px-4 py-4'}`}>
                {isMessages && isMobileViewport ? <div className="mobile-slice-notification">
                  {!done && <span className="mobile-slice-notification__unread" />}
                  <UserProfileAvatar userId={task.createdById} displayName={task.createdByName || '系统'} className="mobile-slice-notification__icon" />
                  <div className="mobile-slice-notification__copy"><strong>{task.createdByName || '项目助手'}</strong><p>{task.title}{task.description ? `：${task.description}` : ''}</p><time>{formatDateTime(task.updatedAt)}</time></div>
                </div> : isMessages ? <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className={`min-w-0 truncate text-base font-semibold ${done ? 'text-slate-600' : 'text-slate-900 group-hover:text-primary-700'}`}>{task.title}</h3>
                      <span className="shrink-0 border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">{ownershipLabel(task)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-1 text-xs leading-6 text-slate-500">{task.description || task.remark || '暂无任务说明'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2" onClick={event => event.stopPropagation()}><TaskStatusSelect value={task.status} onChange={status => void updateStatus(task, status)} disabled={savingId === task.id || !canEdit} />{(user?.role === 'admin' || task.createdById === user?.id) && <button type="button" onClick={() => void remove(task)} className="flex h-9 w-9 items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`删除${task.title}`}><Trash2 size={15} /></button>}</div>
                </div> : isMobileViewport ? <div className="mobile-slice-task-card">
                  <div className="mobile-slice-task-card__top">
                    <span className="mobile-slice-task-card__check" />
                    <h3>{task.title}</h3>
                    <span className={`mobile-slice-task-card__status is-${task.status}`}>{statusLabels[task.status]}</span>
                  </div>
                  <p>{task.description || task.remark || '暂无任务说明'}</p>
                  <div className="mobile-slice-task-card__meta">
                    <UserProfileAvatar userId={task.assignedToId || task.createdById} displayName={task.assignedToName || task.createdByName || '未知用户'} className="mobile-slice-task-card__avatar" />
                    <span>{task.assignedToName || task.createdByName || '未知用户'}</span><span>·</span>
                    <span className={overdue ? 'is-overdue' : ''}>{formatTaskDueLabel(task.dueAt)}{overdue ? ' · 已逾期' : ''}</span><span>·</span>
                    <span>{task.commentCount || 0} 条回复</span>
                  </div>
                </div> : <div className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3">
                  <UserProfileAvatar userId={task.createdById} displayName={task.createdByName || '未知用户'} className="h-10 w-10 self-start text-xs" />
                  <div className="min-w-0">
                    <div className="flex min-h-10 flex-col justify-between">
                      <h3 className={`task-list-title truncate whitespace-nowrap pr-8 text-[15px] font-semibold leading-5 ${done ? 'text-slate-600' : 'text-slate-900 group-hover:text-primary-700'}`}>{task.title}</h3>
                      <div className="task-list-meta flex min-w-0 flex-nowrap items-end gap-x-2 overflow-hidden text-xs leading-4 text-slate-400">
                        <span className="shrink-0 font-medium text-slate-600">{task.createdByName || '未知用户'}</span>
                        <span className="shrink-0">·</span><span className="min-w-0 truncate tabular-nums">{formatDateTime(task.updatedAt)}</span>
                        <span className="ml-1 inline-flex h-4 shrink-0 items-center bg-slate-100 px-2 leading-none text-slate-600">{ownershipLabel(task)}</span>
                        <span className="task-meta-optional ml-auto inline-flex items-center gap-1 whitespace-nowrap"><Clock3 size={11} />{task.dueAt || '无截止日期'}</span>
                        <span className="task-meta-optional inline-flex items-center gap-1 whitespace-nowrap"><MessageSquare size={11} />{task.commentCount || 0} 条回复</span>
                      </div>
                    </div>
                    <div className="task-list-description mt-2 flex min-w-0 items-center gap-2 text-xs leading-5 text-slate-500">
                      {task.recommendation && <span className={`inline-flex h-5 shrink-0 items-center px-2 text-[11px] font-medium ${taskRecommendationTone[task.recommendation]}`}>{task.recommendation}</span>}
                      <p className="min-w-0 flex-1 truncate">{task.description || task.remark || '暂无任务说明'}</p>
                    </div>
                  </div>
                  <div className="absolute right-2 top-2 flex shrink-0 items-center gap-1" onClick={event => event.stopPropagation()}>{(user?.role === 'admin' || task.createdById === user?.id) && <button type="button" onClick={() => void remove(task)} className="task-topic-delete flex h-7 w-7 items-center justify-center text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`删除${task.title}`}><Trash2 size={13} /></button>}</div>
                </div>}
                <dl className={`${isMessages ? 'mt-2.5 grid grid-cols-2 border-t border-slate-100 pt-2.5 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_1fr_1.3fr]' : 'hidden'} `}>
                  <div className={isMessages ? 'min-w-0 border-r border-slate-100 px-2.5 first:pl-0' : 'flex min-w-0 items-baseline gap-2'}><dt className="shrink-0 text-[11px] leading-4 text-slate-400">关联项目</dt><dd className={`${isMessages ? 'truncate' : 'break-words'} text-xs font-medium leading-5 text-slate-700`}>{task.projectName || '未关联项目'}</dd></div>
                  <div className={isMessages ? 'min-w-0 border-r border-slate-100 px-2.5' : 'flex min-w-0 items-baseline gap-2'}><dt className="shrink-0 text-[11px] leading-4 text-slate-400">创建人</dt><dd className={`${isMessages ? 'truncate' : 'break-words'} text-xs font-medium leading-5 text-slate-700`}>{task.createdByName || '—'}</dd></div>
                  <div className={isMessages ? 'min-w-0 border-r border-slate-100 px-2.5' : 'flex min-w-0 items-baseline gap-2'}><dt className="shrink-0 text-[11px] leading-4 text-slate-400">协作人员</dt><dd className={`${isMessages ? 'truncate' : 'whitespace-normal break-words'} text-xs font-medium leading-5 text-slate-700`}>{task.recipientNames?.length ? task.recipientNames.join('、') : '无'}</dd></div>
                  <div className={isMessages ? 'min-w-0 border-r border-slate-100 px-2.5' : 'flex min-w-0 items-baseline gap-2'}><dt className="shrink-0 text-[11px] leading-4 text-slate-400">截止日期</dt><dd className="flex items-center gap-1 whitespace-nowrap text-xs font-medium leading-5"><span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-600' : 'text-slate-700'}`}><Clock3 size={12} className="shrink-0" />{task.dueAt || '无'}{overdue && <span className="font-normal">· 已逾期</span>}</span></dd></div>
                  <div className={isMessages ? 'min-w-0 px-2.5' : 'flex min-w-0 items-baseline gap-2 xl:justify-self-end'}><dt className="shrink-0 text-[11px] leading-4 text-slate-400">{isMessages ? '任务动态' : '主题互动'}</dt><dd className={`flex min-w-0 items-center gap-2 text-xs leading-5 ${isMessages ? 'text-slate-600' : 'font-medium text-primary-700'}`}><span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap"><MessageSquare size={12} />{task.commentCount || 0} 条{isMessages ? '留言' : '回复'}</span>{isMessages && <span className="min-w-0 truncate whitespace-nowrap text-slate-400">更新于 {formatDateTime(task.updatedAt)}</span>}</dd></div>
                </dl>
              </div>
            </article>;
          })}</div>}
        </div>
      </ListCardShell></div>}

      <AppModal
        open={creating}
        onClose={() => setCreating(false)}
        title={`新建${itemLabel}`}
        subtitle={isMessages ? '填写提醒内容并选择需要通知的人员。' : '填写任务信息，创建后全体成员均可查看并参与留言。'}
        size="lg"
        bodyClassName="px-6 py-5"
        footer={<><button type="button" disabled={creatingTask} onClick={() => setCreating(false)} className="h-10 border border-slate-200 bg-white px-5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button><button type="submit" form="create-task-form" disabled={creatingTask} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800 disabled:bg-primary-300">{creatingTask ? '创建中…' : `创建${itemLabel}`}</button></>}
      >
        <form id="create-task-form" onSubmit={createTask} onChange={event => { const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; if (field.name) setCreateDraft(current => ({ ...current, [field.name]: field.value })); }} className="mx-auto grid w-full max-w-5xl gap-5 sm:grid-cols-2">
          {isMessages ? <>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">提醒标题</span><input name="title" required autoFocus defaultValue={createDraft.title || ''} placeholder="请输入简明的提醒标题" className="h-10 w-full border border-slate-200 px-3 text-sm outline-none focus:border-primary-500" /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">提醒内容</span><textarea name="description" required defaultValue={createDraft.description || ''} placeholder="填写需要通知的事项和具体说明" className="min-h-28 w-full resize-y border border-slate-200 p-3 text-sm outline-none focus:border-primary-500" /></label>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-xs font-medium text-slate-600">要通知的人</legend><div className="max-h-44 overflow-y-auto border border-slate-200 bg-slate-50 p-2">{directoryUsers.map(person => { const selected = selectedRecipientIds.includes(person.id); return <button key={person.id} type="button" onClick={() => toggleRecipient(person.id)} className={`mb-1 flex w-full items-center gap-3 border px-3 py-2 text-left last:mb-0 ${selected ? 'border-primary-300 bg-primary-50' : 'border-transparent bg-white hover:border-slate-200'}`}><span className={`flex h-5 w-5 items-center justify-center border ${selected ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{selected && <Check size={13} />}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-800">{person.display_name}</span><span className="text-[10px] text-slate-400">{person.hasEmail ? '可邮件通知' : '站内通知'}</span></button>; })}</div></fieldset>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">组件（选填）</span><TaskFormSelect name="componentType" value={createDraft.componentType || 'none'} options={[{ value: 'none', label: '无组件' }, { value: 'poll', label: '投票' }]} onChange={value => setCreateDraft(current => ({ ...current, componentType: value }))} /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">截止时间（选填）</span><input name="dueAt" type="datetime-local" defaultValue={createDraft.dueAt || ''} className="h-10 w-full border border-slate-200 px-3 text-sm" /></label>
          {createDraft.componentType === 'poll' && <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">投票选项</span><textarea name="pollOptions" required defaultValue={createDraft.pollOptions || ''} placeholder={'每行填写一个选项\n例如：同意\n不同意'} className="min-h-24 w-full resize-y border border-slate-200 p-3 text-sm outline-none focus:border-primary-500" /></label>}
          </> : <>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">{itemLabel}标题</span><input name="title" required autoFocus defaultValue={createDraft.title || ''} placeholder={`请输入明确的${itemLabel}标题`} className="h-10 w-full border border-slate-200 px-3 text-sm outline-none focus:border-primary-500" /></label>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-xs font-medium text-slate-600">任务归属</legend><div className="grid grid-cols-2 gap-2">{([{ value: 'self_developed', label: '自主开发', icon: UserRound }, { value: 'business_center', label: '业务中心', icon: Building2 }] as const).map(option => { const Icon = option.icon; return <button key={option.value} type="button" onClick={() => setOwnershipType(option.value)} className={`flex h-11 items-center justify-center gap-2 border text-sm ${ownershipType === option.value ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><Icon size={15} />{option.label}</button>; })}</div></fieldset>
          {ownershipType === 'business_center' && <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">业务中心区域</span><TaskFormSelect name="businessRegion" value={createDraft.businessRegion || ''} options={(Object.keys(regionLabels) as BusinessRegion[]).map(key => ({ value: key, label: regionLabels[key] }))} onChange={value => setCreateDraft(current => ({ ...current, businessRegion: value }))} placeholder="请选择区域" /></label>}
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">任务说明</span><textarea name="description" defaultValue={createDraft.description || ''} placeholder="填写工作内容、交付标准和处理要求" className="min-h-24 w-full resize-y border border-slate-200 p-3 text-sm outline-none focus:border-primary-500" /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">备注</span><textarea name="remark" defaultValue={createDraft.remark || ''} placeholder="补充背景、注意事项或其他说明（选填）" className="min-h-20 w-full resize-y border border-slate-200 p-3 text-sm outline-none focus:border-primary-500" /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">附件（选填，最多 10 个，单个不超过 100MB）</span><span className="flex min-h-14 cursor-pointer items-center justify-center gap-2 border border-dashed border-slate-300 bg-slate-50 px-4 text-sm text-slate-500 hover:border-primary-400 hover:bg-primary-50/40 hover:text-primary-700"><Paperclip size={16} />{createAttachments.length ? `已选择 ${createAttachments.length} 个文件` : '选择任务相关文件'}<input type="file" multiple className="hidden" onChange={event => { const files = Array.from(event.target.files || []).slice(0, 10); setCreateAttachments(files); event.target.value = ''; }} /></span>{createAttachments.length > 0 && <span className="mt-2 grid gap-1">{createAttachments.map((file, index) => <span key={`${file.name}-${index}`} className="flex items-center gap-2 bg-slate-50 px-3 py-2 text-xs text-slate-600"><FileText size={13} className="shrink-0 text-slate-400" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="shrink-0 text-slate-400">{(file.size / 1024 / 1024).toFixed(file.size >= 1024 * 1024 ? 1 : 2)} MB</span><button type="button" onClick={() => setCreateAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-red-600"><X size={13} /></button></span>)}</span>}</label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">关联项目</span><TaskFormSelect name="projectId" value={createDraft.projectId ?? projectId} options={[{ value: '', label: '不关联项目' }, ...products.map(product => ({ value: product.id, label: product.productName }))]} onChange={value => setCreateDraft(current => ({ ...current, projectId: value }))} /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">截止日期</span><input name="dueAt" type="date" defaultValue={createDraft.dueAt || ''} className="h-10 w-full border border-slate-200 px-3 text-sm" /></label>
          <div className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">负责人</span><div className="flex h-10 items-center border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">{user?.display_name || '当前用户'}</div></div>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-xs font-medium text-slate-600">协作及通知人员（选填）</legend><div className="max-h-44 overflow-y-auto border border-slate-200 bg-slate-50 p-2">{directoryUsers.map(person => { const selected = selectedRecipientIds.includes(person.id); return <button key={person.id} type="button" onClick={() => toggleRecipient(person.id)} className={`mb-1 flex w-full items-center gap-3 border px-3 py-2 text-left last:mb-0 ${selected ? 'border-primary-300 bg-primary-50' : 'border-transparent bg-white hover:border-slate-200'}`}><span className={`flex h-5 w-5 items-center justify-center border ${selected ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{selected && <Check size={13} />}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-800">{person.display_name}</span><span className="text-[10px] text-slate-400">{person.hasEmail ? '可邮件通知' : '未设置邮箱'}</span></button>; })}</div></fieldset>
          </>}
        </form>
      </AppModal>

      {selectedTask && editingTask && <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-white ${isMessages ? '' : 'border-l border-slate-200 lg:col-start-2 lg:row-start-2 task-detail-panel-in'}`}>
        <RealtimeConflictBanner event={taskConflict.conflict} onKeep={taskConflict.clearConflict} onReload={async () => { setEditingTask(false); taskConflict.clearConflict(); await load(); }} />
        <div className="app-content-toolbar flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div><h2 className="text-base font-semibold text-slate-900">编辑任务</h2><p className="mt-1 text-xs text-slate-400">修改任务信息，保存后将同步更新任务中心中的现有记录。</p></div>
          <button type="button" onClick={() => setEditingTask(false)} className="flex h-9 w-9 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭编辑任务"><X size={19} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <form id="edit-task-form" onSubmit={saveTaskEdits} className="mx-auto grid w-full max-w-5xl gap-5 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">任务标题</span><input name="title" required maxLength={200} defaultValue={selectedTask.title} className="h-10 w-full border border-slate-200 px-3 text-sm outline-none focus:border-primary-500" /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">任务说明</span><textarea name="description" maxLength={4000} defaultValue={selectedTask.description || ''} className="min-h-24 w-full resize-y border border-slate-200 p-3 text-sm outline-none focus:border-primary-500" /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">备注</span><textarea name="remark" maxLength={2000} defaultValue={selectedTask.remark || ''} className="min-h-20 w-full resize-y border border-slate-200 p-3 text-sm outline-none focus:border-primary-500" /></label>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-xs font-medium text-slate-600">任务归属</legend><div className="grid grid-cols-2 gap-2">{([['self_developed', '自主开发'], ['business_center', '业务中心']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setEditOwnershipType(value)} className={`h-10 border text-sm ${editOwnershipType === value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600'}`}>{label}</button>)}</div></fieldset>
          {editOwnershipType === 'business_center' && <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">业务区域</span><TaskFormSelect name="businessRegion" value={editDraft.businessRegion || ''} options={(Object.keys(regionLabels) as BusinessRegion[]).map(key => ({ value: key, label: regionLabels[key] }))} onChange={value => setEditDraft(current => ({ ...current, businessRegion: value }))} placeholder="请选择区域" /></label>}
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">负责人</span><TaskFormSelect name="assignedToId" value={editDraft.assignedToId || ''} options={directoryUsers.map(person => ({ value: person.id, label: person.display_name }))} onChange={value => setEditDraft(current => ({ ...current, assignedToId: value }))} placeholder="请选择负责人" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">关联项目</span><TaskFormSelect name="projectId" value={editDraft.projectId || ''} options={[{ value: '', label: '不关联项目' }, ...products.map(product => ({ value: product.id, label: product.productName }))]} onChange={value => setEditDraft(current => ({ ...current, projectId: value }))} /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-600">截止日期</span><input name="dueAt" type="date" defaultValue={selectedTask.dueAt || ''} className="h-10 w-full border border-slate-200 px-3 text-sm" /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-slate-600">追加附件（选填，当前 {selectedTask.attachments?.length || 0} 个）</span><span className="flex min-h-14 cursor-pointer items-center justify-center gap-2 border border-dashed border-slate-300 bg-slate-50 px-4 text-sm text-slate-500 hover:border-primary-400 hover:bg-primary-50/40 hover:text-primary-700"><Paperclip size={16} />{editAttachments.length ? `待上传 ${editAttachments.length} 个文件` : '选择要追加的附件'}<input type="file" multiple className="hidden" onChange={event => { const remaining = Math.max(0, 10 - (selectedTask.attachments?.length || 0)); setEditAttachments(Array.from(event.target.files || []).slice(0, remaining)); event.target.value = ''; }} /></span>{editAttachments.length > 0 && <span className="mt-2 grid gap-1">{editAttachments.map((file, index) => <span key={`${file.name}-${index}`} className="flex items-center gap-2 bg-slate-50 px-3 py-2 text-xs text-slate-600"><FileText size={13} className="shrink-0 text-slate-400" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="shrink-0 text-slate-400">{file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span><button type="button" onClick={() => setEditAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-red-600"><X size={13} /></button></span>)}</span>}</label>
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-xs font-medium text-slate-600">协作人员</legend><div className="max-h-44 overflow-y-auto border border-slate-200 bg-slate-50 p-2">{directoryUsers.filter(person => person.id !== selectedTask.assignedToId).map(person => { const checked = editRecipientIds.includes(person.id); return <button key={person.id} type="button" onClick={() => toggleEditRecipient(person.id)} className={`mb-1 flex w-full items-center gap-3 border px-3 py-2 text-left last:mb-0 ${checked ? 'border-primary-300 bg-primary-50' : 'border-transparent bg-white hover:border-slate-200'}`}><span className={`flex h-5 w-5 items-center justify-center border ${checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check size={13} />}</span><span className="text-sm text-slate-800">{person.display_name}</span></button>; })}</div></fieldset>
        </form>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-6 py-3"><button type="button" onClick={() => setEditingTask(false)} className="h-10 border border-slate-200 bg-white px-5 text-sm text-slate-700 hover:bg-slate-50">取消</button><button type="submit" form="edit-task-form" disabled={savingId === selectedTask.id} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800 disabled:bg-primary-300">保存修改</button></div>
      </div>}

      {!creating && !selectedTask && !isMessages && <button type="button" onClick={openCreateModal} className="mobile-collab-fab lg:hidden" aria-label="新建任务"><Plus size={23} /></button>}

      {selectedTask && !editingTask && !isMessages && isMobileViewport && <div className="mobile-slice-task-detail">
        <header className="mobile-slice-detail-appbar">
          <button type="button" onClick={closeTaskDetail} aria-label="返回任务列表"><ChevronLeft size={23} /></button>
          <h1>任务详情</h1>
          {canEditSelectedTask ? <button type="button" onClick={openEditTask} aria-label="更多任务操作"><MoreHorizontal size={21} /></button> : <span />}
        </header>
        <section className="mobile-slice-detail-hero">
          <span>TASK · {selectedTask.id.slice(-6).toUpperCase()}</span>
          <h2>{selectedTask.title}</h2>
          <div><em className={`is-${selectedTask.status}`}>{statusLabels[selectedTask.status]}</em>{selectedTask.dueAt && <em className={taskDueEndTime(selectedTask.dueAt) < Date.now() ? 'is-overdue' : ''}>{selectedTask.dueAt}</em>}</div>
        </section>
        <section className="mobile-slice-detail-section">
          <h3>任务信息</h3>
          <div className="mobile-slice-property"><span>负责人</span><strong className="mobile-slice-property-owner"><UserProfileAvatar userId={selectedTask.assignedToId} displayName={selectedTask.assignedToName || '未指定'} />{selectedTask.assignedToName || '未指定'}</strong></div>
          {[['所属项目', selectedTask.projectName || '未关联'], ['截止日期', formatTaskDate(selectedTask.dueAt)], ['任务归属', ownershipLabel(selectedTask)]].map(([label, value]) => <div className="mobile-slice-property" key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </section>
        <section className="mobile-slice-detail-section">
          <h3>任务说明</h3>
          <p>{selectedTask.description || '未填写任务说明'}</p>
          {selectedTask.attachments?.map(attachment => <a key={attachment.id} href={`/api/tasks/${selectedTask.id}/attachments/${attachment.id}`} className="mobile-slice-attachment"><span><FileText size={18} /></span><div><strong>{attachment.fileName}</strong><small>{attachment.fileSize >= 1024 * 1024 ? `${(attachment.fileSize / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(attachment.fileSize / 1024))} KB`}</small></div></a>)}
        </section>
        <section className="mobile-slice-detail-section">
          <h3>动态与回复 · {comments.filter(item => !item.deleted).length}</h3>
          {comments.filter(item => !item.deleted).map(comment => <article className="mobile-slice-comment" key={comment.id}><UserProfileAvatar userId={comment.userId} displayName={comment.userName || '未知用户'} /><div><strong>{comment.userName || '未知用户'}</strong><p>{renderCommentContent(comment.content, comment.mentionNames)}</p></div></article>)}
          {comments.length === 0 && <p className="mobile-slice-detail-empty">暂无回复</p>}
        </section>
      </div>}

      {selectedTask && !editingTask && <div className={`min-h-0 flex-1 flex-col overflow-hidden bg-white ${!isMessages ? 'hidden lg:flex' : 'flex'} ${isMessages ? '' : `task-detail-pane border-l border-slate-200 lg:col-start-2 lg:row-start-2 ${detailClosing ? 'task-detail-panel-out' : 'task-detail-panel-in'}`}`}>
        <div className="app-content-toolbar flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0"><h2 className="max-w-full truncate text-lg font-semibold leading-6 text-slate-950">{selectedTask.title}</h2>{isMessages ? <div className="mt-1 flex items-center gap-2 text-xs text-slate-400"><span>提醒详情</span><span className="h-1 w-1 bg-slate-300" /><span>{comments.filter(item => !item.deleted).length} 条留言</span><span className="h-1 w-1 bg-slate-300" /><span>更新于 {formatDateTime(selectedTask.updatedAt)}</span></div> : <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-slate-400"><span className="shrink-0 whitespace-nowrap">创建人：{selectedTask.createdByName || '—'}</span><span className="h-1 w-1 shrink-0 bg-slate-300" /><span className="min-w-0 truncate">协作人：{selectedTask.recipientNames?.join('、') || '无'}</span><span className="h-1 w-1 shrink-0 bg-slate-300" /><span className="shrink-0 whitespace-nowrap">截止日期：{selectedTask.dueAt || '无'}</span></div>}</div>
          <div className="flex shrink-0 items-center gap-1">{canEditSelectedTask && <button type="button" onClick={openEditTask} className="inline-flex h-9 items-center justify-center gap-1.5 px-3 text-sm text-slate-600 hover:bg-slate-100 hover:text-primary-700" aria-label="编辑任务信息"><Pencil size={15} />编辑</button>}<button type="button" onClick={closeTaskDetail} className="flex h-9 w-9 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="关闭任务详情" title="关闭任务详情"><X size={19} /></button></div>
        </div>
        <div className={`grid min-h-0 flex-1 ${isMessages ? 'lg:grid-cols-[320px_minmax(0,1fr)]' : summaryExpanded ? 'grid-rows-[minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)]'}`}>
          <aside ref={detailInfoScrollRef} className={`task-detail-scrollbar-hidden min-h-0 border-slate-200 ${isMessages ? 'overflow-y-auto border-b bg-slate-50/70 p-4 lg:border-b-0 lg:border-r' : `task-topic-summary group relative border-b bg-slate-50/60 p-5 pb-10 lg:grid lg:grid-cols-2 lg:p-6 lg:pb-11 ${summaryExpanded ? 'task-topic-summary-expanded h-full max-h-none overflow-hidden' : 'max-h-[42vh] overflow-y-auto lg:max-h-[190px]'}`}`}>
            {isMessages && <div className="flex flex-nowrap items-center gap-1.5">
              <span title={ownershipLabel(selectedTask)} className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 border border-primary-100 bg-primary-50 px-2 text-sm font-medium text-primary-700"><Building2 size={13} className="shrink-0" /><span className="truncate">{ownershipLabel(selectedTask)}</span></span>
              <TaskStatusSelect compact value={selectedTask.status} onChange={status => void updateStatus(selectedTask, status)} disabled={savingId === selectedTask.id || !canEditSelectedTask} />
            </div>}

            {isMessages && <section className="mt-5 border-t border-slate-200">
              <dl className="divide-y divide-slate-200">
                {[
                  ['负责人', selectedTask.assignedToName || '未指定'],
                  ['创建人', selectedTask.createdByName || '—'],
                  ['关联项目', selectedTask.projectName || '未关联'],
                  ['截止日期', selectedTask.dueAt || '无'],
                  ['协作人员', selectedTask.recipientNames?.join('、') || '无'],
                  ['更新时间', formatDateTime(selectedTask.updatedAt)],
                ].map(([label, value]) => <div key={label} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="break-words text-right text-xs leading-5 text-slate-700">{value}</dd></div>)}
              </dl>
            </section>}

            <section className={`${isMessages ? 'mt-5 border-t border-slate-200 pt-4' : ''} ${summaryExpanded && !isMessages ? 'task-summary-section-expanded' : ''}`}>
              <h3 className="text-xs font-semibold text-slate-700">任务说明</h3>
              <div className={`task-summary-copy mt-2 whitespace-pre-wrap break-words text-slate-700 ${!summaryExpanded && selectedTask.description ? 'task-summary-copy-collapsed' : ''} ${isMessages ? 'text-sm leading-6' : 'text-[15px] leading-7'}`}>{selectedTask.description || <span className="text-slate-400">未填写任务说明</span>}</div>
            </section>
            {!isMessages && selectedTask.attachments && selectedTask.attachments.length > 0 && <section className="mt-5 border-t border-slate-200 pt-4 lg:col-span-2"><h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Paperclip size={13} />附件 · {selectedTask.attachments.length}</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{selectedTask.attachments.map(attachment => <a key={attachment.id} href={`/api/tasks/${selectedTask.id}/attachments/${attachment.id}?token=${encodeURIComponent(localStorage.getItem('auth_token') || '')}`} onClick={event => { event.preventDefault(); const token = localStorage.getItem('auth_token'); fetch(`/api/tasks/${selectedTask.id}/attachments/${attachment.id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(response => { if (!response.ok) throw new Error('附件下载失败'); return response.blob(); }).then(blob => { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.fileName; anchor.click(); URL.revokeObjectURL(url); }).catch(error => _toast.error?.(error.message)); }} className="flex min-w-0 items-center gap-2 border border-slate-200 bg-white px-3 py-2.5 hover:border-primary-300 hover:bg-primary-50/30"><FileText size={15} className="shrink-0 text-primary-600" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{attachment.fileName}</span><span className="shrink-0 text-[10px] text-slate-400">{attachment.fileSize >= 1024 * 1024 ? `${(attachment.fileSize / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(attachment.fileSize / 1024))} KB`}</span><Download size={13} className="shrink-0 text-slate-400" /></a>)}</div></section>}
            <section className={`mt-5 border-t border-slate-200 pt-4 ${isMessages ? '' : 'lg:mt-0 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0'} ${summaryExpanded && !isMessages ? 'task-summary-section-expanded' : ''}`}>
              <h3 className="text-xs font-semibold text-slate-700">创建备注</h3>
              <div className={`task-summary-copy mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 ${!summaryExpanded && selectedTask.remark ? 'task-summary-copy-collapsed' : ''}`}>{selectedTask.remark || <span className="text-slate-400">无备注</span>}</div>
            </section>
            {!isMessages && (selectedTask.description || selectedTask.remark) && <button type="button" onClick={() => setSummaryExpanded(current => !current)} onPointerUp={event => event.currentTarget.blur()} className="task-summary-toggle absolute bottom-2 left-1/2 z-10 inline-flex h-7 -translate-x-1/2 items-center gap-1 bg-white/95 px-3 text-xs font-medium text-primary-600 opacity-0 shadow-sm transition-opacity hover:text-primary-800 group-hover:opacity-100 focus-visible:opacity-100">{summaryExpanded ? <><ChevronUp size={13} />收起</> : <><ChevronDown size={13} />展开全部</>}</button>}
          </aside>

          <section className={`flex min-w-0 flex-col bg-white ${isMessages ? 'min-h-[430px]' : 'task-thread-pane min-h-0'}`}>
            {isMessages && <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              <div><div className="flex items-center gap-2"><MessageSquare size={15} className="text-slate-400" /><h3 className="text-sm font-semibold text-slate-900">任务动态</h3></div><p className="mt-1 text-xs text-slate-400">所有成员均可留言，内容将记录提交人员及时间。</p></div>
              <span className="text-xs tabular-nums text-slate-400">{comments.filter(item => !item.deleted).length} 条留言</span>
            </div>}

            {(!summaryExpanded || isMessages) && <div ref={commentsScrollRef} className={`min-h-0 flex-1 overflow-y-auto px-6 ${isMessages ? '' : 'task-thread-scroll'}`}>
              {commentsLoading ? <div className="py-20 text-center text-sm text-slate-400">{isMessages ? '留言' : '回复'}加载中…</div> : comments.length === 0 ? <div className="task-thread-empty flex h-full min-h-60 flex-col items-center justify-center text-center"><span className="flex h-12 w-12 shrink-0 items-center justify-center bg-slate-50 text-slate-300"><MessageSquare size={22} /></span><div className="mt-3 text-sm font-medium text-slate-600">暂无{isMessages ? '任务动态' : '主题回复'}</div><div className="mt-1 text-xs text-slate-400">补充进展、问题或处理结果，所有成员均可查看。</div></div> : <div className="divide-y divide-slate-100">{comments.map((comment, index) => <article id={`task-comment-${comment.id}`} key={comment.id} className={`scroll-mt-20 transition-colors duration-500 ${isMessages ? 'py-4' : 'py-5'} ${highlightedCommentId === comment.id ? 'bg-primary-50/80' : ''}`}><div className="flex min-w-0 items-center gap-2.5"><UserProfileAvatar userId={comment.userId} displayName={comment.userName || '未知用户'} className="h-8 w-8 text-[11px]" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium leading-4 text-slate-800">{comment.userName || '未知用户'}</div><div className="mt-0.5 text-[11px] tabular-nums leading-4 text-slate-400">{formatDateTime(comment.createdAt)}</div></div>{!isMessages && <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400">#{index + 1}</span>}{!comment.deleted && comment.userId === user?.id && <button type="button" onClick={() => void deleteComment(comment)} className="shrink-0 text-[11px] text-slate-400 hover:text-red-600">删除</button>}</div><div className={`ml-[42px] mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 ${comment.deleted ? 'italic text-slate-400' : 'text-slate-700'}`}>{comment.deleted ? `该${isMessages ? '留言' : '回复'}已删除` : renderCommentContent(comment.content, comment.mentionNames)}</div></article>)}</div>}
            </div>}

            <form onSubmit={sendComment} className={`shrink-0 border-t border-slate-200 px-6 ${isMessages ? 'bg-slate-50/70 py-3' : 'task-reply-composer bg-white py-4'}`}>
              <div className="flex items-end gap-2">
                <div className="relative min-w-0 flex-1 border border-slate-200 bg-white focus-within:border-primary-500">
                  {mentionState && <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(320px,calc(100vw-3rem))] border border-slate-200 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,.16)]" role="listbox" aria-label="选择要提及的成员">
                    <div className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-slate-400">提及成员{mentionState.query ? ` · “${mentionState.query}”` : ''}</div>
                    <div className="max-h-56 overflow-y-auto">{mentionCandidates.length ? mentionCandidates.map((person, index) => <button id={`task-mention-option-${person.id}`} key={person.id} type="button" role="option" aria-selected={index === mentionActiveIndex} onMouseDown={event => { event.preventDefault(); insertMention(person); }} onMouseEnter={() => setMentionActiveIndex(index)} className={`flex w-full items-center gap-2.5 px-2 py-2 text-left ${index === mentionActiveIndex ? 'bg-primary-50 text-primary-800' : 'text-slate-700 hover:bg-slate-50'}`}><UserProfileAvatar userId={person.id} displayName={person.display_name} className="h-8 w-8 text-[11px]" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{person.display_name}</span>{commentMentionIds.includes(person.id) && <Check size={14} className="shrink-0 text-primary-600" />}</button>) : <div className="px-3 py-6 text-center text-xs text-slate-400">没有匹配的成员</div>}</div>
                  </div>}
                  <textarea ref={commentInputRef} rows={1} value={commentText} onChange={event => { const value = event.target.value; const caret = event.currentTarget.selectionStart ?? value.length; setCommentText(value); updateMentionState(value, caret); if (selectedTask) setCommentDrafts(current => ({ ...current, [selectedTask.id]: value })); }} onClick={event => updateMentionState(commentText, event.currentTarget.selectionStart ?? commentText.length)} onKeyUp={event => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) updateMentionState(commentText, event.currentTarget.selectionStart ?? commentText.length); }} onKeyDown={event => { if (!mentionState) return; if (event.key === 'ArrowDown') { event.preventDefault(); setMentionActiveIndex(index => mentionCandidates.length ? (index + 1) % mentionCandidates.length : 0); } else if (event.key === 'ArrowUp') { event.preventDefault(); setMentionActiveIndex(index => mentionCandidates.length ? (index - 1 + mentionCandidates.length) % mentionCandidates.length : 0); } else if ((event.key === 'Enter' || event.key === 'Tab') && mentionCandidates[mentionActiveIndex]) { event.preventDefault(); insertMention(mentionCandidates[mentionActiveIndex]); } else if (event.key === 'Escape') { event.preventDefault(); setMentionState(null); } }} onBlur={() => window.setTimeout(() => setMentionState(null), 100)} maxLength={2000} placeholder={isMessages ? '输入任务进展或留言' : '回复这个主题…（输入 @ 提及成员）'} aria-activedescendant={mentionState && mentionCandidates[mentionActiveIndex] ? `task-mention-option-${mentionCandidates[mentionActiveIndex].id}` : undefined} className="block min-h-10 w-full resize-none overflow-hidden border-0 bg-transparent py-2 pl-3 pr-9 text-sm leading-6 outline-none placeholder:text-slate-400" />
                  <button type="button" onMouseDown={startCommentResize} onKeyDown={event => { if (event.key === 'ArrowUp') { event.preventDefault(); resizeCommentInput(24); } else if (event.key === 'ArrowDown') { event.preventDefault(); resizeCommentInput(-24); } }} className="absolute right-1.5 top-1 flex h-6 w-6 cursor-ns-resize items-center justify-center text-slate-300 hover:bg-slate-50 hover:text-primary-600 focus-visible:text-primary-600 focus-visible:outline-none" aria-label="拖拽调整留言输入框高度" title="向上拖拽可扩大输入框"><GripHorizontal size={14} /></button>
                  {commentText.length >= 1800 && <span className="pointer-events-none absolute bottom-1 right-2 bg-white/90 px-1 text-[10px] tabular-nums text-slate-400">{commentText.length}/2000</span>}
                </div>
                <button type="submit" disabled={commentSaving || !commentText.trim()} className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 bg-primary-700 px-4 text-xs font-medium text-white hover:bg-primary-800 disabled:bg-primary-300"><Send size={14} />发送</button>
              </div>
            </form>
          </section>
        </div>
      </div>}
      {ConfirmDialog}
    </div>
  );
}
