import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Ban, BarChart3, Calendar, ChevronLeft, ChevronRight, ClipboardList, Copy, Download, Eye, FileQuestion, FilePlus2, Filter, History, Inbox, Lightbulb, LoaderCircle,
  MessageSquarePlus, Monitor, MoreHorizontal, Pencil, Plus, QrCode, RefreshCw, Search, Send, Share2, Smartphone, Star, Trash2, Users, X,
} from 'lucide-react';
import QRCode from 'qrcode';
import AppModal from '../components/Layout/AppModal';
import Header from '../components/Layout/Header';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import ContextMenu from '../components/Layout/ContextMenu';
import QuestionnairePreview from '../components/Questionnaires/QuestionnairePreview';
import QuestionnaireStatsModal from '../components/Questionnaires/QuestionnaireStatsModal';
import QuestionnaireResultsWorkspace from '../components/Questionnaires/QuestionnaireResultsWorkspace';
import QuestionnaireVisualEditor from '../components/Questionnaires/QuestionnaireVisualEditor';
import { useConfirm } from '../components/Toast';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useRealtimeConflictGuard } from '../hooks/useRealtimeConflictGuard';
import RealtimeConflictBanner from '../components/RealtimeConflictBanner';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { api } from '../lib/api';
import { wsClient } from '../lib/ws';
import { _toast } from '../store/toastRef';
import type {
  Questionnaire, QuestionnaireField, QuestionnaireShareHistory,
  QuestionnaireStatus, QuestionnaireSubmission, QuestionnaireSubmissionRecord,
} from '../types/questionnaire';
import { generateId } from '../utils/id';
import { cloneQuestionnaireFields, questionnaireCopyTitle } from '../utils/questionnaireCopy';
import { QUESTIONNAIRE_TEMPLATES } from '../templates/questionnaireTemplates';
import { exportQuestionnaireExcel } from '../utils/questionnaireExcelExport';

const templateIconMap: Record<string, typeof FilePlus2> = { FilePlus2, Users, Star, Calendar, Lightbulb };
const statusLabels: Record<QuestionnaireStatus, string> = { draft: '草稿', published: '收集中', closed: '已关闭' };
const statusClasses: Record<QuestionnaireStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-amber-50 text-amber-700',
};
const submissionStatusLabels = { new: '新提交', viewed: '已查看', handled: '已处理' } as const;
const submissionStatusClasses = {
  new: 'bg-red-50 text-red-700', viewed: 'questionnaire-status-viewed bg-blue-50 text-blue-700', handled: 'bg-emerald-50 text-emerald-700',
} as const;

const defaultFields: QuestionnaireField[] = [
  { id: generateId(), label: '客户姓名', type: 'short_text', required: true, options: [] },
  { id: generateId(), label: '公司名称', type: 'short_text', required: true, options: [] },
  { id: generateId(), label: '联系电话', type: 'phone', required: true, options: [] },
  { id: generateId(), label: '电子邮箱', type: 'email', required: false, options: [] },
  { id: generateId(), label: '业务需求或关注事项', type: 'long_text', required: true, options: [] },
];

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatListDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatStorageSize(bytes: number) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  const gigabytes = safeBytes / (1024 ** 3);
  if (gigabytes >= 0.1) return `${gigabytes.toFixed(1)} GB`;
  const megabytes = safeBytes / (1024 ** 2);
  return `${megabytes.toFixed(1)} MB`;
}

function publicUrl(token: string) {
  return `${window.location.origin}/questionnaire/${token}`;
}

async function copyTextWithFallback(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // iOS Safari/WKWebView may expose the API but reject it. Fall through to
      // the selection-based copy path, which also works on non-HTTPS pages.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto -9999px';
  textarea.style.fontSize = '16px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('当前浏览器不允许自动复制，请长按链接手动拷贝');
}

function shareCardFile(dataUrl: string, fileName: string) {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!match) throw new Error('分享卡片数据无效');
  const bytes = match[2]
    ? Uint8Array.from(atob(match[3]), character => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(match[3]));
  return new File([bytes], fileName, { type: match[1] || 'image/png' });
}

function isIOSWebKit() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function saveShareCard(dataUrl: string, fileName: string) {
  const file = shareCardFile(dataUrl, fileName);
  if (isIOSWebKit() && navigator.share) {
    const shareData = { files: [file], title: fileName };
    if (!navigator.canShare || navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return;
    }
  }

  const objectUrl = URL.createObjectURL(file);
  if (isIOSWebKit()) {
    const opened = window.open(objectUrl, '_blank');
    if (opened) opened.opener = null;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    if (!opened) throw new Error('浏览器阻止了图片打开，请允许弹出窗口后重试');
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

async function createQuestionnaireQrCard(qrDataUrl: string, title: string, owner: string, note = '') {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 960;
  const context = canvas.getContext('2d');
  if (!context) return qrDataUrl;

  const qrImage = new Image();
  qrImage.src = qrDataUrl;
  await new Promise<void>((resolve, reject) => {
    qrImage.onload = () => resolve();
    qrImage.onerror = () => reject(new Error('二维码卡片生成失败'));
  });

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 720, 960);
  context.strokeStyle = '#e6eaf0';
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, 719, 959);
  context.textAlign = 'center';
  context.fillStyle = '#0f172a';
  context.font = '600 32px "Microsoft YaHei", sans-serif';
  const safeTitle = title.trim() || '未命名问卷';
  const titleLines: string[] = [];
  let currentLine = '';
  for (const char of safeTitle) {
    const candidate = currentLine + char;
    if (context.measureText(candidate).width > 520 && currentLine) { titleLines.push(currentLine); currentLine = char; }
    else currentLine = candidate;
  }
  if (currentLine) titleLines.push(currentLine);
  titleLines.slice(0, 2).forEach((line, index) => context.fillText(line, 360, 120 + index * 42));

  context.save();
  context.strokeStyle = '#64748b';
  context.lineWidth = 3;
  context.lineCap = 'square';
  const hintIconX = 290;
  const hintIconY = 256;
  const hintIconSize = 22;
  const cornerSize = 6;
  context.beginPath();
  context.moveTo(hintIconX + cornerSize, hintIconY);
  context.lineTo(hintIconX, hintIconY);
  context.lineTo(hintIconX, hintIconY + cornerSize);
  context.moveTo(hintIconX + hintIconSize - cornerSize, hintIconY);
  context.lineTo(hintIconX + hintIconSize, hintIconY);
  context.lineTo(hintIconX + hintIconSize, hintIconY + cornerSize);
  context.moveTo(hintIconX, hintIconY + hintIconSize - cornerSize);
  context.lineTo(hintIconX, hintIconY + hintIconSize);
  context.lineTo(hintIconX + cornerSize, hintIconY + hintIconSize);
  context.moveTo(hintIconX + hintIconSize, hintIconY + hintIconSize - cornerSize);
  context.lineTo(hintIconX + hintIconSize, hintIconY + hintIconSize);
  context.lineTo(hintIconX + hintIconSize - cornerSize, hintIconY + hintIconSize);
  context.stroke();
  context.fillStyle = '#64748b';
  context.fillRect(hintIconX + 7, hintIconY + 7, 5, 5);
  context.fillRect(hintIconX + 14, hintIconY + 7, 4, 4);
  context.fillRect(hintIconX + 8, hintIconY + 15, 4, 4);
  context.fillRect(hintIconX + 15, hintIconY + 14, 5, 5);
  context.restore();
  context.fillStyle = '#64748b';
  context.font = '500 20px "Microsoft YaHei", sans-serif';
  context.textAlign = 'left';
  context.fillText('扫码填写', 326, 276);
  context.textAlign = 'center';

  context.fillStyle = '#ffffff';
  context.fillRect(130, 304, 460, 460);
  context.drawImage(qrImage, 150, 324, 420, 420);

  context.fillStyle = '#64748b';
  context.font = '400 17px "Microsoft YaHei", sans-serif';
  context.fillStyle = '#0f172a';
  context.font = '600 27px "Microsoft YaHei", sans-serif';
  const ownerText = owner || '当前经理';
  const ownerBottomOffset = context.measureText(ownerText).actualBoundingBoxDescent || 5;
  const ownerBaseline = 960 - 80 - ownerBottomOffset;
  context.fillStyle = '#64748b';
  context.font = '400 17px "Microsoft YaHei", sans-serif';
  context.fillText('分享人', 360, ownerBaseline - 36);
  context.fillStyle = '#0f172a';
  context.font = '600 27px "Microsoft YaHei", sans-serif';
  context.fillText(ownerText, 360, ownerBaseline);
  if (note.trim()) {
    context.fillStyle = '#64748b';
    context.font = '400 16px "Microsoft YaHei", sans-serif';
    context.fillText(note.trim().slice(0, 80), 360, ownerBaseline + 32);
  }
  return canvas.toDataURL('image/png');
}

function answerText(value: QuestionnaireSubmission['answers'][string] | undefined) {
  if (Array.isArray(value)) return value.join('、') || '—';
  if (typeof value === 'object' && value) return value.fileName || '附件';
  if (value === '' || value == null) return '—';
  return String(value);
}

function mobileSubmissionAnswer(record: QuestionnaireSubmissionRecord, keywords: string[]) {
  const field = record.fields.find(item => keywords.some(keyword => item.label.includes(keyword)));
  return field ? answerText(record.answers[field.id]) : '';
}

function mobileSubmissionIdentity(record: QuestionnaireSubmissionRecord) {
  const textAnswers = record.fields
    .map(field => answerText(record.answers[field.id]))
    .filter(value => value && value !== '—' && value !== '附件');
  const company = mobileSubmissionAnswer(record, ['公司', '机构', '单位', '客户']) || textAnswers[0] || record.questionnaireTitle;
  const contact = mobileSubmissionAnswer(record, ['联系人', '姓名', '称呼']) || record.sourceUserName || textAnswers[1] || '客户';
  return { company, contact };
}

export default function Questionnaires({ mode = 'design', standaloneEditor = false }: { mode?: 'design' | 'results'; standaloneEditor?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobileViewport = useMobileViewport();
  const resultsMode = mode === 'results';
  const [view, setView] = useState<'submissions' | 'management'>(resultsMode ? 'submissions' : 'management');
  const [items, setItems] = useState<Questionnaire[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number; usedPercent: number } | null>(null);
  const [allSubmissions, setAllSubmissions] = useState<QuestionnaireSubmissionRecord[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [questionnaireFilter, setQuestionnaireFilter] = useState('all');
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<'all' | 'new' | 'viewed' | 'handled'>('all');
  const [selectedSubmission, setSelectedSubmission] = useState<QuestionnaireSubmissionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | QuestionnaireStatus>('all');
  const [questionnaireSearch, setQuestionnaireSearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [copyingFrom, setCopyingFrom] = useState<Questionnaire | null>(null);
  const questionnaireConflict = useRealtimeConflictGuard('questionnaire', copyingFrom?.id, editorOpen && Boolean(copyingFrom));
  const [title, setTitle] = useState('客户需求调查问卷');
  const [description, setDescription] = useState('为便于我们更准确地了解您的需求，请填写以下信息。');
  const [thankYouMessage, setThankYouMessage] = useState('');
  const [fields, setFields] = useState<QuestionnaireField[]>(defaultFields);
  const [saving, setSaving] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const editorDirtyRef = useRef(false);
  const fieldsHistory = useRef<{ past: QuestionnaireField[][]; future: QuestionnaireField[][] }>({ past: [], future: [] });

  const setFieldsWithHistory = useCallback((next: QuestionnaireField[]) => {
    fieldsHistory.current.past.push(fields);
    if (fieldsHistory.current.past.length > 50) fieldsHistory.current.past.shift();
    fieldsHistory.current.future = [];
    setFields(next);
    setEditorDirty(true);
  }, [fields]);

  const undoFields = useCallback(() => {
    fieldsHistory.current.future.push(fields);
    const previous = fieldsHistory.current.past.pop();
    if (previous) { setFields(previous); setEditorDirty(true); }
  }, [fields]);

  const redoFields = useCallback(() => {
    const next = fieldsHistory.current.future.pop();
    if (!next) return;
    fieldsHistory.current.past.push(fields);
    setFields(next);
    setEditorDirty(true);
  }, [fields]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [publishItem, setPublishItem] = useState<Questionnaire | null>(null);
  const [statsItem, setStatsItem] = useState<Questionnaire | null>(null);
  const [qrCardDataUrl, setQrCardDataUrl] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareOwnerName, setShareOwnerName] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [shareNoteOpen, setShareNoteOpen] = useState(false);
  const [shareHistoryItem, setShareHistoryItem] = useState<Questionnaire | null>(null);
  const [shareHistory, setShareHistory] = useState<QuestionnaireShareHistory[]>([]);
  const [selectedShareHistory, setSelectedShareHistory] = useState<QuestionnaireShareHistory | null>(null);
  const [shareHistoryLoading, setShareHistoryLoading] = useState(false);
  const [shareHistoryQr, setShareHistoryQr] = useState('');
  const [templateOpen, setTemplateOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ item: Questionnaire; x: number; y: number } | null>(null);
  const [submissionContextMenu, setSubmissionContextMenu] = useState<{ record: QuestionnaireSubmissionRecord; x: number; y: number } | null>(null);
  const [renameItem, setRenameItem] = useState<Questionnaire | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsTitle, setSaveAsTitle] = useState('');
  const [savingAs, setSavingAs] = useState(false);
  const editorRouteHandled = useRef('');

  useEffect(() => {
    if (!standaloneEditor) return undefined;
    const previousTitle = document.title;
    const currentQuestionnaireName = title.trim() || '新建问卷';
    document.title = `${currentQuestionnaireName}｜GCO Link 问卷`;
    return () => { document.title = previousTitle; };
  }, [standaloneEditor, title]);
  const submissionTableRef = useRef<HTMLDivElement>(null);
  const { confirm: ask, ConfirmDialog } = useConfirm();

  useEffect(() => { editorDirtyRef.current = editorDirty; }, [editorDirty]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [editorOpen]);

  const closeEditor = async () => {
    if (editorDirty) {
      const confirmed = await ask({
        title: '退出问卷编辑？',
        message: '当前有尚未保存的修改。退出后这些修改将丢失。',
        confirmText: '放弃修改并退出',
        tone: 'danger',
      });
      if (!confirmed) return;
    }
    editorDirtyRef.current = false;
    setEditorDirty(false);
    setEditorOpen(false);
    setCopyingFrom(null);
    setSaveAsOpen(false);
    editorRouteHandled.current = '';
    if (standaloneEditor) {
      window.close();
      if (!window.closed) navigate('/questionnaires');
    } else {
      navigate('/questionnaires');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, usageResult] = await Promise.all([
        api.get<{ questionnaires: Questionnaire[] }>('/questionnaires'),
        api.get<{ used: number; quota: number; usedPercent: number }>('/questionnaires/usage'),
      ]);
      setItems(result.questionnaires || []);
      setUsage(usageResult);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '问卷加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || !location.pathname.startsWith('/questionnaires/')) return;
    if (editorRouteHandled.current === location.pathname) return;
    if (location.pathname === '/questionnaires/new') {
      editorRouteHandled.current = location.pathname;
      setCopyingFrom(null);
      setTitle('未命名问卷'); setDescription(''); setThankYouMessage('');
      fieldsHistory.current = { past: [], future: [] };
      setFields([]); setEditorDirty(false); setEditorOpen(true);
      return;
    }
    const match = location.pathname.match(/^\/questionnaires\/([^/]+)\/edit$/);
    if (!match) return;
    const item = items.find(questionnaire => questionnaire.id === decodeURIComponent(match[1]));
    if (!item) return;
    editorRouteHandled.current = location.pathname;
    setStatsItem(null); setPublishItem(null); setSelectedSubmission(null);
    setCopyingFrom(item); setTitle(item.title); setDescription(item.description);
    setThankYouMessage(item.thankYouMessage || '');
    fieldsHistory.current = { past: [], future: [] };
    setFields(item.fields.map(field => ({ ...field, options: [...(field.options || [])], visibility: field.visibility ? { ...field.visibility } : null })));
    setEditorDirty(false);
    setEditorOpen(true);
  }, [items, loading, location.pathname]);

  const loadAllSubmissions = useCallback(async () => {
    setSubmissionsLoading(true);
    try {
      const result = await api.get<{ submissions: QuestionnaireSubmissionRecord[] }>('/questionnaires/submissions/all');
      setAllSubmissions(result.submissions || []);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '提交记录加载失败');
    } finally {
      setSubmissionsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); void loadAllSubmissions(); }, [load, loadAllSubmissions]);
  useRealtimeRefresh(['questionnaire'], load);
  useRealtimeRefresh(['submission'], loadAllSubmissions);

  // 实时接收新问卷提交，自动刷新提交记录并提示
  useEffect(() => {
    const off = wsClient.on('questionnaire-submission-new', () => {
      void loadAllSubmissions();
    });
    return off;
  }, [loadAllSubmissions]);

  useEffect(() => {
    if (!publishItem || publishItem.status === 'draft') { setQrCardDataUrl(''); setShareUrl(''); setShareOwnerName(''); return; }
    let active = true;
    setQrCardDataUrl('');
    const noteQuery = shareNote.trim() ? `?note=${encodeURIComponent(shareNote.trim())}` : '';
    api.get<{ shareToken: string; sourceUserName: string }>(`/questionnaires/${publishItem.id}/share${noteQuery}`)
      .then(async result => {
        const url = `${publicUrl(publishItem.publicToken)}?share=${encodeURIComponent(result.shareToken)}`;
        const ownerName = result.sourceUserName || '当前经理';
        if (active) { setShareUrl(url); setShareOwnerName(ownerName); }
        const qr = await QRCode.toDataURL(url, { width: 280, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
        const card = await createQuestionnaireQrCard(qr, publishItem.title, ownerName, shareNote);
        if (active) setQrCardDataUrl(card);
      })
      .catch(error => {
        if (active) { setQrCardDataUrl(''); setShareUrl(''); setShareOwnerName(''); }
        _toast.error?.(error instanceof Error ? error.message : '专属分享链接生成失败');
      });
    return () => { active = false; };
  }, [publishItem, shareNote]);

  useEffect(() => {
    if (!selectedShareHistory || !shareHistoryItem) { setShareHistoryQr(''); return; }
    let active = true;
    const url = `${publicUrl(shareHistoryItem.publicToken)}?share=${encodeURIComponent(selectedShareHistory.shareToken)}`;
    QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(value => { if (active) setShareHistoryQr(value); })
      .catch(() => { if (active) setShareHistoryQr(''); });
    return () => { active = false; };
  }, [selectedShareHistory, shareHistoryItem]);

  const counts = useMemo(() => ({
    all: items.length,
    draft: items.filter(item => item.status === 'draft').length,
    published: items.filter(item => item.status === 'published').length,
    closed: items.filter(item => item.status === 'closed').length,
  }), [items]);
  const visible = useMemo(() => {
    const keyword = questionnaireSearch.trim().toLocaleLowerCase('zh-CN');
    return items.filter(item => (filter === 'all' || item.status === filter)
      && (!keyword || [item.title, item.description, item.createdByName].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword))));
  }, [filter, items, questionnaireSearch]);
  const filteredSubmissions = useMemo(() => {
    const keyword = submissionSearch.trim().toLocaleLowerCase('zh-CN');
    return allSubmissions.filter(record => {
      if (questionnaireFilter !== 'all' && record.questionnaireId !== questionnaireFilter) return false;
      if (submissionStatusFilter !== 'all' && (record.status || 'new') !== submissionStatusFilter) return false;
      if (!keyword) return true;
      const haystack = [record.questionnaireTitle, ...record.fields.map(field => field.label), ...Object.values(record.answers).map(answerText)].join(' ').toLocaleLowerCase('zh-CN');
      return haystack.includes(keyword);
    });
  }, [allSubmissions, questionnaireFilter, submissionSearch, submissionStatusFilter]);
  const selectedQuestionnaire = useMemo(
    () => questionnaireFilter === 'all' ? null : items.find(item => item.id === questionnaireFilter) || null,
    [items, questionnaireFilter],
  );
  const submissionCategoryCounts = useMemo(() => {
    const result = new Map<string, number>();
    allSubmissions.forEach(record => result.set(record.questionnaireId, (result.get(record.questionnaireId) || 0) + 1));
    return result;
  }, [allSubmissions]);
  const submissionCategoryNewCounts = useMemo(() => {
    const result = new Map<string, number>();
    allSubmissions.forEach(record => {
      if ((record.status || 'new') === 'new') result.set(record.questionnaireId, (result.get(record.questionnaireId) || 0) + 1);
    });
    return result;
  }, [allSubmissions]);
  const newSubmissionCount = useMemo(() => allSubmissions.filter(item => (item.status || 'new') === 'new').length, [allSubmissions]);
  const filteredNewSubmissionCount = useMemo(() => filteredSubmissions.filter(item => (item.status || 'new') === 'new').length, [filteredSubmissions]);

  useEffect(() => {
    if (!items.length) {
      if (questionnaireFilter !== 'all') setQuestionnaireFilter('all');
      return;
    }
    const selectedStillExists = questionnaireFilter !== 'all'
      && items.some(item => item.id === questionnaireFilter);
    if (selectedStillExists) return;
    if (resultsMode) {
      if (questionnaireFilter !== 'all') setQuestionnaireFilter('all');
      return;
    }
    if (isMobileViewport) {
      if (questionnaireFilter !== 'all') setQuestionnaireFilter('all');
      return;
    }
    setQuestionnaireFilter(items[0].id);
  }, [isMobileViewport, items, questionnaireFilter, resultsMode]);

  const openNew = () => {
    if (!standaloneEditor) {
      window.open('/questionnaires/new', '_blank', 'noopener,noreferrer');
      return;
    }
    editorRouteHandled.current = '/questionnaires/new';
    setCopyingFrom(null);
    setTitle('未命名问卷'); setDescription(''); setThankYouMessage('');
    fieldsHistory.current = { past: [], future: [] };
    setFields([]); setEditorDirty(false); setEditorOpen(true);
    navigate('/questionnaires/new');
  };

  const applyTemplate = (templateId: string) => {
    const template = QUESTIONNAIRE_TEMPLATES.find(item => item.id === templateId);
    setTemplateOpen(false);
    setCopyingFrom(null);
    setTitle(template?.title || '未命名问卷');
    setDescription(template?.intro || '');
    setThankYouMessage('');
    const source = template?.fields?.length ? template.fields : defaultFields;
    const nextFields = source.map(field => ({ ...field, id: generateId(), options: [...(field.options || [])] }));
    fieldsHistory.current = { past: [], future: [] };
    setFields(nextFields);
    setEditorDirty(true);
    setEditorOpen(true);
    editorRouteHandled.current = '/questionnaires/new';
  };

  const openEdit = (item: Questionnaire) => {
    if (!standaloneEditor) {
      window.open(`/questionnaires/${encodeURIComponent(item.id)}/edit`, '_blank', 'noopener,noreferrer');
      return;
    }
    editorRouteHandled.current = '';
    navigate(`/questionnaires/${encodeURIComponent(item.id)}/edit`);
  };

  const prepareFields = () => fields.map(field => ({
      ...field,
      label: field.label.trim(),
      options: field.options.map(option => option.trim()).filter(Boolean),
      description: field.description?.trim() || '',
      defaultValue: field.defaultValue?.trim() || '',
      visibility: field.visibility?.fieldId && field.visibility.value.trim() ? { ...field.visibility, value: field.visibility.value.trim() } : null,
      optionDisplay: field.optionDisplay || 'vertical',
    }));

  const validateQuestionnaire = (nextTitle: string, cleanFields: QuestionnaireField[]) => {
    if (!nextTitle.trim()) { _toast.warning?.('请输入问卷名称'); return false; }
    if (cleanFields.some(field => !field.label)) return _toast.warning?.('请填写所有题目名称');
    if (cleanFields.some(field => ['single_choice', 'multiple_choice'].includes(field.type) && !field.options.length)) {
      _toast.warning?.('单选和多选题至少需要一个选项'); return false;
    }
    if (cleanFields.some((field, index) => {
      if (!field.visibility) return false;
      const sourceIndex = cleanFields.findIndex(item => item.id === field.visibility?.fieldId);
      const source = sourceIndex >= 0 ? cleanFields[sourceIndex] : null;
      return !source || sourceIndex >= index || source.hidden || source.type === 'section_break' || !field.visibility.value.trim()
        || (['single_choice', 'multiple_choice'].includes(source.type) && !source.options.includes(field.visibility.value));
    })) {
      _toast.warning?.('条件显示只能引用当前题目前面的题目'); return false;
    }
    return true;
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const cleanFields = prepareFields();
    if (!validateQuestionnaire(title, cleanFields)) return;
    setSaving(true);
    try {
      if (copyingFrom) await api.put(`/questionnaires/${copyingFrom.id}`, { title, description, fields: cleanFields, thankYouMessage });
      else await api.post('/questionnaires', { title, description, fields: cleanFields, thankYouMessage });
      editorDirtyRef.current = false;
      setEditorDirty(false);
      setEditorOpen(false);
      setCopyingFrom(null);
      await load();
      if (standaloneEditor) { window.close(); if (!window.closed) navigate('/questionnaires'); }
      else navigate('/questionnaires');
      _toast.success?.(copyingFrom ? '问卷已更新' : '问卷已创建');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const openSaveAs = () => {
    setSaveAsTitle(questionnaireCopyTitle(title));
    setSaveAsOpen(true);
  };

  const saveAsQuestionnaire = async (event: FormEvent) => {
    event.preventDefault();
    const cleanFields = prepareFields();
    if (!validateQuestionnaire(saveAsTitle, cleanFields)) return;
    const clonedFields = cloneQuestionnaireFields(cleanFields, generateId);
    setSavingAs(true);
    try {
      const result = await api.post<{ questionnaire: Questionnaire }>('/questionnaires', {
        title: saveAsTitle.trim(), description, fields: clonedFields, thankYouMessage,
      });
      setCopyingFrom(result.questionnaire);
      setTitle(result.questionnaire.title);
      setDescription(result.questionnaire.description);
      setThankYouMessage(result.questionnaire.thankYouMessage || '');
      setFields(result.questionnaire.fields);
      fieldsHistory.current = { past: [], future: [] };
      editorDirtyRef.current = false;
      setEditorDirty(false);
      setSaveAsOpen(false);
      await load();
      _toast.success?.(`已另存为“${result.questionnaire.title}”`);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '另存为失败');
    } finally {
      setSavingAs(false);
    }
  };

  const changeStatus = async (item: Questionnaire, status: QuestionnaireStatus) => {
    try {
      await api.put(`/questionnaires/${item.id}`, { status });
      await load();
      setPublishItem(current => current?.id === item.id ? { ...current, status } : current);
      _toast.success?.(status === 'published' ? (item.status === 'closed' ? '问卷已重新开放，原链接和二维码恢复有效' : '问卷已发布，可以发送给客户') : status === 'closed' ? '问卷已关闭，分享链接和二维码已失效' : '问卷已转为草稿');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '状态更新失败');
    }
  };

  const closeQuestionnaire = async (item: Questionnaire) => {
    setContextMenu(null);
    const confirmed = await ask({
      title: '关闭问卷',
      message: `确定关闭“${item.title}”吗？关闭后问卷和历史答卷仍会保留，但已分享的链接与二维码将无法继续填写。`,
      confirmText: '确认关闭',
      tone: 'danger',
    });
    if (!confirmed) return;
    await changeStatus(item, 'closed');
  };

  const reopenQuestionnaire = async (item: Questionnaire) => {
    setContextMenu(null);
    await changeStatus(item, 'published');
  };

  const openPublish = (item: Questionnaire) => {
    setStatsItem(null);
    setShareHistoryItem(null);
    setSelectedSubmission(null);
    setEditorOpen(false);
    setShareNote('');
    setShareNoteOpen(false);
    setPublishItem(item);
  };

  const openShareHistory = async (item: Questionnaire) => {
    setStatsItem(null);
    setPublishItem(null);
    setSelectedSubmission(null);
    setEditorOpen(false);
    setShareHistoryItem(item);
    setShareHistoryLoading(true);
    try {
      const result = await api.get<{ history: QuestionnaireShareHistory[] }>(`/questionnaires/${item.id}/share-history`);
      const history = result.history || [];
      setShareHistory(history);
      setSelectedShareHistory(history[0] || null);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '分享历史加载失败');
    } finally {
      setShareHistoryLoading(false);
    }
  };

  const recordCurrentShare = async () => {
    if (!publishItem) return;
    await api.post(`/questionnaires/${publishItem.id}/share-history`, { note: shareNote.trim() });
  };

  const clearOneTimeShareNote = () => {
    setShareNote('');
    setShareNoteOpen(false);
  };

  const copyCurrentShareLink = async () => {
    if (!shareUrl) return;
    try {
      await copyTextWithFallback(shareUrl);
      clearOneTimeShareNote();
      _toast.success?.('客户填写链接已复制');
    } catch (_) {
      _toast.error?.('当前浏览器不允许自动复制，请长按上方链接手动拷贝');
      return;
    }
    try { await recordCurrentShare(); } catch (error) { console.warn('分享历史记录失败', error); }
  };

  const downloadCurrentShareCard = async () => {
    if (!qrCardDataUrl || !publishItem) return;
    const safeTitle = publishItem.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '问卷';
    const safeOwner = (shareOwnerName || '专属').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    try {
      await saveShareCard(qrCardDataUrl, `${safeTitle}-${safeOwner}-分享卡片.png`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      _toast.error?.(error instanceof Error ? error.message : '分享卡片保存失败');
      return;
    }
    try { await recordCurrentShare(); } catch (error) { console.warn('分享历史记录失败', error); }
    clearOneTimeShareNote();
  };

  const openResponses = (item: Questionnaire) => {
    setStatsItem(null);
    setPublishItem(null);
    setSelectedSubmission(null);
    setEditorOpen(false);
    setQuestionnaireFilter(item.id);
    setSubmissionStatusFilter('all');
    setView('submissions');
  };

  const updateSubmissionStatus = async (record: QuestionnaireSubmissionRecord, status: 'new' | 'viewed' | 'handled') => {
    try {
      await api.put(`/questionnaires/submissions/${record.id}/status`, { status });
      setAllSubmissions(current => current.map(item => item.id === record.id ? { ...item, status } : item));
      setSelectedSubmission(current => current?.id === record.id ? { ...current, status } : current);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '处理状态更新失败');
    }
  };

  const openSubmission = (record: QuestionnaireSubmissionRecord) => {
    setStatsItem(null);
    setPublishItem(null);
    setEditorOpen(false);
    setSelectedSubmission(record);
    if ((record.status || 'new') === 'new') void updateSubmissionStatus(record, 'viewed');
  };

  const removeSubmission = async (record: QuestionnaireSubmissionRecord) => {
    const ok = await ask(`确定删除这份答卷吗？此操作不可恢复。`);
    if (!ok) return;
    try {
      await api.delete(`/questionnaires/submissions/${record.id}`);
      setAllSubmissions(current => current.filter(item => item.id !== record.id));
      setSelectedSubmission(current => current?.id === record.id ? null : current);
      _toast.success?.('答卷已删除');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '删除答卷失败');
    }
  };

  const scrollSubmissionTable = (direction: -1 | 1) => {
    submissionTableRef.current?.scrollBy({ left: direction * 640, behavior: 'smooth' });
  };

  const exportSubmissionInbox = async (questionnaire?: Questionnaire) => {
    const target = questionnaire || selectedQuestionnaire;
    if (!target) return _toast.warning?.('请先打开一份问卷');
    const records = allSubmissions.filter(record => record.questionnaireId === target.id);
    if (!records.length) return _toast.warning?.('当前问卷还没有可导出的答卷');
    try {
      await exportQuestionnaireExcel(target, records);
      _toast.success?.('问卷 Excel 已生成');
    } catch (error) { _toast.error?.(error instanceof Error ? error.message : 'Excel 导出失败'); }
  };

  const openRename = (item: Questionnaire) => {
    setContextMenu(null);
    setRenameItem(item);
    setRenameTitle(item.title);
  };

  const renameQuestionnaire = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameItem || !renameTitle.trim()) return _toast.warning?.('请输入问卷名称');
    setRenaming(true);
    try {
      await api.put(`/questionnaires/${renameItem.id}`, { title: renameTitle.trim() });
      setRenameItem(null);
      await load();
      _toast.success?.('问卷已重命名');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '重命名失败');
    } finally {
      setRenaming(false);
    }
  };

  const remove = async (item: Questionnaire) => {
    const ok = await ask(`确定删除问卷“${item.title}”吗？其 ${item.submissionCount} 条答卷也会一并删除，此操作不可撤销。`);
    if (!ok) return;
    try {
      await api.delete(`/questionnaires/${item.id}`);
      await load();
      _toast.success?.('问卷已删除');
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '删除失败');
    }
  };

  const downloadAttachment = async (questionnaireId: string, submissionId: string, fieldId: string, fileName: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/questionnaires/${questionnaireId}/submissions/${submissionId}/attachments/${fieldId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '附件下载失败');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : '附件下载失败');
    }
  };

  const downloadSubmissionWord = async (record: QuestionnaireSubmissionRecord) => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`/api/questionnaires/submissions/${encodeURIComponent(record.id)}/export.docx`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Word 下载失败');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      const safeTitle = record.questionnaireTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '问卷';
      anchor.download = `${safeTitle}_答卷_${record.submittedAt.slice(0, 10)}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      _toast.error?.(error instanceof Error ? error.message : 'Word 下载失败');
    }
  };

  const selectedHistoryUrl = shareHistoryItem && selectedShareHistory
    ? `${publicUrl(shareHistoryItem.publicToken)}?share=${encodeURIComponent(selectedShareHistory.shareToken)}`
    : '';

  const copyHistoricalShareLink = async () => {
    if (!selectedHistoryUrl) return;
    try { await copyTextWithFallback(selectedHistoryUrl); _toast.success?.('历史分享链接已复制'); }
    catch (_) { _toast.error?.('当前浏览器不允许自动复制，请长按链接手动拷贝'); }
  };

  const downloadHistoricalQr = async () => {
    if (!shareHistoryQr || !shareHistoryItem || !selectedShareHistory) return;
    const safeTitle = shareHistoryItem.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '问卷';
    const safeNote = (selectedShareHistory.note || '默认分享').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    try {
      await saveShareCard(shareHistoryQr, `${safeTitle}-${safeNote}-二维码.png`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      _toast.error?.(error instanceof Error ? error.message : '二维码保存失败');
    }
  };

  const shareHistoryPage = shareHistoryItem ? (
    <div className="grid h-full min-h-0 bg-white lg:grid-cols-[minmax(240px,0.8fr)_minmax(360px,1.2fr)]">
      <section className="min-h-0 overflow-y-auto border-r border-slate-200">
        <div className="border-b border-slate-100 px-5 py-4"><h3 className="text-sm font-semibold text-slate-900">分享历史</h3><p className="mt-1 text-xs text-slate-400">按备注归档，仅显示你生成的分享。</p></div>
        {shareHistoryLoading ? <div className="flex justify-center py-16 text-sm text-slate-400"><LoaderCircle size={16} className="mr-2 animate-spin" />加载中...</div> : shareHistory.length === 0 ? <div className="px-5 py-16 text-center text-sm text-slate-400">暂无分享记录</div> : <div>{shareHistory.map(record => <button key={record.id} type="button" onClick={() => setSelectedShareHistory(record)} className={`w-full border-b border-slate-100 px-5 py-4 text-left transition-colors ${selectedShareHistory?.id === record.id ? 'shadow-[inset_0_0_0_1px_var(--color-primary-600)]' : 'hover:bg-slate-50'}`}><div className="truncate text-sm font-medium text-slate-800">{record.note || '无备注分享'}</div><div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-400"><span>{formatListDateTime(record.lastUsedAt)}</span><span>使用 {record.useCount} 次</span></div></button>)}</div>}
      </section>
      <section className="flex min-h-0 flex-col items-center justify-center px-6 py-8 text-center">
        {!selectedShareHistory ? <div className="text-sm text-slate-400">选择一条分享历史查看</div> : <><div className="text-lg font-semibold text-slate-900">{selectedShareHistory.note || '无备注分享'}</div><div className="mt-2 text-xs text-slate-400">最近使用 {formatDateTime(selectedShareHistory.lastUsedAt)}</div>{shareHistoryQr ? <img src={shareHistoryQr} alt="历史分享二维码" className="mt-7 h-56 w-56" /> : <div className="mt-7 flex h-56 w-56 items-center justify-center bg-slate-50 text-xs text-slate-400">二维码生成中...</div>}<div className="mt-7 flex items-center gap-3"><button type="button" onClick={() => void copyHistoricalShareLink()} className="inline-flex h-10 items-center gap-2 border border-slate-300 px-4 text-sm text-slate-700 hover:bg-slate-50"><Copy size={15} />复制链接</button><button type="button" onClick={downloadHistoricalQr} className="inline-flex h-10 items-center gap-2 bg-primary-700 px-4 text-sm text-white hover:bg-primary-800"><Download size={15} />下载二维码</button></div></>}
      </section>
    </div>
  ) : null;

  const publishPage = publishItem ? (
    <div className="questionnaire-publish-page flex h-full min-h-0 items-center justify-center overflow-y-auto bg-white px-4 py-4 sm:px-6 md:px-10 lg:px-14 xl:px-20">
      <div className="grid w-full gap-8 md:h-full md:grid-cols-[minmax(0,1fr)_280px] md:items-center">
        <section className="flex min-w-0 flex-col justify-center py-2 md:h-full">
          <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2 text-xs font-medium text-slate-500"><span className={`h-2 w-2 ${publishItem.status === 'published' ? 'bg-emerald-500' : publishItem.status === 'closed' ? 'bg-amber-500' : 'bg-slate-300'}`} />{statusLabels[publishItem.status]}</div>{publishItem.status === 'draft' ? <button type="button" onClick={() => void changeStatus(publishItem, 'published')} className="h-8 bg-primary-700 px-3 text-xs font-medium text-white">发布问卷</button> : publishItem.status === 'closed' ? <button type="button" onClick={() => void reopenQuestionnaire(publishItem)} className="h-8 bg-primary-700 px-3 text-xs font-medium text-white">重新开放</button> : null}</div>
          <h3 className="questionnaire-publish-title mt-4 truncate text-xl font-semibold tracking-tight text-slate-950">{publishItem.title}</h3>
          {publishItem.status === 'draft' ? <div className="mt-8"><div className="flex h-11 w-11 items-center justify-center bg-primary-50 text-primary-700"><Send size={19} /></div><p className="mt-5 text-sm font-medium text-slate-800">准备好后即可发布</p><p className="mt-1 max-w-md text-sm leading-6 text-slate-500">发布后将生成当前经理的专属填写链接与二维码。</p></div> : <div className="mt-8">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400"><span>分享身份</span><span className="h-3 w-px bg-slate-200" /><span className="font-medium text-slate-700">{shareOwnerName || '生成中…'}</span><button type="button" onClick={() => setShareNoteOpen(value => !value)} className={`inline-flex h-6 w-6 items-center justify-center transition-colors ${shareNote ? 'bg-primary-50 text-primary-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`} title="添加一次性备注" aria-label="添加一次性备注"><MessageSquarePlus size={14} /></button>{shareNote && !shareNoteOpen && <span className="max-w-52 truncate bg-slate-100 px-2 py-1 text-slate-600" title={shareNote}>{shareNote}</span>}</div>
            {shareNoteOpen && <div className="mt-3 flex items-center border border-slate-200 bg-white"><input autoFocus value={shareNote} maxLength={80} onChange={event => setShareNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') setShareNoteOpen(false); if (event.key === 'Escape') { setShareNote(''); setShareNoteOpen(false); } }} placeholder="例如：发给上海客户（仅本次分享）" className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400" /><button type="button" onClick={() => setShareNoteOpen(false)} className="h-10 px-3 text-xs font-medium text-primary-700">完成</button></div>}
            <div className="mt-3 flex min-w-0 bg-slate-50"><input readOnly value={shareUrl} aria-label="客户填写链接" className="h-12 min-w-0 flex-1 bg-transparent px-4 font-mono text-xs text-slate-600 outline-none" /><button type="button" disabled={!shareUrl} onClick={() => void copyCurrentShareLink()} className="flex h-12 w-12 shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:opacity-40" title="复制链接"><Copy size={16} /></button><button type="button" disabled={!shareUrl} onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')} className="flex h-12 w-12 shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:opacity-40" title="打开客户页面"><Eye size={16} /></button></div>
            {publishItem.status === 'closed' && <div className="mt-4 flex items-start gap-2 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-700"><span className="mt-1 h-1.5 w-1.5 shrink-0 bg-amber-500" />问卷已关闭，当前链接与二维码无法填写。重新开放后，原链接与二维码会恢复有效。</div>}
          </div>}
        </section>
        <aside className="flex min-h-72 flex-col items-center justify-center bg-white p-3 text-center md:h-full">{publishItem.status === 'draft' ? <div className="flex w-full max-w-[260px] flex-col items-center bg-white px-6 py-10"><div className="h-1 w-full bg-primary-700" /><QrCode size={28} className="mt-12 text-slate-300" /><div className="mt-5 text-sm font-medium text-slate-500">发布后生成分享卡片</div><div className="mt-2 text-xs leading-5 text-slate-400">包含问卷名称、分享人与专属二维码</div></div> : qrCardDataUrl ? <><img src={qrCardDataUrl} alt={`${publishItem.title}分享二维码卡片`} className="w-full max-w-[250px] shadow-[0_12px_32px_rgba(15,23,42,0.10)]" /><button type="button" onClick={downloadCurrentShareCard} className="mt-4 inline-flex h-8 items-center gap-2 px-3 text-xs text-slate-500 transition-colors hover:text-primary-700"><Download size={14} />下载分享卡片</button></> : <div className="flex min-h-[350px] w-full max-w-[250px] items-center justify-center bg-white text-xs text-slate-400">分享卡片生成中…</div>}</aside>
      </div>
    </div>
  ) : null;

  if (standaloneEditor) return (
    <div className="fixed inset-0 bg-white">
      <RealtimeConflictBanner event={questionnaireConflict.conflict} onKeep={questionnaireConflict.clearConflict} onReload={async () => { questionnaireConflict.clearConflict(); setEditorOpen(false); editorRouteHandled.current = ''; await load(); }} />
      {!editorOpen && <div className="flex h-full items-center justify-center text-sm text-slate-400"><LoaderCircle size={18} className="mr-2 animate-spin" />正在打开问卷编辑器…</div>}
      <QuestionnaireVisualEditor open={editorOpen} editing={Boolean(copyingFrom)} standalone title={title} description={description} thankYouMessage={thankYouMessage} fields={fields} saving={saving || savingAs} hasUnsavedChanges={editorDirty} onTitleChange={value => { setTitle(value); setEditorDirty(true); }} onDescriptionChange={value => { setDescription(value); setEditorDirty(true); }} onThankYouMessageChange={value => { setThankYouMessage(value); setEditorDirty(true); }} onFieldsChange={setFieldsWithHistory} onClose={() => void closeEditor()} onPreview={() => setPreviewOpen(true)} onSave={save} onSaveAs={openSaveAs} onUndo={undoFields} onRedo={redoFields} />
      <AppModal open={saveAsOpen} onClose={() => { if (!savingAs) setSaveAsOpen(false); }} title="另存为新问卷" subtitle="当前内容将保存为一份独立草稿，原问卷保持不变。" size="sm" footer={<><button type="button" disabled={savingAs} onClick={() => setSaveAsOpen(false)} className="h-10 border border-slate-300 px-4 text-sm text-slate-700 disabled:opacity-50">取消</button><button type="submit" form="questionnaire-save-as-form" disabled={savingAs || !saveAsTitle.trim()} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white disabled:opacity-50">{savingAs ? '保存中…' : '另存为'}</button></>}><form id="questionnaire-save-as-form" onSubmit={saveAsQuestionnaire}><label className="block text-xs font-medium text-slate-500">新问卷名称</label><input autoFocus value={saveAsTitle} onChange={event => setSaveAsTitle(event.target.value)} maxLength={120} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none" /></form></AppModal>
      <AppModal open={previewOpen} onClose={() => setPreviewOpen(false)} title="预览问卷" subtitle="可以实际选择选项，检查条件题目的显示效果。" size="full" fillContent pageMode bodyClassName="overflow-y-auto bg-slate-100 p-5" footer={<button type="button" onClick={() => setPreviewOpen(false)} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white">返回编辑</button>}><div className="mb-5 flex justify-center"><div className="inline-flex border border-slate-300 bg-white p-1"><button type="button" onClick={() => setPreviewMode('desktop')} className={`inline-flex h-9 items-center gap-2 px-4 text-sm ${previewMode === 'desktop' ? 'bg-primary-700 text-white' : 'text-slate-600'}`}><Monitor size={15} />电脑</button><button type="button" onClick={() => setPreviewMode('mobile')} className={`inline-flex h-9 items-center gap-2 px-4 text-sm ${previewMode === 'mobile' ? 'bg-primary-700 text-white' : 'text-slate-600'}`}><Smartphone size={15} />手机</button></div></div><div className={`mx-auto transition-all ${previewMode === 'mobile' ? 'max-w-[390px]' : 'max-w-2xl'}`}><QuestionnairePreview title={title} description={description} fields={fields} compact={previewMode === 'mobile'} /></div></AppModal>
    </div>
  );

  if (isMobileViewport) {
    const mobileStatusCounts = {
      all: allSubmissions.length,
      new: allSubmissions.filter(record => (record.status || 'new') === 'new').length,
      viewed: allSubmissions.filter(record => record.status === 'viewed').length,
      handled: allSubmissions.filter(record => record.status === 'handled').length,
    };

    if (statsItem) return (
      <div className="mobile-questionnaire-stats-page square-ui">
        <header className="mobile-questionnaire-appbar"><button type="button" onClick={() => setStatsItem(null)} aria-label="返回问卷列表"><ChevronLeft size={23} /></button><h1>问卷统计</h1><span /></header>
        <div className="mobile-questionnaire-stats-body"><QuestionnaireStatsModal open questionnaire={statsItem} /></div>
      </div>
    );

    if (publishItem) return (
      <div className="mobile-questionnaire-share-page square-ui">
        <header className="mobile-questionnaire-appbar"><button type="button" onClick={() => setPublishItem(null)} aria-label="返回问卷列表"><ChevronLeft size={23} /></button><h1>{publishItem.status === 'draft' ? '发布问卷' : '分享问卷'}</h1><span /></header>
        <section className="mobile-questionnaire-share-card">
          <em data-status={publishItem.status}>{statusLabels[publishItem.status]}</em>
          <h2>{publishItem.title}</h2>
          {publishItem.status === 'draft' ? <><p>发布后将生成客户填写链接与专属二维码。</p><button type="button" onClick={() => void changeStatus(publishItem, 'published')}>发布问卷</button></> : <>
            {qrCardDataUrl ? <img src={qrCardDataUrl} alt={`${publishItem.title}分享二维码`} /> : <div className="mobile-questionnaire-qr-loading">分享卡片生成中…</div>}
            <label><span>客户填写链接</span><input readOnly value={shareUrl} /></label>
            <div><button type="button" className="is-secondary" onClick={() => void copyCurrentShareLink()}>复制链接</button><button type="button" onClick={downloadCurrentShareCard}>下载分享卡片</button></div>
          </>}
        </section>
      </div>
    );

    if (resultsMode && selectedSubmission) {
      const identity = mobileSubmissionIdentity(selectedSubmission);
      const status = selectedSubmission.status || 'new';
      const contactFields = selectedSubmission.fields.slice(0, 3);
      const detailFields = selectedSubmission.fields.slice(3);
      return (
        <div className="mobile-submission-detail square-ui">
          <header className="mobile-questionnaire-appbar"><button type="button" onClick={() => setSelectedSubmission(null)} aria-label="返回提交记录"><ChevronLeft size={23} /></button><h1>答卷详情</h1><button type="button" aria-label="更多答卷操作"><MoreHorizontal size={22} /></button></header>
          <section className="mobile-submission-hero">
            <span>提交于 {formatDateTime(selectedSubmission.submittedAt)}</span>
            <h2>{identity.company}</h2>
            <div><em data-status={status}>{submissionStatusLabels[status]}</em><em>来源：{selectedSubmission.sourceUserName || '公共链接'}</em></div>
          </section>
          {contactFields.length > 0 && <section className="mobile-submission-section"><h3>联系人信息</h3>{contactFields.map(field => <div key={field.id} className="mobile-submission-property"><span>{field.label}</span><strong>{answerText(selectedSubmission.answers[field.id])}</strong></div>)}</section>}
          <section className="mobile-submission-section"><h3>问卷回答</h3>{detailFields.length === 0 ? <p>暂无更多回答。</p> : detailFields.map(field => {
            const answer = selectedSubmission.answers[field.id];
            const attachment = answer && typeof answer === 'object' && !Array.isArray(answer);
            if (attachment) return <button key={field.id} type="button" className="mobile-submission-attachment" onClick={() => void downloadAttachment(selectedSubmission.questionnaireId, selectedSubmission.id, field.id, answer.fileName)}><i><Download size={17} /></i><span><strong>{answer.fileName}</strong><small>{field.label} · 点击下载</small></span></button>;
            const value = answerText(answer);
            return value.length > 28 || field.type === 'long_text' ? <div key={field.id} className="mobile-submission-long-answer"><span>{field.label}</span><p>{value}</p></div> : <div key={field.id} className="mobile-submission-property"><span>{field.label}</span><strong>{value}</strong></div>;
          })}</section>
          <div className="mobile-submission-actions"><button type="button" className="is-secondary" onClick={() => void downloadSubmissionWord(selectedSubmission)}>下载 Word</button><button type="button" disabled={status === 'handled'} onClick={() => void updateSubmissionStatus(selectedSubmission, 'handled')}>{status === 'handled' ? '已处理' : '标记为已处理'}</button></div>
        </div>
      );
    }

    if (resultsMode) return (
      <div className="mobile-submission-list square-ui">
        <header className="mobile-questionnaire-appbar"><button type="button" onClick={() => navigate('/questionnaires')} aria-label="返回问卷管理"><ChevronLeft size={23} /></button><h1>提交记录</h1><button type="button" disabled={!selectedQuestionnaire || !filteredSubmissions.length} onClick={() => void exportSubmissionInbox()} aria-label="下载提交记录"><Download size={20} /></button></header>
        <div className="mobile-submission-search"><Search size={18} /><input value={submissionSearch} onChange={event => setSubmissionSearch(event.target.value)} placeholder="搜索联系人、项目或回答" /></div>
        <div className="mobile-submission-chips">
          {(['all', 'new', 'viewed', 'handled'] as const).map(key => <button key={key} type="button" onClick={() => setSubmissionStatusFilter(key)} className={submissionStatusFilter === key ? 'is-active' : ''}>{key === 'all' ? '全部' : submissionStatusLabels[key]} {mobileStatusCounts[key]}</button>)}
        </div>
        <section className="mobile-submission-surface">
          <header><h2>{selectedQuestionnaire?.title || '全部提交记录'}</h2><p>按提交时间从新到旧</p></header>
          {submissionsLoading ? <div className="mobile-questionnaire-empty">提交记录加载中…</div> : filteredSubmissions.length === 0 ? <div className="mobile-questionnaire-empty">暂无提交记录</div> : filteredSubmissions.map(record => {
            const identity = mobileSubmissionIdentity(record);
            const status = record.status || 'new';
            return <button key={record.id} data-mobile-submission-id={record.id} type="button" className="mobile-submission-row" onClick={() => openSubmission(record)}><span className="mobile-submission-avatar">{identity.contact.slice(0, 1)}</span><span><strong>{identity.company}</strong><small>{identity.contact} · {formatDateTime(record.submittedAt)}</small></span><em data-status={status}>{submissionStatusLabels[status]}</em></button>;
          })}
        </section>
      </div>
    );

    return (
      <div className="mobile-questionnaire-list square-ui">
        <header className="mobile-questionnaire-appbar"><span /><h1>问卷</h1><button type="button" onClick={openNew} aria-label="新建问卷"><Plus size={22} /></button></header>
        <div className="mobile-questionnaire-segment"><button type="button" className="is-active">问卷管理</button><button type="button" onClick={() => navigate('/questionnaire-results')}>提交记录 {newSubmissionCount > 0 && <b>{newSubmissionCount}</b>}</button></div>
        <div className="mobile-questionnaire-toolbar"><label><Search size={18} /><input value={questionnaireSearch} onChange={event => setQuestionnaireSearch(event.target.value)} placeholder="搜索问卷名称" /></label><button type="button" onClick={() => setFilter(filter === 'all' ? 'published' : filter === 'published' ? 'draft' : filter === 'draft' ? 'closed' : 'all')} aria-label="筛选问卷"><Filter size={19} /></button></div>
        <main className="mobile-questionnaire-card-list">
          {loading ? <div className="mobile-questionnaire-empty">问卷加载中…</div> : visible.length === 0 ? <div className="mobile-questionnaire-empty">暂无问卷</div> : visible.map(item => {
            const newCount = submissionCategoryNewCounts.get(item.id) || 0;
            return <article key={item.id} data-mobile-questionnaire-id={item.id} className="mobile-questionnaire-card">
              <div><h2>{item.title}</h2><em data-status={item.status}>{statusLabels[item.status]}</em></div>
              <p>最近更新 {formatListDateTime(item.updatedAt)}</p>
              <div className="mobile-questionnaire-stats"><span><strong>{item.submissionCount}</strong><small>答卷记录</small></span><span><strong className={newCount ? 'has-new' : ''}>{newCount}</strong><small>新提交</small></span></div>
              <footer><button type="button" onClick={() => setStatsItem(item)}>统计</button><button type="button" onClick={() => openEdit(item)}>编辑</button><button type="button" className="is-primary" onClick={() => item.status === 'closed' ? void reopenQuestionnaire(item) : openPublish(item)}>{item.status === 'draft' ? '发布' : item.status === 'closed' ? '重新开放' : '分享'}</button></footer>
            </article>;
          })}
        </main>
        <button type="button" onClick={openNew} className="mobile-questionnaire-slice-fab" aria-label="新建问卷"><Plus size={24} /></button>
      </div>
    );
  }

  return (
    <div className="mobile-system-page mobile-questionnaire-page flex min-h-full min-w-0 flex-col gap-5 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
      <Header title={resultsMode ? '问卷分析' : '问卷'} info={<FeatureInfo label={resultsMode ? '问卷分析功能说明' : '问卷功能说明'}>{resultsMode ? '集中查看答卷、处理状态和统计结果。' : '创建、设计、发布和分享客户问卷。'}</FeatureInfo>} subtitle={resultsMode ? '查看问卷回收结果、答卷明细与统计分析。' : '创建和设计客户问卷，完成发布与分享。'} className="border-0">
        {!resultsMode && <button type="button" onClick={openNew} className="mobile-questionnaire-fab inline-flex h-10 items-center justify-center gap-2 bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 lg:hidden" aria-label="新建问卷"><Plus size={20} /><span>新建问卷</span></button>}
      </Header>

      {resultsMode ? <QuestionnaireResultsWorkspace
        items={items}
        loading={loading}
        submissions={allSubmissions}
        submissionsLoading={submissionsLoading}
        selectedId={questionnaireFilter}
        search={questionnaireSearch}
        submissionSearch={submissionSearch}
        submissionStatus={submissionStatusFilter}
        onSearchChange={setQuestionnaireSearch}
        onSubmissionSearchChange={setSubmissionSearch}
        onSubmissionStatusChange={setSubmissionStatusFilter}
        onSelect={id => { setSelectedSubmission(null); setQuestionnaireFilter(id); }}
        onClose={() => { setSelectedSubmission(null); setQuestionnaireFilter('all'); }}
        onRefreshItems={() => void load()}
        onRefreshSubmissions={() => void loadAllSubmissions()}
        onExport={exportSubmissionInbox}
        onOpenSubmission={openSubmission}
        onSubmissionContextMenu={(record, x, y) => setSubmissionContextMenu({ record, x, y })}
        onDownloadAttachment={(questionnaireId, submissionId, fieldId, fileName) => void downloadAttachment(questionnaireId, submissionId, fieldId, fileName)}
        submissionDetail={selectedSubmission ? <>
          <div className="app-content-toolbar flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-6"><div className="min-w-0"><h2 className="truncate text-lg font-semibold text-slate-950">{selectedSubmission.questionnaireTitle}</h2><p className="mt-1 text-xs text-slate-400">提交时间：{formatDateTime(selectedSubmission.submittedAt)}</p></div><button type="button" onClick={() => setSelectedSubmission(null)} className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-800" aria-label="关闭答卷详情"><X size={20} /></button></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><span className={`inline-flex px-2 py-1 text-xs font-medium ${submissionStatusClasses[selectedSubmission.status || 'new']}`}>{submissionStatusLabels[selectedSubmission.status || 'new']}</span><span className="truncate text-xs text-slate-500">分享来源：{selectedSubmission.sourceUserName || '公共链接'}</span></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => void downloadSubmissionWord(selectedSubmission)} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 px-2.5 text-xs text-slate-700 hover:bg-slate-50"><Download size={14} />下载 Word</button><select value={selectedSubmission.status || 'new'} onChange={event => void updateSubmissionStatus(selectedSubmission, event.target.value as 'new' | 'viewed' | 'handled')} className="h-8 border border-slate-300 bg-white px-2.5 text-xs text-slate-700"><option value="new">新提交</option><option value="viewed">已查看</option><option value="handled">已处理</option></select></div></div>
            <div className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2">{selectedSubmission.fields.map(field => { const answer = selectedSubmission.answers[field.id]; const isAttachment = answer && typeof answer === 'object' && !Array.isArray(answer); return <div key={field.id} className={`bg-white p-4 ${field.type === 'long_text' || field.type === 'attachment' ? 'sm:col-span-2' : ''}`}><div className="flex items-center gap-2 text-xs font-medium text-slate-500">{field.label}{field.hidden && <span className="bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">内部字段</span>}</div><div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{isAttachment ? <button type="button" onClick={() => void downloadAttachment(selectedSubmission.questionnaireId, selectedSubmission.id, field.id, answer.fileName)} className="inline-flex max-w-full items-center gap-2 text-primary-700 hover:underline"><Download size={15} className="shrink-0" /><span className="truncate">{answer.fileName}</span></button> : answerText(answer)}</div></div>; })}</div>
            {(selectedSubmission.status || 'new') !== 'handled' && <div className="mt-5 flex justify-end"><button type="button" onClick={() => void updateSubmissionStatus(selectedSubmission, 'handled')} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800">标记为已处理</button></div>}
          </div>
        </> : null}
      /> : <section id="questionnaire-content-scope" className="grid min-h-0 flex-1 gap-5 overflow-visible lg:overflow-hidden xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-h-0 flex-col overflow-visible bg-white lg:overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-4">
            {!resultsMode && <button type="button" onClick={openNew} className="hidden h-10 items-center justify-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 lg:inline-flex"><Plus size={17} />新建问卷</button>}
            <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
              <label className="relative w-full max-w-72"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={questionnaireSearch} onChange={event => setQuestionnaireSearch(event.target.value)} placeholder="搜索问卷" className="h-10 w-full border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-primary-400 focus:bg-white" /></label>
              <button type="button" onClick={() => void load()} disabled={loading} className="flex h-10 w-10 shrink-0 items-center justify-center border border-slate-200 text-slate-500 hover:text-slate-900" title="刷新"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-visible px-4 pb-3 lg:overflow-y-auto lg:px-5">
            <div className="hidden h-11 grid-cols-[minmax(0,1fr)_88px_132px] items-center gap-3 px-3 text-xs font-medium text-slate-500 sm:grid"><span>问卷名</span><span>创建人</span><span>更新日期</span></div>
            {loading ? <div className="space-y-2 py-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-14 animate-pulse bg-slate-100" />)}</div> : visible.length === 0 ? <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center"><span className="mb-4 flex h-16 w-16 items-center justify-center bg-primary-50 text-primary-500"><ClipboardList size={26} /></span><div className="text-sm font-semibold text-slate-800">{questionnaireSearch ? '没有匹配的问卷' : '还没有问卷'}</div><div className="mt-2 text-xs text-slate-400">{questionnaireSearch ? '换个关键词试试。' : '新建第一份部门问卷。'}</div></div> : visible.map(item => {
              const selected = selectedQuestionnaire?.id === item.id;
              return <button key={item.id} type="button" onContextMenu={event => { event.preventDefault(); setQuestionnaireFilter(item.id); setContextMenu({ item, x: event.clientX, y: event.clientY }); }} onClick={() => { setStatsItem(null); setPublishItem(null); setShareHistoryItem(null); setSelectedSubmission(null); setEditorOpen(false); setQuestionnaireFilter(item.id); }} className={`grid min-h-[64px] w-full grid-cols-1 items-center gap-1 rounded-lg px-3 text-left text-sm transition-colors hover:bg-slate-100 sm:min-h-[56px] sm:grid-cols-[minmax(0,1fr)_88px_132px] sm:gap-3 ${selected ? 'bg-slate-100' : ''}`}><span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center text-primary-600"><FileQuestion size={25} /></span><span className="block min-w-0 truncate font-medium text-slate-900">{item.title}</span></span><span className="hidden truncate text-sm text-slate-400 sm:block">{item.createdByName || '未知'}</span><span className="hidden truncate font-mono text-xs tabular-nums text-slate-400 sm:block">{formatListDateTime(item.updatedAt)}</span></button>;
            })}
          </div>
          <div className="flex h-10 shrink-0 items-center justify-center text-xs text-slate-400">
            共 {visible.length} 项{usage ? ` · 剩余可用空间 ${formatStorageSize(usage.quota - usage.used)}` : ''}
          </div>
        </div>

        <aside className={`mobile-questionnaire-detail ${selectedQuestionnaire ? 'fixed inset-0 z-[60] flex' : 'hidden'} min-h-0 min-w-0 flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)] lg:static lg:flex lg:pb-0`}>
          {!selectedQuestionnaire ? <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center"><span className="mb-4 flex h-16 w-16 items-center justify-center bg-primary-50 text-primary-500"><ClipboardList size={26} /></span><div className="text-sm font-semibold text-slate-800">选择一个问卷</div><div className="mt-2 text-xs text-slate-400">右侧将显示问卷内容和提交记录。</div></div> : <>
            <div className="app-content-toolbar flex min-h-16 shrink-0 flex-col gap-2 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-5 lg:px-5 lg:py-0">
              <div className="min-w-0"><div className="truncate text-[13px] font-medium leading-5 text-slate-900">{selectedQuestionnaire.title}</div><div className="mt-1.5 flex min-w-0 items-center gap-2 text-[11px] leading-none text-slate-400"><span className="shrink-0">{statusLabels[selectedQuestionnaire.status]}</span><span className="h-0.5 w-0.5 shrink-0 rounded-full bg-slate-300" /><span className="shrink-0 tabular-nums">{selectedQuestionnaire.fields.length} 道题</span><span className="h-0.5 w-0.5 shrink-0 rounded-full bg-slate-300" /><span className="truncate tabular-nums">{selectedQuestionnaire.submissionCount} 份答卷</span></div></div>
              <div className="flex w-full min-w-0 shrink-0 items-center gap-1 overflow-x-auto overscroll-x-contain lg:w-auto">
                <button type="button" onClick={() => setQuestionnaireFilter('all')} className="flex h-9 w-9 items-center justify-center text-slate-400 lg:hidden" aria-label="返回问卷列表"><X size={18} /></button>
                {!resultsMode && <button type="button" onClick={() => { setStatsItem(null); setPublishItem(null); setShareHistoryItem(null); setSelectedSubmission(null); setEditorOpen(false); setView('management'); }} className={`h-8 px-2.5 text-xs font-medium ${view === 'management' && !statsItem && !publishItem && !shareHistoryItem && !selectedSubmission ? 'bg-primary-700 text-white' : 'text-slate-500 hover:text-slate-900'}`}>预览</button>}
                {resultsMode && <button type="button" onClick={() => { setStatsItem(null); setPublishItem(null); setSelectedSubmission(null); setEditorOpen(false); setView('submissions'); }} className={`relative h-8 px-2.5 text-xs font-medium ${view === 'submissions' && !statsItem && !publishItem && !selectedSubmission ? 'bg-primary-700 text-white' : 'text-slate-500 hover:text-slate-900'}`}>答卷{(submissionCategoryNewCounts.get(selectedQuestionnaire.id) || 0) > 0 && <span className="ml-1">{submissionCategoryNewCounts.get(selectedQuestionnaire.id)}</span>}</button>}
                {resultsMode && <button type="button" onClick={() => { setPublishItem(null); setSelectedSubmission(null); setEditorOpen(false); setStatsItem(selectedQuestionnaire); }} className={`inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium ${statsItem ? 'bg-primary-700 text-white' : 'text-slate-500 hover:text-primary-700'}`} title="统计分析"><BarChart3 size={15} />统计分析</button>}
                {!resultsMode && <button type="button" onClick={() => openEdit(selectedQuestionnaire)} className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-slate-500 hover:text-primary-700" title="编辑问卷"><Pencil size={15} />编辑</button>}
                {!resultsMode && <button type="button" onClick={() => openPublish(selectedQuestionnaire)} className={`p-2 ${publishItem ? 'text-primary-700' : 'text-slate-500 hover:text-primary-700'}`} title="分享"><Share2 size={16} /></button>}
                {!resultsMode && <button type="button" onClick={() => void openShareHistory(selectedQuestionnaire)} className={`inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium ${shareHistoryItem ? 'text-primary-700' : 'text-slate-500 hover:text-primary-700'}`} title="分享历史"><History size={15} />分享历史</button>}
                {!resultsMode && <button type="button" onClick={() => void remove(selectedQuestionnaire)} className="hidden p-2 text-slate-500 hover:text-red-600 lg:block" title="删除"><Trash2 size={16} /></button>}
              </div>
            </div>
            <div id="questionnaire-answer-pane" className="relative min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
            {resultsMode && statsItem ? <QuestionnaireStatsModal open questionnaire={statsItem} /> : !resultsMode && shareHistoryItem ? shareHistoryPage : !resultsMode && publishItem ? publishPage : !resultsMode || view === 'management' ? <div className="h-full overflow-y-auto bg-white"><div className="w-full"><QuestionnairePreview title={selectedQuestionnaire.title} description={selectedQuestionnaire.description} fields={selectedQuestionnaire.fields} /></div></div> : <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 p-3"><label className="relative min-w-48 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={submissionSearch} onChange={event => setSubmissionSearch(event.target.value)} placeholder="搜索答卷内容" className="h-9 w-full border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-primary-500" /></label><select value={submissionStatusFilter} onChange={event => setSubmissionStatusFilter(event.target.value as typeof submissionStatusFilter)} className="h-9 border border-slate-200 bg-white px-2 text-sm text-slate-600"><option value="all">全部状态</option><option value="new">新提交</option><option value="viewed">已查看</option><option value="handled">已处理</option></select><button type="button" onClick={() => void exportSubmissionInbox()} className="p-2 text-slate-500 hover:text-primary-700" title="导出"><Download size={16} /></button><button type="button" onClick={() => void loadAllSubmissions()} className="p-2 text-slate-500 hover:text-slate-900" title="刷新"><RefreshCw size={16} className={submissionsLoading ? 'animate-spin' : ''} /></button></div>
              <div className="min-h-0 flex-1 overflow-auto">{submissionsLoading ? <div className="flex h-full items-center justify-center text-sm text-slate-400"><LoaderCircle size={17} className="mr-2 animate-spin" />加载答卷...</div> : filteredSubmissions.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-sm text-slate-400"><Inbox size={28} className="mb-3 text-slate-300" />暂无答卷</div> : <div className="divide-y divide-slate-100">{filteredSubmissions.map(record => <button key={record.id} type="button" onClick={() => openSubmission(record)} onContextMenu={event => { event.preventDefault(); setSubmissionContextMenu({ record, x: event.clientX, y: event.clientY }); }} className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left text-sm hover:bg-slate-50 sm:grid-cols-[150px_minmax(0,1fr)_120px_80px] sm:gap-3 sm:py-0"><span className="col-span-2 font-mono text-xs text-slate-400 sm:col-span-1">{formatDateTime(record.submittedAt)}</span><span className="col-span-2 truncate text-slate-600 sm:col-span-1">{record.fields.slice(0, 3).map(field => answerText(record.answers[field.id])).filter(value => value !== '—').join(' · ') || '未填写内容'}</span><span className="truncate text-xs text-slate-400">{record.sourceUserName || '公共链接'}</span><span className={`justify-self-end px-2 py-1 text-xs ${submissionStatusClasses[record.status || 'new']}`}>{submissionStatusLabels[record.status || 'new']}</span></button>)}</div>}</div>
            </div>}
            </div>
          </>}
        </aside>
      </section>}

      <div className="hidden min-h-14 items-center gap-2 border border-slate-200 bg-white px-4">
        <button type="button" onClick={() => setView('submissions')} className={`relative inline-flex h-12 items-center gap-2 px-3 text-sm font-medium after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 ${view === 'submissions' ? 'text-primary-700 after:bg-primary-700' : 'text-slate-500 after:bg-transparent hover:text-slate-900'}`}><Inbox size={16} />提交记录{newSubmissionCount > 0 && <span className="flex min-w-5 items-center justify-center bg-red-500 px-1.5 text-xs text-white">{newSubmissionCount}</span>}</button>
        <button type="button" onClick={() => setView('management')} className={`relative inline-flex h-12 items-center gap-2 px-3 text-sm font-medium after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 ${view === 'management' ? 'text-primary-700 after:bg-primary-700' : 'text-slate-500 after:bg-transparent hover:text-slate-900'}`}><ClipboardList size={16} />问卷管理</button>
      </div>

      <div className="hidden">{view === 'submissions' ? (
        <section className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <div className="flex shrink-0 items-stretch gap-2 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 pt-3">
            {items.map(item => { const newCount = submissionCategoryNewCounts.get(item.id) || 0; return <button key={item.id} type="button" onClick={() => setQuestionnaireFilter(item.id)} className={`max-w-64 shrink-0 border border-b-0 px-4 py-3 text-left ${questionnaireFilter === item.id ? 'border-slate-300 bg-white text-primary-700' : 'border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-900'}`}><span className="flex items-center gap-2"><span className="min-w-0 truncate text-sm font-medium" title={item.title}>{item.title}</span>{newCount > 0 && <span className="flex min-w-5 shrink-0 items-center justify-center bg-red-500 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white" title={`${newCount} 条新提交`}>{newCount}</span>}</span><span className="mt-0.5 block text-xs tabular-nums text-slate-400">{submissionCategoryCounts.get(item.id) || 0} 条 · {item.fields.length} 个字段{newCount > 0 ? ` · ${newCount} 条未查看` : ''}</span></button>; })}
            {!items.length && <div className="px-1 pb-3 text-sm text-slate-500">暂无问卷分类</div>}
          </div>
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center">
            <label className="relative min-w-0 flex-1 xl:max-w-md"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={submissionSearch} onChange={event => setSubmissionSearch(event.target.value)} placeholder="搜索联系人、项目、回答内容" className="h-10 w-full border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-primary-600" /></label>
            <div className="min-w-0 flex-1 text-sm text-slate-500 xl:text-right">{selectedQuestionnaire ? <><span className="font-medium text-slate-800">{selectedQuestionnaire.title}</span> · 显示本问卷全部字段</> : '请先创建问卷'}</div>
            {selectedQuestionnaire && <div className="flex shrink-0 items-center gap-1"><span className="mr-1 hidden text-xs text-slate-400 2xl:inline">左右浏览字段</span><button type="button" onClick={() => scrollSubmissionTable(-1)} className="flex h-10 w-10 items-center justify-center border border-slate-300 text-slate-600 hover:bg-slate-50" aria-label="向左浏览字段" title="向左浏览字段"><ChevronLeft size={17} /></button><button type="button" onClick={() => scrollSubmissionTable(1)} className="flex h-10 w-10 items-center justify-center border border-slate-300 text-slate-600 hover:bg-slate-50" aria-label="向右浏览字段" title="向右浏览字段"><ChevronRight size={17} /></button></div>}
            <select value={submissionStatusFilter} onChange={event => setSubmissionStatusFilter(event.target.value as typeof submissionStatusFilter)} className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-primary-600"><option value="all">全部状态</option><option value="new">新提交</option><option value="viewed">已查看</option><option value="handled">已处理</option></select>
            <button type="button" onClick={() => void exportSubmissionInbox()} disabled={!filteredSubmissions.length} className="inline-flex h-10 items-center justify-center gap-2 border border-slate-300 px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Download size={15} />导出当前问卷</button>
            <button type="button" onClick={() => void loadAllSubmissions()} disabled={submissionsLoading} className="flex h-10 w-10 items-center justify-center border border-slate-300 text-slate-500 hover:bg-slate-50 disabled:opacity-40" aria-label="刷新提交记录"><RefreshCw size={16} className={submissionsLoading ? 'animate-spin' : ''} /></button>
          </div>
          <div ref={submissionTableRef} className="questionnaire-submission-scroll min-h-0 min-w-0 max-w-full flex-1 overflow-x-scroll overflow-y-auto">
            {submissionsLoading ? <div className="flex justify-center py-20 text-sm text-slate-500"><LoaderCircle className="mr-2 animate-spin" size={18} />提交记录加载中…</div> : filteredSubmissions.length === 0 ? <div className="flex flex-col items-center justify-center py-20 text-center"><Inbox size={40} className="text-slate-300" /><h2 className="mt-4 font-semibold text-slate-800">没有符合条件的提交记录</h2><p className="mt-1 text-sm text-slate-500">客户提交这份问卷后，记录会直接出现在这里。</p></div> : selectedQuestionnaire ? <table className="w-max min-w-full border-collapse text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-100 text-xs text-slate-500"><tr><th className="sticky left-0 z-20 min-w-44 border-b border-r border-slate-200 bg-slate-100 px-3 py-3 shadow-[2px_0_0_0_rgb(226_232_240)]">提交时间</th><th className="min-w-32 border-b border-r border-slate-200 bg-slate-100 px-3 py-3">来源经理</th>{selectedQuestionnaire.fields.map(field => <th key={field.id} className={`border-b border-r border-slate-200 px-3 py-3 ${field.type === 'long_text' ? 'min-w-64' : 'min-w-40'} ${field.hidden ? 'bg-slate-200/60' : ''}`}><span>{field.label}</span>{field.hidden && <span className="ml-1.5 bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-500">内部</span>}</th>)}<th className="sticky right-24 z-20 min-w-24 border-b border-l border-r border-slate-200 bg-slate-100 px-3 py-3">状态</th><th className="sticky right-0 z-20 min-w-24 border-b border-l border-slate-200 bg-slate-100 px-3 py-3 text-center">操作</th></tr></thead><tbody>{filteredSubmissions.map(record => { const status = record.status || 'new'; return <tr key={record.id} onDoubleClick={() => openSubmission(record)} className={`hover:bg-slate-50 ${status === 'new' ? 'bg-red-50/30' : ''}`}><td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-200 bg-white px-3 py-3 text-slate-500 shadow-[2px_0_0_0_rgb(226_232_240)]">{formatDateTime(record.submittedAt)}</td><td className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-3 font-medium text-slate-700">{record.sourceUserName || '公共链接'}</td>{selectedQuestionnaire.fields.map(field => { const answer = record.answers[field.id]; const isAttachment = answer && typeof answer === 'object' && !Array.isArray(answer); return <td key={field.id} className={`max-w-80 border-b border-r border-slate-200 px-3 py-3 align-top ${field.hidden ? 'bg-slate-50/60' : ''}`}><div className={field.type === 'long_text' ? 'line-clamp-3 whitespace-pre-wrap break-words' : 'truncate'} title={isAttachment ? answer.fileName : answerText(answer)}>{isAttachment ? <button type="button" onClick={() => void downloadAttachment(record.questionnaireId, record.id, field.id, answer.fileName)} className="inline-flex max-w-full items-center gap-1.5 text-primary-700 hover:underline"><Download size={14} className="shrink-0" /><span className="truncate">{answer.fileName}</span></button> : answerText(answer)}</div></td>; })}<td className="sticky right-24 z-10 whitespace-nowrap border-b border-l border-r border-slate-200 bg-white px-3 py-3"><span className={`px-2 py-1 text-xs font-medium ${submissionStatusClasses[status]}`}>{submissionStatusLabels[status]}</span></td><td className="sticky right-0 z-10 border-b border-l border-slate-200 bg-white px-3 py-3 text-center"><button type="button" onClick={() => openSubmission(record)} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 px-2.5 text-xs text-slate-700 hover:bg-slate-50"><Eye size={14} />查看</button></td></tr>; })}</tbody></table> : <div className="flex flex-col items-center justify-center py-20 text-center"><ClipboardList size={40} className="text-slate-300" /><h2 className="mt-4 font-semibold text-slate-800">还没有可查看的问卷</h2><p className="mt-1 text-sm text-slate-500">请先新建问卷，每份问卷会形成独立的提交分类。</p></div>}
          </div>
          <div className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">{selectedQuestionnaire ? `${selectedQuestionnaire.title}：` : ''}共 {filteredSubmissions.length} 条记录{filteredNewSubmissionCount > 0 ? `，${filteredNewSubmissionCount} 条新提交` : ''}</div>
        </section>
      ) : (
      <section className="flex min-h-0 flex-1 flex-col border border-slate-200 bg-white">
        <div className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 px-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {(['all', 'draft', 'published', 'closed'] as const).map(key => (
              <button key={key} type="button" onClick={() => setFilter(key)} className={`relative h-10 shrink-0 px-3 text-sm font-medium after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 ${filter === key ? 'text-primary-700 after:bg-primary-700' : 'text-slate-500 after:bg-transparent hover:text-slate-900'}`}>
                {key === 'all' ? '全部' : statusLabels[key]} <span className="ml-1 text-xs tabular-nums text-slate-400">{counts[key]}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="flex h-9 w-9 items-center justify-center border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50" aria-label="刷新"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-slate-500"><LoaderCircle className="mr-2 animate-spin" size={18} />加载中…</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center"><ClipboardList size={42} className="text-slate-300" /><h2 className="mt-4 text-base font-semibold text-slate-800">还没有问卷</h2><p className="mt-1 text-sm text-slate-500">新建一份问卷，发布后即可复制链接发给客户。</p><button type="button" onClick={openNew} className="mt-5 inline-flex h-10 items-center gap-2 border border-primary-700 px-4 text-sm font-medium text-primary-700 hover:bg-primary-50"><FilePlus2 size={16} />新建问卷</button></div>
        ) : (
          <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map(item => (
              <article key={item.id} className="flex min-h-64 flex-col border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3"><span className={`px-2 py-1 text-xs font-medium ${statusClasses[item.status]}`}>{statusLabels[item.status]}</span><span className="text-xs text-slate-400">{item.fields.length} 项</span></div>
                <h2 className="mt-4 line-clamp-2 text-lg font-semibold text-slate-900">{item.title}</h2>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{item.description || '未填写问卷说明'}</p>
                <div className="mt-auto flex items-end justify-between gap-3 pt-6"><div><div className="text-2xl font-semibold tabular-nums text-slate-900">{item.submissionCount}</div><div className="mt-0.5 text-xs text-slate-400">答卷记录</div></div><div className="text-right text-xs text-slate-400"><div>{item.createdByName || '未知创建人'}</div><div className="mt-1">{formatDateTime(item.updatedAt)}</div></div></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  <button type="button" onClick={() => void openResponses(item)} className="inline-flex h-8 items-center gap-1.5 border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50"><Eye size={14} />答卷</button>
                  <button type="button" onClick={() => setStatsItem(item)} className="inline-flex h-8 items-center gap-1.5 border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50"><BarChart3 size={14} />统计</button>
                  <button type="button" onClick={() => openEdit(item)} className="inline-flex h-8 items-center gap-1.5 border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-slate-50"><Pencil size={14} />编辑</button>
                  {item.status === 'draft' && <button type="button" onClick={() => openPublish(item)} className="inline-flex h-8 items-center gap-1.5 bg-primary-700 px-2.5 text-xs text-white hover:bg-primary-800"><Send size={14} />发布</button>}
                  {item.status === 'published' && <button type="button" onClick={() => openPublish(item)} className="inline-flex h-8 items-center gap-1.5 bg-primary-700 px-2.5 text-xs text-white hover:bg-primary-800"><Share2 size={14} />分享</button>}
                  {item.status === 'closed' && <button type="button" onClick={() => openPublish(item)} className="inline-flex h-8 items-center gap-1.5 border border-emerald-200 px-2.5 text-xs text-emerald-700 hover:bg-emerald-50">重新开放</button>}
                  <button type="button" onClick={() => void remove(item)} className="ml-auto flex h-8 w-8 items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="删除问卷"><Trash2 size={14} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      )}</div>

      <AppModal open={templateOpen} onClose={() => setTemplateOpen(false)} title="选择问卷模板" subtitle="选择一个模板快速开始，也可以从空白创建。" size="xl" fillContent scopeId="questionnaire-content-scope" panelClassName="worklog-create-panel !border-0" bodyClassName="overflow-y-auto bg-slate-50">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {QUESTIONNAIRE_TEMPLATES.map(template => {
            const Icon = templateIconMap[template.icon] || FilePlus2;
            return (
              <button key={template.id} type="button" onClick={() => applyTemplate(template.id)} className="group flex items-start gap-3 border border-slate-200 bg-white p-4 text-left transition hover:border-primary-600 hover:shadow-sm">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><Icon size={22} /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{template.name}<span className="text-xs font-normal text-slate-400">{template.fields.length ? `${template.fields.length} 道题` : ''}</span></span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{template.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </AppModal>

      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} width={176} onClose={() => setContextMenu(null)} items={[
        { key: 'rename', label: '重命名', icon: <Pencil size={14} />, onSelect: () => openRename(contextMenu.item) },
        { key: 'edit', label: '编辑', icon: <ClipboardList size={14} />, onSelect: () => openEdit(contextMenu.item) },
        ...(contextMenu.item.status === 'published' ? [{ key: 'close', label: '关闭问卷', icon: <Ban size={14} />, separatorBefore: true, onSelect: () => void closeQuestionnaire(contextMenu.item) }] : []),
        ...(contextMenu.item.status === 'closed' ? [{ key: 'reopen', label: '重新开放', icon: <Send size={14} />, separatorBefore: true, onSelect: () => void reopenQuestionnaire(contextMenu.item) }] : []),
        { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => void remove(contextMenu.item) },
      ]} />}
      {submissionContextMenu && <ContextMenu x={submissionContextMenu.x} y={submissionContextMenu.y} width={176} ariaLabel="答卷菜单" onClose={() => setSubmissionContextMenu(null)} items={[
        { key: 'delete', label: '删除', icon: <Trash2 size={14} />, danger: true, onSelect: () => void removeSubmission(submissionContextMenu.record) },
      ]} />}

      <AppModal
        open={Boolean(renameItem)}
        onClose={() => { if (!renaming) setRenameItem(null); }}
        title="重命名问卷"
        size="sm"
        footer={<>
          <button type="button" disabled={renaming} onClick={() => setRenameItem(null)} className="h-10 border border-slate-300 px-4 text-sm text-slate-700 disabled:opacity-50">取消</button>
          <button type="submit" form="questionnaire-rename-form" disabled={renaming || !renameTitle.trim()} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white disabled:opacity-50">{renaming ? '保存中…' : '保存'}</button>
        </>}
      >
        <form id="questionnaire-rename-form" onSubmit={renameQuestionnaire}>
          <label className="block text-xs font-medium text-slate-500">问卷名称</label>
          <input autoFocus value={renameTitle} onChange={event => setRenameTitle(event.target.value)} maxLength={120} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary-500" />
        </form>
      </AppModal>

      <QuestionnaireVisualEditor open={editorOpen} editing={Boolean(copyingFrom)} standalone={standaloneEditor} title={title} description={description} thankYouMessage={thankYouMessage} fields={fields} saving={saving || savingAs} hasUnsavedChanges={editorDirty} onTitleChange={value => { setTitle(value); setEditorDirty(true); }} onDescriptionChange={value => { setDescription(value); setEditorDirty(true); }} onThankYouMessageChange={value => { setThankYouMessage(value); setEditorDirty(true); }} onFieldsChange={setFieldsWithHistory} onClose={() => void closeEditor()} onPreview={() => setPreviewOpen(true)} onSave={save} onSaveAs={openSaveAs} onUndo={undoFields} onRedo={redoFields} />

      <AppModal
        open={saveAsOpen}
        onClose={() => { if (!savingAs) setSaveAsOpen(false); }}
        title="另存为新问卷"
        subtitle="当前内容将保存为一份独立草稿，原问卷保持不变。"
        size="sm"
        footer={<>
          <button type="button" disabled={savingAs} onClick={() => setSaveAsOpen(false)} className="h-10 border border-slate-300 px-4 text-sm text-slate-700 disabled:opacity-50">取消</button>
          <button type="submit" form="questionnaire-save-as-form" disabled={savingAs || !saveAsTitle.trim()} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white disabled:opacity-50">{savingAs ? '保存中…' : '另存为'}</button>
        </>}
      >
        <form id="questionnaire-save-as-form" onSubmit={saveAsQuestionnaire}>
          <label className="block text-xs font-medium text-slate-500">新问卷名称</label>
          <input autoFocus value={saveAsTitle} onChange={event => setSaveAsTitle(event.target.value)} maxLength={120} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none" />
        </form>
      </AppModal>

      <AppModal open={previewOpen} onClose={() => setPreviewOpen(false)} title="预览问卷" subtitle="可以实际选择选项，检查条件题目的显示效果。" size="full" fillContent bodyClassName="overflow-y-auto bg-slate-100 p-5" footer={<button type="button" onClick={() => setPreviewOpen(false)} className="h-10 bg-primary-700 px-5 text-sm font-medium text-white">返回编辑</button>}>
        <div className="mb-5 flex justify-center"><div className="inline-flex border border-slate-300 bg-white p-1"><button type="button" onClick={() => setPreviewMode('desktop')} className={`inline-flex h-9 items-center gap-2 px-4 text-sm ${previewMode === 'desktop' ? 'bg-primary-700 text-white' : 'text-slate-600'}`}><Monitor size={15} />电脑</button><button type="button" onClick={() => setPreviewMode('mobile')} className={`inline-flex h-9 items-center gap-2 px-4 text-sm ${previewMode === 'mobile' ? 'bg-primary-700 text-white' : 'text-slate-600'}`}><Smartphone size={15} />手机</button></div></div>
        <div className={`mx-auto transition-all ${previewMode === 'mobile' ? 'max-w-[390px]' : 'max-w-2xl'}`}><QuestionnairePreview title={title} description={description} fields={fields} compact={previewMode === 'mobile'} /></div>
      </AppModal>

      {ConfirmDialog}
    </div>
  );
}
