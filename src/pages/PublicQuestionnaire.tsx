import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, FileX2, LoaderCircle, RotateCcw, Star } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import type { QuestionnaireField } from '../types/questionnaire';
import { visibleQuestionnaireFields } from '../utils/questionnaireVisibility';
import { MobileDateInput, MobileNumberInput } from '../components/MobileWheelPicker';

interface PublicQuestionnaireData {
  title: string;
  description: string;
  fields: QuestionnaireField[];
  thankYouMessage?: string;
}

async function publicRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/questionnaires${path}`, {
    ...options,
    headers: options?.body instanceof FormData
      ? options.headers
      : { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

function AttachmentInput({ value, required, onSelect }: {
  value: File | undefined;
  required: boolean;
  onSelect: (file: File | undefined) => void;
}) {
  const previewUrl = useMemo(() => {
    if (!value) return '';
    if (!value.type.startsWith('image/')) return '';
    try { return URL.createObjectURL(value); } catch (_) { return ''; }
  }, [value]);

  useEffect(() => () => {
    if (previewUrl) try { URL.revokeObjectURL(previewUrl); } catch (_) { /* ignore */ }
  }, [previewUrl]);

  if (value) {
    const isImage = value.type.startsWith('image/');
    return (
      <div className="border border-slate-200 bg-slate-50">
        <div className="flex items-start gap-3 p-3">
          {isImage && previewUrl
            ? <img src={previewUrl} alt={value.name} className="h-16 w-16 shrink-0 border border-slate-200 object-cover" />
            : <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-slate-100 text-slate-400"><FileX2 size={22} /></div>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-800">{value.name}</div>
            <div className="mt-0.5 text-xs text-slate-400">{Math.max(1, Math.round(value.size / 1024))} KB</div>
            <button type="button" onClick={() => onSelect(undefined)} className="mt-2 inline-flex items-center gap-1 text-xs text-red-600 hover:underline">
              <RotateCcw size={12} />重新选择
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-center hover:border-primary-500 hover:bg-primary-50/30">
      <input required={required} type="file" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) onSelect(file); }} />
      <span className="text-sm font-medium text-slate-700">选择附件</span>
      <span className="mt-1 text-xs text-slate-400">单个文件不超过 20MB，不支持可执行文件或脚本</span>
    </label>
  );
}

function RatingInput({ value, max, required, onChange }: {
  value: number;
  max: number;
  required: boolean;
  onChange: (score: number) => void;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {Array.from({ length: max }, (_, i) => i + 1).map(score => (
          <button
            key={score}
            type="button"
            aria-label={`${score} 分`}
            onClick={() => onChange(score)}
            onMouseEnter={() => setHover(score)}
            onMouseLeave={() => setHover(0)}
            className={`flex h-11 w-11 items-center justify-center rounded-md border text-sm transition ${score <= active ? 'border-amber-400 bg-amber-50 text-amber-500' : 'border-slate-200 bg-white text-slate-300 hover:border-amber-300'}`}
          >
            {max > 5 ? <span className="tabular-nums">{score}</span> : <Star size={20} className={score <= active ? 'fill-amber-400 text-amber-400' : ''} />}
          </button>
        ))}
        <input type="hidden" required={required && value === 0} value={value} onChange={() => undefined} />
      </div>
      <div className="mt-2 text-xs text-slate-400">{value ? `已选择 ${value} 分` : max > 5 ? '请选择 1 到 10 分（NPS 推荐度）' : '请点击星级评分'}</div>
    </div>
  );
}

export default function PublicQuestionnaire() {
  const { token = '' } = useParams();
  const location = useLocation();
  const shareToken = useMemo(() => new URLSearchParams(location.search).get('share') || '', [location.search]);
  const [questionnaire, setQuestionnaire] = useState<PublicQuestionnaireData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const questionnaireExpired = loadError === '问卷已失效';

  useEffect(() => {
    const previousTitle = document.title;
    const questionnaireTitle = String(questionnaire?.title || '').trim();
    document.title = questionnaireTitle ? `${questionnaireTitle}｜问卷收集` : '问卷收集';
    return () => {
      document.title = previousTitle;
    };
  }, [questionnaire?.title]);

  // 客户端持久标识（幂等 + 服务端草稿）：跨设备可在同一浏览器内续填
  const clientKey = useMemo(() => {
    let key = '';
    try { key = localStorage.getItem('questionnaire-client-key') || ''; } catch (_) { /* ignore */ }
    if (!key) {
      key = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      try { localStorage.setItem('questionnaire-client-key', key); } catch (_) { /* ignore */ }
    }
    return key;
  }, []);

  // A submission key belongs to this answer attempt, not to the browser.
  // Keeping it stable for the mounted page still protects against double-clicks
  // and network retries, while a fresh visit can submit another response.
  const submissionAttemptKey = useMemo(() => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_) { /* fall back below */ }
    return `answer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }, [token]);

  useEffect(() => {
    setLoading(true);
    publicRequest<{ questionnaire: PublicQuestionnaireData }>(`/public/${encodeURIComponent(token)}`)
      .then(async result => {
        setQuestionnaire(result.questionnaire);
        // 优先恢复服务端草稿（跨设备），其次本地草稿
        try {
          const draftResult = await publicRequest<{ draft: { answers: Record<string, string | string[]>; updatedAt: string } | null }>(
            `/public/${encodeURIComponent(token)}/draft?clientKey=${encodeURIComponent(clientKey)}`,
          );
          if (draftResult.draft?.answers) {
            setAnswers(draftResult.draft.answers);
            return;
          }
        } catch (_) { /* 服务端草稿不可用时回退本地 */ }
        try {
          const saved = localStorage.getItem(`questionnaire-draft:${token}`);
          if (saved) setAnswers(JSON.parse(saved));
        } catch (_) { /* ignore invalid local draft */ }
      })
      .catch(reason => setLoadError(reason instanceof Error ? reason.message : '问卷加载失败'))
      .finally(() => setLoading(false));
  }, [token, clientKey]);

  // 草稿防抖同步：本地 + 服务端（跨设备续填）
  useEffect(() => {
    if (!questionnaire || submitted) return;
    try { localStorage.setItem(`questionnaire-draft:${token}`, JSON.stringify(answers)); } catch (_) { /* storage unavailable */ }
    const timer = window.setTimeout(() => {
      publicRequest(`/public/${encodeURIComponent(token)}/draft`, {
        method: 'PUT',
        body: JSON.stringify({ clientKey, answers }),
      }).catch(() => { /* 草稿同步失败不影响主流程 */ });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [answers, clientKey, questionnaire, submitted, token]);

  const visibleFields = useMemo(
    () => questionnaire ? visibleQuestionnaireFields(questionnaire.fields, answers) : [],
    [answers, questionnaire],
  );

  const requiredCount = useMemo(
    () => visibleFields.filter(field => field.type !== 'section_break' && field.required).length,
    [visibleFields],
  );
  const questionCount = useMemo(
    () => visibleFields.filter(field => field.type !== 'section_break').length,
    [visibleFields],
  );
  const questionNumbers = useMemo(() => {
    const result = new Map<string, number>();
    let number = 0;
    visibleFields.forEach(field => {
      if (field.type !== 'section_break') result.set(field.id, ++number);
    });
    return result;
  }, [visibleFields]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const body = new FormData();
      body.set('answers', JSON.stringify(answers));
      if (shareToken) body.set('shareToken', shareToken);
      // 幂等键：防止客户双击或网络重试产生重复提交
      body.set('idempotencyKey', `${token}:${submissionAttemptKey}:${shareToken.slice(-16)}`);
      Object.entries(files).forEach(([fieldId, file]) => { if (file) body.set(fieldId, file); });
      await publicRequest(`/public/${encodeURIComponent(token)}/submissions`, {
        method: 'POST',
        body,
      });
      setSubmitted(true);
      try { localStorage.removeItem(`questionnaire-draft:${token}`); } catch (_) { /* ignore */ }
      // 清空服务端草稿
      publicRequest(`/public/${encodeURIComponent(token)}/draft`, {
        method: 'PUT',
        body: JSON.stringify({ clientKey, answers: {} }),
      }).catch(() => { /* ignore */ });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="flex items-center gap-3 text-sm text-slate-500"><LoaderCircle className="animate-spin" size={20} />问卷加载中…</div>
    </main>
  );

  if (!questionnaire || loadError) return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ClipboardList className="mx-auto text-slate-300" size={40} />
        <h1 className="mt-4 text-xl font-semibold text-slate-900">{questionnaireExpired ? '问卷已失效' : '暂时无法填写'}</h1>
        <p className="mt-2 text-sm text-slate-500">{questionnaireExpired ? '该问卷已关闭，无法继续填写或提交。' : loadError || '问卷不存在或尚未发布'}</p>
      </section>
    </main>
  );

  if (submitted) return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-lg border border-slate-200 bg-white p-10 text-center shadow-sm">
        <CheckCircle2 className="mx-auto text-emerald-600" size={48} />
        <h1 className="mt-5 text-2xl font-semibold text-slate-900">提交成功</h1>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{questionnaire.thankYouMessage || '感谢您的填写，相关信息已安全提交。'}</p>
      </section>
    </main>
  );

  const setValue = (fieldId: string, value: string | string[]) => {
    setAnswers(current => ({ ...current, [fieldId]: value }));
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:py-12">
      <form onSubmit={submit} className="mx-auto w-full max-w-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-t-4 border-primary-700 px-6 py-7 sm:px-9">
          <div className="mb-4 flex h-11 w-11 items-center justify-center bg-primary-50 text-primary-700"><ClipboardList size={23} /></div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{questionnaire.title}</h1>
          {questionnaire.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{questionnaire.description}</p>}
          <p className="mt-4 text-xs text-slate-400">当前显示 {questionCount} 项{requiredCount ? `，其中 ${requiredCount} 项必填` : ''}</p>
        </header>

        <div className="space-y-7 border-t border-slate-200 px-6 py-7 sm:px-9">
          {visibleFields.map(field => {
            if (field.type === 'section_break') return (
              <section key={field.id} className="border border-primary-100 bg-primary-50/40 px-4 py-3">
                <h2 className="text-sm font-semibold text-primary-800">{field.label || '信息分组'}</h2>
                {field.description && <p className="mt-1 text-xs leading-5 text-primary-600/80">{field.description}</p>}
              </section>
            );
            const value = answers[field.id];
            return (
              <section key={field.id}>
                <label className="mb-2.5 block text-sm font-medium text-slate-800">
                  <span className="mr-2 text-slate-400">{questionNumbers.get(field.id)}.</span>{field.label}
                  {field.required && <span className="ml-1 text-red-500">*</span>}
                </label>
                {field.description && <p className="mb-2.5 text-xs leading-5 text-slate-500">{field.description}</p>}
                {field.type === 'long_text' ? (
                  <textarea required={field.required} value={String(value || '')} onChange={event => setValue(field.id, event.target.value)} placeholder={field.placeholder} rows={4} className="w-full border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-primary-600 focus:ring-1 focus:ring-primary-600" />
                ) : field.type === 'single_choice' && field.optionDisplay === 'dropdown' ? (
                  <select required={field.required} value={String(value || '')} onChange={event => setValue(field.id, event.target.value)} className="h-11 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary-600"><option value="">请选择</option>{field.options.map(option => <option key={option}>{option}</option>)}</select>
                ) : field.type === 'single_choice' ? (
                  <div className={field.optionDisplay === 'horizontal' ? 'flex flex-wrap gap-2.5' : 'space-y-2.5'}>{field.options.map(option => <label key={option} className="flex cursor-pointer items-center gap-3 border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"><input required={field.required} type="radio" name={field.id} value={option} checked={value === option} onChange={() => setValue(field.id, option)} className="accent-primary-700" />{option}</label>)}</div>
                ) : field.type === 'multiple_choice' ? (
                  <div className={field.optionDisplay === 'horizontal' ? 'flex flex-wrap gap-2.5' : 'space-y-2.5'}>{field.options.map(option => {
                    const selected = Array.isArray(value) ? value : [];
                    return <label key={option} className="flex cursor-pointer items-center gap-3 border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" value={option} checked={selected.includes(option)} onChange={event => setValue(field.id, event.target.checked ? [...selected, option] : selected.filter(item => item !== option))} className="accent-primary-700" />{option}</label>;
                  })}</div>
                ) : field.type === 'attachment' ? (
                  <AttachmentInput
                    value={files[field.id]}
                    required={field.required}
                    onSelect={(file) => setFiles(current => ({ ...current, [field.id]: file }))}
                  />
                ) : field.type === 'rating' ? (
                  <RatingInput
                    value={value ? Number(value) : 0}
                    max={field.ratingMax || 5}
                    required={field.required}
                    onChange={(score) => setValue(field.id, String(score))}
                  />
                ) : field.type === 'date' ? (
                  <MobileDateInput
                    required={field.required}
                    value={String(value || '')}
                    onChange={nextValue => setValue(field.id, nextValue)}
                    title={field.label || '选择日期'}
                    placeholder={field.placeholder}
                    className="h-11 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-primary-600 focus:ring-1 focus:ring-primary-600"
                  />
                ) : field.type === 'number' ? (
                  <MobileNumberInput
                    required={field.required}
                    value={String(value || '')}
                    onChange={nextValue => setValue(field.id, nextValue)}
                    title={field.label || '数字'}
                    placeholder={field.placeholder}
                    className="h-11 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-primary-600 focus:ring-1 focus:ring-primary-600"
                  />
                ) : (
                  <input
                    required={field.required}
                    type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                    value={String(value || '')}
                    onChange={event => setValue(field.id, event.target.value)}
                    placeholder={field.placeholder}
                    className="h-11 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-primary-600 focus:ring-1 focus:ring-primary-600"
                  />
                )}
              </section>
            );
          })}
          {error && <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </div>

        <div className="border-t border-slate-100 px-6 py-3 text-center text-xs text-slate-400 sm:px-9">填写内容会自动保存在当前浏览器；附件需重新选择。</div>

        <footer className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:px-9">
          <button type="submit" disabled={submitting} className="inline-flex h-11 min-w-28 items-center justify-center gap-2 bg-primary-700 px-5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-60">
            {submitting && <LoaderCircle className="animate-spin" size={16} />}{submitting ? '正在提交' : '提交问卷'}
          </button>
        </footer>
      </form>
    </main>
  );
}
