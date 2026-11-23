import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlignLeft, ArrowDown, ArrowUp, CalendarDays, Check, CheckSquare, ChevronRight, CircleDot, Copy, Eye, Hash, Mail, Paperclip, Phone, Plus, Redo2, Settings2, Sparkles, Star, Trash2, Type, Undo2, X, FileText,
} from 'lucide-react';
import AppModal from '../Layout/AppModal';
import type { QuestionnaireField, QuestionnaireFieldType } from '../../types/questionnaire';
import { generateId } from '../../utils/id';

export const questionnaireTypeLabels: Record<QuestionnaireFieldType, string> = {
  short_text: '单行文字', long_text: '多行文字', single_choice: '单选', multiple_choice: '多选',
  number: '数字', date: '日期', phone: '电话号码', email: '电子邮箱', attachment: '文件上传', rating: '评分', section_break: '分组标题',
};

const typeIcons: Record<QuestionnaireFieldType, typeof Type> = {
  short_text: Type, long_text: AlignLeft, single_choice: CircleDot, multiple_choice: CheckSquare,
  number: Hash, date: CalendarDays, phone: Phone, email: Mail, attachment: Paperclip, rating: Star, section_break: FileText,
};

interface Props {
  open: boolean;
  editing: boolean;
  standalone?: boolean;
  title: string;
  description: string;
  thankYouMessage: string;
  fields: QuestionnaireField[];
  saving: boolean;
  hasUnsavedChanges: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onThankYouMessageChange: (value: string) => void;
  onFieldsChange: (fields: QuestionnaireField[]) => void;
  onClose: () => void;
  onPreview: () => void;
  onSave: (event: FormEvent) => void;
  onSaveAs?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

function makeField(type: QuestionnaireFieldType): QuestionnaireField {
  return {
    id: generateId(), label: type === 'section_break' ? '新分组' : '未命名问题', type, required: false, options: ['single_choice', 'multiple_choice'].includes(type) ? ['选项一', '选项二'] : [],
    description: '', placeholder: '', hidden: false, defaultValue: '', visibility: null, optionDisplay: 'vertical',
    ratingMax: type === 'rating' ? 5 : undefined,
  };
}

function InlineFieldEditor({ field, editingTarget, onEdit, onUpdate }: {
  field: QuestionnaireField;
  editingTarget: string;
  onEdit: (target: string) => void;
  onUpdate: (patch: Partial<QuestionnaireField>) => void;
}) {
  if (field.hidden) {
    return (
      <div className="flex items-center gap-2">
        <input value={field.defaultValue || ''} onChange={event => onUpdate({ defaultValue: event.target.value })} placeholder="内部默认值" className="h-9 w-full border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-primary-500" />
      </div>
    );
  }
  switch (field.type) {
    case 'single_choice':
    case 'multiple_choice': {
      const horizontal = field.optionDisplay === 'horizontal';
      const list = horizontal ? 'flex flex-wrap items-start gap-x-4 gap-y-2' : 'space-y-1.5';
      const addOption = () => { onUpdate({ options: [...field.options, `选项 ${field.options.length + 1}`] }); };
      return (
        <div>
          <div className={list}>
            {field.options.map((option, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                {field.type === 'multiple_choice'
                  ? <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-slate-300 bg-white"><span className="h-1.5 w-1.5 bg-white" /></span>
                  : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300 bg-white" />}
                {editingTarget === `${field.id}:opt-${i}` ? (
                  <input autoFocus value={option} onChange={event => { const options = [...field.options]; options[i] = event.target.value; onUpdate({ options }); }} onBlur={() => onEdit('')} onKeyDown={event => { if (event.key === 'Enter') { onEdit(''); event.preventDefault(); } if (event.key === 'Backspace' && !option && field.options.length > 1) { const options = field.options.filter((_, idx) => idx !== i); onUpdate({ options }); } }} className="w-40 border border-primary-300 px-1 py-0.5 outline-none" />
                ) : (
                  <span onClick={event => { event.stopPropagation(); onEdit(`${field.id}:opt-${i}`); }} className="min-w-6 cursor-text rounded px-1 hover:bg-slate-100">{option}</span>
                )}
                {field.options.length > 1 && <button type="button" onClick={() => onUpdate({ options: field.options.filter((_, idx) => idx !== i) })} className="text-slate-300 hover:text-red-500">×</button>}
              </div>
            ))}
          </div>
          <button type="button" onClick={addOption} className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-primary-600"><Plus size={13} />添加选项</button>
        </div>
      );
    }
    case 'rating': {
      const max = field.ratingMax || 5;
      return (
        <div className="flex flex-wrap items-center gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map(score => (
            <span key={score} className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-300">{max > 5 ? <span className="text-xs tabular-nums">{score}</span> : <Star size={15} />}</span>
          ))}
          <select value={max} onChange={event => onUpdate({ ratingMax: Number(event.target.value) })} className="ml-2 border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-500 outline-none"><option value={5}>5 分</option><option value={10}>10 分 (NPS)</option></select>
        </div>
      );
    }
    case 'long_text':
      return <input value={field.placeholder || ''} onChange={event => onUpdate({ placeholder: event.target.value })} placeholder="多行文本提示" className="h-14 w-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-primary-500" />;
    case 'date':
      return <input value={field.placeholder || ''} onChange={event => onUpdate({ placeholder: event.target.value })} placeholder="选择日期" className="h-9 w-full border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-primary-500" />;
    case 'attachment':
      return <div className="flex h-9 items-center justify-center gap-1.5 border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400"><Paperclip size={13} />选择附件</div>;
    case 'number':
    case 'phone':
    case 'email':
    case 'short_text':
      return <input value={field.placeholder || ''} onChange={event => onUpdate({ placeholder: event.target.value })} placeholder={questionnaireTypeLabels[field.type]} className="h-9 w-full border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-primary-500" />;
    default:
      return <input value={field.placeholder || ''} onChange={event => onUpdate({ placeholder: event.target.value })} placeholder={questionnaireTypeLabels[field.type]} className="h-9 w-full border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-primary-500" />;
  }
}

export default function QuestionnaireVisualEditor(props: Props) {
  const { open, fields, onFieldsChange } = props;
  const [selectedId, setSelectedId] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragType, setDragType] = useState<QuestionnaireFieldType | null>(null);
  const [editing, setEditing] = useState<string>('');
  const [expandVis, setExpandVis] = useState<string>('');
  const [stage, setStage] = useState<1 | 2 | 3>(2);
  const [slashOpen, setSlashOpen] = useState(false);
  const [deletedField, setDeletedField] = useState<{ field: QuestionnaireField; index: number } | null>(null);
  const [previewPane, setPreviewPane] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open) setSelectedId(fields[0]?.id || ''); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedIndex = fields.findIndex(field => field.id === selectedId);
  const getSourceFieldsFor = (index: number) => fields.slice(0, Math.max(0, index)).filter(field => !field.hidden && field.type !== 'section_break');
  const getSourceFieldFor = (field: QuestionnaireField) => getSourceFieldsFor(fields.findIndex(item => item.id === field.id)).find(item => item.id === field.visibility?.fieldId) || null;

  const updateField = (id: string, updates: Partial<QuestionnaireField>) => {
    onFieldsChange(fields.map(field => field.id === id ? { ...field, ...updates } : field));
  };
  const add = (type: QuestionnaireFieldType) => {
    const field = makeField(type);
    const next = [...fields];
    const insertionIndex = selectedIndex >= 0 ? selectedIndex + 1 : fields.length;
    next.splice(insertionIndex, 0, field);
    onFieldsChange(next);
    setSelectedId(field.id);
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onFieldsChange(next.map((field, fieldIndex) => {
      if (!field.visibility) return field;
      const sourceIndex = next.findIndex(item => item.id === field.visibility?.fieldId);
      return sourceIndex >= 0 && sourceIndex < fieldIndex ? field : { ...field, visibility: null };
    }));
  };
  const remove = (id: string) => {
    const next = fields.filter(field => field.id !== id).map(field => field.visibility?.fieldId === id ? { ...field, visibility: null } : field);
    onFieldsChange(next);
    setSelectedId(next[Math.max(0, selectedIndex - 1)]?.id || '');
  };
  const requestRemove = (field: QuestionnaireField) => {
    const index = fields.findIndex(item => item.id === field.id);
    setDeletedField({ field, index });
    remove(field.id);
  };
  const restoreDeleted = () => {
    if (!deletedField) return;
    const next = [...fields];
    next.splice(Math.min(deletedField.index, next.length), 0, deletedField.field);
    onFieldsChange(next); setSelectedId(deletedField.field.id); setDeletedField(null);
  };
  const duplicate = (index: number) => {
    const field = fields[index];
    if (!field) return;
    const copy = { ...field, id: generateId(), label: `${field.label}（副本）` };
    const next = [...fields];
    next.splice(index + 1, 0, copy);
    onFieldsChange(next);
    setSelectedId(copy.id);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      props.onUndo?.();
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      props.onRedo?.();
    }
  };
  const onDrop = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) { setDragIndex(null); return; }
    const next = [...fields];
    const [dragged] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, dragged);
    onFieldsChange(next.map((field, fieldIndex) => {
      if (!field.visibility) return field;
      const sourceIndex = next.findIndex(item => item.id === field.visibility?.fieldId);
      return sourceIndex >= 0 && sourceIndex < fieldIndex ? field : { ...field, visibility: null };
    }));
    setSelectedId(dragged.id);
    setDragIndex(null);
  };
  const insertTypeAt = (targetIndex: number, type: QuestionnaireFieldType) => {
    const field = makeField(type);
    const next = [...fields];
    next.splice(targetIndex, 0, field);
    onFieldsChange(next);
    setSelectedId(field.id);
    requestAnimationFrame(() => document.getElementById(`questionnaire-field-${field.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const dropNewAtEnd = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (dragType) { add(dragType); setDragType(null); }
  };

  const selectedField = selectedIndex >= 0 ? fields[selectedIndex] : null;
  const issues = useMemo(() => {
    const result: { id: string; text: string }[] = [];
    if (!props.title.trim()) result.push({ id: 'title', text: '填写问卷标题' });
    if (!fields.length) result.push({ id: 'fields', text: '至少添加一道题目' });
    fields.forEach(field => {
      if (!field.label.trim()) result.push({ id: field.id, text: '存在未填写标题的题目' });
      if (['single_choice', 'multiple_choice'].includes(field.type) && !field.options.filter(Boolean).length) result.push({ id: field.id, text: `“${field.label || '未命名问题'}”需要选项` });
    });
    return result;
  }, [fields, props.title]);

  return <>
    <AppModal open={open} onClose={props.onClose} showClose={false} size="xl" fillContent pageMode={props.standalone} scopeId={props.standalone ? undefined : 'questionnaire-content-scope'} backdrop="none" panelClassName="worklog-create-panel !border-0" bodyClassName="overflow-hidden !p-0">
      <form id="questionnaire-visual-editor" onSubmit={props.onSave} onKeyDown={onKeyDown} className="grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-[72px_auto_minmax(0,1fr)_auto] bg-slate-50 lg:grid-cols-[220px_minmax(440px,1fr)_300px] lg:grid-rows-[72px_minmax(0,1fr)]">
        <header className="col-span-full flex min-w-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="flex min-w-0 items-center gap-4">
            <button type="button" onClick={props.onClose} className="flex h-9 w-9 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="返回"><X size={18} /></button>
            <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-900">{props.title || '未命名问卷'}</span><span className={`text-[11px] ${props.hasUnsavedChanges ? 'text-amber-600' : 'text-slate-400'}`}>{props.saving ? '保存中…' : props.hasUnsavedChanges ? '有未保存更改' : '已保存'}</span></div><div className="mt-1 text-[11px] text-slate-400">{props.editing ? '编辑原问卷' : '新建问卷'} · {fields.length} 道题</div></div>
          </div>
          <nav className="hidden items-center gap-1 lg:flex">{([{ n: 1, label: '基础信息' }, { n: 2, label: '设计问卷' }, { n: 3, label: '检查发布' }] as const).map(item => <button key={item.n} type="button" onClick={() => setStage(item.n)} className={`flex h-9 items-center gap-2 px-3 text-xs ${stage === item.n ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-500 hover:bg-slate-50'}`}><span className={`flex h-5 w-5 items-center justify-center border text-[10px] ${stage > item.n ? 'border-primary-600 bg-primary-600 text-white' : stage === item.n ? 'border-primary-600 text-primary-700' : 'border-slate-300'}`}>{stage > item.n ? <Check size={12} /> : item.n}</span>{item.label}<ChevronRight size={13} className="text-slate-300" /></button>)}</nav>
          <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => setPreviewPane(value => !value)} className="inline-flex h-9 items-center gap-1.5 border border-slate-200 px-3 text-xs text-slate-600 hover:border-primary-400 hover:text-primary-700"><Eye size={15} />预览</button>{props.editing && <button type="button" onClick={props.onSaveAs} className="hidden h-9 border border-slate-200 px-3 text-xs text-slate-600 hover:text-primary-700 sm:block">另存为</button>}<button type="submit" disabled={props.saving || issues.length > 0} className="h-9 bg-primary-700 px-4 text-xs font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-45">{props.saving ? '保存中…' : issues.length ? `待完善 ${issues.length} 项` : '保存并完成'}</button></div>
        </header>
        <aside className="questionnaire-editor-scrollbar-hidden min-h-0 min-w-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-white px-3 py-2 lg:overflow-x-hidden lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-4 lg:py-4">
          <div className="mx-auto w-full">
          <div className="mb-3"><div className="text-xs font-semibold text-slate-800">添加内容</div><div className="mt-1 text-[11px] leading-5 text-slate-400">点击题型插入到当前题目后，也可拖到画布指定位置。</div></div>
          <button type="button" onClick={() => { if (!fields.length) { const field = makeField('short_text'); onFieldsChange([field]); setSelectedId(field.id); } }} className="mb-3 hidden w-full items-center gap-2 border border-primary-200 bg-primary-50 px-3 py-2.5 text-left text-xs font-medium text-primary-700 lg:flex"><Sparkles size={15} />开始引导</button>
          <div className="grid w-max grid-flow-col auto-cols-[88px] justify-items-stretch gap-2 lg:w-full lg:grid-flow-row lg:grid-cols-2 lg:auto-cols-auto">{(Object.keys(questionnaireTypeLabels) as QuestionnaireFieldType[]).map(type => { const Icon = typeIcons[type]; return <button key={type} type="button" draggable onClick={() => add(type)} onDragStart={event => { setDragType(type); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => setDragType(null)} className="flex min-h-16 w-full min-w-0 cursor-grab flex-col items-center justify-center gap-1.5 border border-slate-200 bg-white px-1 text-center text-xs text-slate-600 hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 active:cursor-grabbing"><Icon size={17} /><span className="max-w-full truncate">{questionnaireTypeLabels[type]}</span></button>; })}</div>
          </div>
        </aside>

        <main ref={scrollRef} className="questionnaire-editor-scrollbar-hidden min-h-0 min-w-0 overflow-y-auto bg-slate-100/70">
          <div className="w-full bg-white">
            <header className="border-t-4 border-primary-700 px-7 py-6">
              <input value={props.title} onChange={event => props.onTitleChange(event.target.value)} placeholder="问卷标题" className="w-full border-0 p-0 text-2xl font-semibold text-slate-900 outline-none placeholder:text-slate-300" />
              <textarea value={props.description} onChange={event => props.onDescriptionChange(event.target.value)} placeholder="点击添加问卷说明" rows={2} className="mt-3 w-full resize-none border-0 p-0 text-sm leading-6 text-slate-500 outline-none placeholder:text-slate-300" />
            </header>
            <div onDragOver={event => event.preventDefault()} onDrop={dropNewAtEnd} className={`space-y-3 border-t border-slate-200 bg-slate-50 p-4 transition ${dragType ? 'min-h-24 bg-primary-50 ring-2 ring-primary-300' : ''}`}>
              {fields.map((field, index) => {
                const active = field.id === selectedId;
                const Icon = typeIcons[field.type];
                if (field.type === 'section_break') return (
                  <section key={field.id} draggable onClick={() => setSelectedId(field.id)} onDragStart={event => { setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragType) { insertTypeAt(index + 1, dragType); setDragType(null); } else { onDrop(index); } }} onDragEnd={() => { setDragIndex(null); setDragType(null); }} className={`group cursor-pointer border-2 border-dashed border-primary-200 bg-primary-50/40 px-5 py-4 transition ${dragIndex === index ? 'opacity-50' : ''} ${active ? 'border-primary-500' : 'hover:border-primary-400'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center bg-white text-slate-400 active:cursor-grabbing"><FileText size={15} /></div>
                      <div className="min-w-0 flex-1">
                        {editing === `${field.id}:label` ? (
                          <input autoFocus value={field.label || ''} onChange={event => updateField(field.id, { label: event.target.value })} onBlur={() => setEditing('')} onKeyDown={event => event.key === 'Enter' && setEditing('')} placeholder="分组标题" className="w-full border-b border-primary-300 bg-transparent px-1 text-sm font-semibold text-primary-800 outline-none" />
                        ) : (
                          <button type="button" onClick={event => { event.stopPropagation(); setEditing(`${field.id}:label`); }} className="w-full cursor-text rounded px-1 text-left text-sm font-semibold text-primary-800 hover:bg-white">{field.label || '新分组'}</button>
                        )}
                        <div className="mt-0.5 text-[11px] text-primary-400">用于区分内容章节，客户将在同一页面连续填写</div>
                      </div>
                      <div className={`flex shrink-0 gap-1 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        <button type="button" title="复制" onClick={event => { event.stopPropagation(); duplicate(index); }} className="flex h-7 w-7 items-center justify-center border border-primary-200 bg-white text-slate-500 hover:text-primary-600"><Copy size={13} /></button>
                        <button type="button" onClick={event => { event.stopPropagation(); void requestRemove(field); }} className="flex h-7 w-7 items-center justify-center bg-white text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  </section>
                );
                return <section
                  key={field.id}
                  draggable
                  onClick={() => setSelectedId(field.id)}
                  onDragStart={event => { setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => { event.preventDefault(); event.stopPropagation(); if (dragType) { insertTypeAt(index + 1, dragType); setDragType(null); } else { onDrop(index); } }}
                  onDragEnd={() => { setDragIndex(null); setDragType(null); }}
                  className={`group cursor-pointer border bg-white p-4 transition ${dragIndex === index ? 'opacity-50' : ''} ${active ? 'border-primary-600 ring-1 ring-primary-600' : 'border-slate-200 hover:border-slate-300'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center bg-slate-100 text-xs font-semibold text-slate-500 active:cursor-grabbing">{field.hidden ? '内' : index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <Icon size={15} className="shrink-0 text-slate-400" />
                        {editing === `${field.id}:label` ? (
                          <input autoFocus value={field.label || ''} onChange={event => updateField(field.id, { label: event.target.value })} onBlur={() => setEditing('')} onKeyDown={event => event.key === 'Enter' && setEditing('')} placeholder="未命名问题" className="w-full border border-primary-300 px-1.5 py-0.5 outline-none" />
                        ) : (
                          <span onClick={event => { event.stopPropagation(); setEditing(`${field.id}:label`); }} className="min-w-0 flex-1 cursor-text truncate hover:rounded hover:bg-slate-100 hover:px-1">{field.label || '未命名问题'}</span>
                        )}
                        {field.required && !field.hidden && <span className="text-red-500">*</span>}
                        {field.visibility && <span className="bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">条件显示</span>}
                        {field.hidden && <span className="bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">客户不可见</span>}
                      </div>
                      <div className="mt-1">
                        {editing === `${field.id}:desc` ? (
                          <input autoFocus value={field.description || ''} onChange={event => updateField(field.id, { description: event.target.value })} onBlur={() => setEditing('')} onKeyDown={event => event.key === 'Enter' && setEditing('')} placeholder="添加描述" className="w-full border border-primary-300 px-1.5 py-0.5 text-xs outline-none" />
                        ) : (
                          <button type="button" onClick={event => { event.stopPropagation(); setEditing(`${field.id}:desc`); }} className="block w-full cursor-text rounded px-1 text-left text-xs text-slate-400 hover:bg-slate-100">{field.description || '点击添加描述'}</button>
                        )}
                      </div>
                      <div className="mt-3"><InlineFieldEditor field={field} editingTarget={editing} onEdit={setEditing} onUpdate={(patch) => updateField(field.id, patch)} /></div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                        <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={field.required} disabled={field.hidden} onChange={event => updateField(field.id, { required: event.target.checked })} className="accent-primary-600" />必填</label>
                        <label className="flex cursor-pointer items-center gap-1.5"><select value={field.type} onChange={event => { const type = event.target.value as QuestionnaireFieldType; updateField(field.id, { type, options: ['single_choice', 'multiple_choice'].includes(type) ? (field.options.length ? field.options : ['选项一', '选项二']) : [], ratingMax: type === 'rating' ? (field.ratingMax || 5) : undefined }); }} className="border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none">{Object.keys(questionnaireTypeLabels).map(type => <option key={type} value={type}>{questionnaireTypeLabels[type as QuestionnaireFieldType]}</option>)}</select>题型</label>
                        {!field.hidden && ['single_choice', 'multiple_choice'].includes(field.type) && (
                          <label className="flex cursor-pointer items-center gap-1.5"><select value={field.optionDisplay || 'vertical'} onChange={event => updateField(field.id, { optionDisplay: event.target.value as QuestionnaireField['optionDisplay'] })} className="border border-slate-200 bg-white px-1.5 py-0.5 text-xs outline-none"><option value="vertical">纵向</option><option value="horizontal">横向</option>{field.type === 'single_choice' && <option value="dropdown">下拉</option>}</select>布局</label>
                        )}
                        <button type="button" onClick={event => { event.stopPropagation(); updateField(field.id, { hidden: !field.hidden, required: field.hidden ? field.required : false, visibility: field.hidden ? field.visibility : null }); }} className={field.hidden ? 'text-slate-400 underline' : 'text-slate-400 hover:text-slate-600'}>{field.hidden ? '内部字段' : '设为内部'}</button>
                        {!field.hidden && <button type="button" onClick={event => { event.stopPropagation(); setExpandVis(field.id); }} className="text-slate-400 hover:text-primary-600">{field.visibility ? '编辑条件' : '条件显示'}</button>}
                      </div>
                      {!field.hidden && expandVis === field.id && (() => {
                        const srcFields = getSourceFieldsFor(index);
                        const srcField = getSourceFieldFor(field);
                        const vis = field.visibility;
                        return (
                          <div className="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-3" onClick={event => event.stopPropagation()}>
                            <div className="flex items-center justify-between text-xs font-medium text-slate-600"><span>条件显示</span><button type="button" onClick={() => { updateField(field.id, { visibility: null }); setExpandVis(''); }} className="text-slate-400 hover:text-red-500">清除</button></div>
                            <label className="flex items-center justify-between text-xs text-slate-500"><span>启用</span><input type="checkbox" checked={Boolean(vis)} disabled={!srcFields.length} onChange={event => updateField(field.id, { visibility: event.target.checked && srcFields[0] ? { fieldId: srcFields[0].id, operator: 'equals', value: srcFields[0].options[0] || '' } : null })} className="accent-primary-600" /></label>
                            {vis && (
                              <>
                                <select value={vis.fieldId} onChange={event => { const source = srcFields.find(item => item.id === event.target.value); updateField(field.id, { visibility: { fieldId: event.target.value, operator: vis.operator || 'equals', value: source?.options[0] || '' } }); }} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs">{srcFields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                                <select value={vis.operator} onChange={event => updateField(field.id, { visibility: { ...vis, operator: event.target.value as 'equals' | 'not_equals' } })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs"><option value="equals">等于</option><option value="not_equals">不等于</option></select>
                                {srcField && ['single_choice', 'multiple_choice'].includes(srcField.type) ? <select value={vis.value} onChange={event => updateField(field.id, { visibility: { ...vis, value: event.target.value } })} className="h-8 w-full border border-slate-300 bg-white px-2 text-xs"><option value="">请选择</option>{srcField.options.map(option => <option key={option}>{option}</option>)}</select> : <input value={vis.value} onChange={event => updateField(field.id, { visibility: { ...vis, value: event.target.value } })} placeholder="条件值" className="h-8 w-full border border-slate-300 px-2 text-xs" />}
                              </>
                            )}
                            {!srcFields.length && <div className="text-xs text-amber-500">条件需依赖前面的题目，请在画布最上方添加一道题后使用。</div>}
                          </div>
                        );
                      })()}
                    </div>
                    <div className={`flex shrink-0 gap-1 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}><button type="button" disabled={index === 0} onClick={event => { event.stopPropagation(); move(index, -1); }} className="flex h-7 w-7 items-center justify-center border border-slate-200 text-slate-500 disabled:opacity-25"><ArrowUp size={13} /></button><button type="button" disabled={index === fields.length - 1} onClick={event => { event.stopPropagation(); move(index, 1); }} className="flex h-7 w-7 items-center justify-center border border-slate-200 text-slate-500 disabled:opacity-25"><ArrowDown size={13} /></button><button type="button" title="复制题目" onClick={event => { event.stopPropagation(); duplicate(index); }} className="flex h-7 w-7 items-center justify-center border border-slate-200 text-slate-500 hover:text-primary-600"><Copy size={13} /></button><button type="button" onClick={event => { event.stopPropagation(); void requestRemove(field); }} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button></div>
                  </div>
                </section>;
              })}
              {!fields.length && <button type="button" onClick={() => add('short_text')} className="flex w-full items-center justify-center gap-2 border border-dashed border-slate-300 bg-white py-12 text-sm text-slate-500 hover:border-primary-500 hover:text-primary-700"><Plus size={17} />添加第一道问题</button>}
              <div className="relative flex justify-center py-1"><button type="button" onClick={() => setSlashOpen(value => !value)} className="inline-flex h-8 items-center gap-2 px-3 text-xs text-slate-400 hover:bg-white hover:text-primary-700"><Plus size={14} />在此处添加，或输入 / 快速选择</button>{slashOpen && <div className="absolute bottom-10 z-30 grid w-80 grid-cols-2 gap-1 border border-slate-200 bg-white p-2 shadow-xl">{(Object.keys(questionnaireTypeLabels) as QuestionnaireFieldType[]).map(type => { const Icon = typeIcons[type]; return <button key={type} type="button" onClick={() => { add(type); setSlashOpen(false); }} className="flex h-9 items-center gap-2 px-2 text-left text-xs text-slate-600 hover:bg-primary-50 hover:text-primary-700"><Icon size={14} />{questionnaireTypeLabels[type]}</button>; })}</div>}</div>
              <section className="border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><Settings2 size={15} className="text-slate-400" />问卷设置</div>
                <label className="mt-3 block text-xs font-medium text-slate-500">提交后感谢语<textarea value={props.thankYouMessage} onChange={event => props.onThankYouMessageChange(event.target.value)} rows={2} placeholder="感谢您的填写，我们会尽快与您联系。" className="mt-1.5 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-600" /></label>
              </section>
            </div>
          </div>
        </main>
        <aside className="questionnaire-editor-scrollbar-hidden min-h-0 min-w-0 overflow-y-auto border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
          <div className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-800">{previewPane ? <><Eye size={15} />填写预览</> : stage === 3 ? <><CheckSquare size={15} />发布检查</> : selectedField ? <><Settings2 size={15} />题目设置</> : <><Settings2 size={15} />问卷设置</>}</div><div className="flex gap-1"><button type="button" onClick={props.onUndo} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="撤销"><Undo2 size={14} /></button><button type="button" onClick={props.onRedo} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="恢复"><Redo2 size={14} /></button></div></div>
          {previewPane ? <div className="p-5"><div className="border-t-4 border-primary-700 bg-white py-5"><div className="text-lg font-semibold text-slate-900">{props.title || '未命名问卷'}</div><p className="mt-2 text-xs leading-5 text-slate-500">{props.description || '暂无问卷说明'}</p></div><div className="space-y-4 border-t border-slate-100 pt-4">{fields.filter(field => !field.hidden).map((field, index) => <div key={field.id}><div className="text-xs font-medium text-slate-700">{index + 1}. {field.label}{field.required && <span className="ml-1 text-red-500">*</span>}</div><div className="mt-2 h-8 border border-slate-200 bg-slate-50" /></div>)}</div><button type="button" onClick={props.onPreview} className="mt-5 h-9 w-full border border-slate-200 text-xs text-slate-600 hover:border-primary-500 hover:text-primary-700">打开完整预览</button></div> : stage === 3 ? <div className="p-4"><div className={`flex items-center gap-2 px-3 py-3 text-xs ${issues.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{issues.length ? <><span className="h-2 w-2 bg-amber-500" />还有 {issues.length} 项需要完善</> : <><Check size={15} />问卷已通过检查</>}</div><div className="mt-4 space-y-2">{issues.map(issue => <button key={`${issue.id}-${issue.text}`} type="button" onClick={() => { if (issue.id !== 'title' && issue.id !== 'fields') setSelectedId(issue.id); setStage(2); }} className="flex w-full items-center justify-between border border-slate-200 px-3 py-2.5 text-left text-xs text-slate-600 hover:border-primary-400 hover:text-primary-700"><span>{issue.text}</span><ChevronRight size={14} /></button>)}</div><div className="mt-6 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-400">保存后可在问卷管理页发布并生成分享链接。发布不会改变当前编辑内容。</div></div> : selectedField ? <div className="space-y-5 p-4"><label className="block text-xs font-medium text-slate-600">题目类型<select value={selectedField.type} onChange={event => { const type = event.target.value as QuestionnaireFieldType; updateField(selectedField.id, { type, options: ['single_choice', 'multiple_choice'].includes(type) ? (selectedField.options.length ? selectedField.options : ['选项一', '选项二']) : [] }); }} className="mt-2 h-9 w-full border border-slate-200 bg-white px-2.5 text-xs outline-none">{Object.keys(questionnaireTypeLabels).map(type => <option key={type} value={type}>{questionnaireTypeLabels[type as QuestionnaireFieldType]}</option>)}</select></label><div className="space-y-3 border-t border-slate-100 pt-4"><label className="flex items-center justify-between text-xs text-slate-600"><span>设为必填</span><input type="checkbox" checked={selectedField.required} disabled={selectedField.hidden} onChange={event => updateField(selectedField.id, { required: event.target.checked })} className="accent-primary-600" /></label><label className="flex items-center justify-between text-xs text-slate-600"><span>客户不可见</span><input type="checkbox" checked={selectedField.hidden} onChange={event => updateField(selectedField.id, { hidden: event.target.checked, required: event.target.checked ? false : selectedField.required })} className="accent-primary-600" /></label></div><div className="border-t border-slate-100 pt-4"><button type="button" onClick={() => setExpandVis(expandVis === selectedField.id ? '' : selectedField.id)} className="flex w-full items-center justify-between text-xs font-medium text-slate-600"><span>高级设置</span><ChevronRight size={14} className={expandVis === selectedField.id ? 'rotate-90' : ''} /></button><p className="mt-2 text-[11px] leading-5 text-slate-400">条件显示、内部字段及默认值可在题目卡片中进一步设置。</p></div><div className="flex gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => duplicate(selectedIndex)} className="flex h-9 flex-1 items-center justify-center gap-1.5 border border-slate-200 text-xs text-slate-600 hover:text-primary-700"><Copy size={14} />复制</button><button type="button" onClick={() => requestRemove(selectedField)} className="flex h-9 flex-1 items-center justify-center gap-1.5 border border-slate-200 text-xs text-slate-600 hover:border-red-300 hover:text-red-600"><Trash2 size={14} />删除</button></div></div> : <div className="p-4"><label className="block text-xs font-medium text-slate-600">提交后感谢语<textarea value={props.thankYouMessage} onChange={event => props.onThankYouMessageChange(event.target.value)} rows={4} placeholder="感谢您的填写，我们会尽快与您联系。" className="mt-2 w-full resize-none border border-slate-200 px-3 py-2 text-xs leading-5 outline-none focus:border-primary-500" /></label></div>}
        </aside>
      </form>
    </AppModal>
    {deletedField && <div className="fixed bottom-6 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-4 bg-slate-900 px-4 py-3 text-xs text-white shadow-xl"><span>已删除“{deletedField.field.label || '未命名问题'}”</span><button type="button" onClick={restoreDeleted} className="font-medium text-blue-300 hover:text-white">撤销</button><button type="button" onClick={() => setDeletedField(null)} className="text-slate-400 hover:text-white"><X size={14} /></button></div>}
  </>;
}
