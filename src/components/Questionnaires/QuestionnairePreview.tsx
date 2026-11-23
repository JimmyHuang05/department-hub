import { useMemo, useState } from 'react';
import { ClipboardList, Paperclip, Star } from 'lucide-react';
import type { QuestionnaireField } from '../../types/questionnaire';
import { visibleQuestionnaireFields } from '../../utils/questionnaireVisibility';

interface Props {
  title: string;
  description: string;
  fields: QuestionnaireField[];
  compact?: boolean;
}

export default function QuestionnairePreview({ title, description, fields, compact = false }: Props) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const visibleFields = useMemo(() => visibleQuestionnaireFields(fields, answers), [answers, fields]);
  const setValue = (id: string, value: string | string[]) => setAnswers(current => ({ ...current, [id]: value }));

  return (
    <div className="w-full bg-white">
      <header className={`${compact ? 'px-5 py-5' : 'px-7 py-7'} border-t-4 border-primary-700`}>
        <div className="mb-3 flex h-9 w-9 items-center justify-center bg-primary-50 text-primary-700"><ClipboardList size={19} /></div>
        <h1 className={`${compact ? 'text-lg' : 'text-2xl'} font-semibold text-slate-900`}>{title || '未命名问卷'}</h1>
        {description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{description}</p>}
      </header>
      <div className={`${compact ? 'space-y-5 px-5 py-5' : 'space-y-7 px-7 py-7'} border-t border-slate-200`}>
        {visibleFields.map((field, index) => {
          const value = answers[field.id];
          if (field.type === 'section_break') return (
            <section key={field.id} className="border border-primary-100 bg-primary-50/40 px-4 py-3">
              <div className="text-sm font-semibold text-primary-800">{field.label || '新分组'}</div>
              {field.description && <div className="mt-0.5 text-xs text-primary-500">{field.description}</div>}
            </section>
          );
          return (
            <section key={field.id}>
              <label className="mb-2 block text-sm font-medium text-slate-800"><span className="mr-2 text-slate-400">{index + 1}.</span>{field.label || '未命名问题'}{field.required && <span className="ml-1 text-red-500">*</span>}</label>
              {field.description && <p className="mb-2 text-xs leading-5 text-slate-500">{field.description}</p>}
              {field.type === 'long_text' ? <textarea value={String(value || '')} onChange={event => setValue(field.id, event.target.value)} rows={3} placeholder={field.placeholder} className="w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary-600" />
                : field.type === 'single_choice' && field.optionDisplay === 'dropdown' ? <select value={String(value || '')} onChange={event => setValue(field.id, event.target.value)} className="h-10 w-full border border-slate-300 bg-white px-3 text-sm"><option value="">请选择</option>{field.options.map(option => <option key={option}>{option}</option>)}</select>
                : field.type === 'single_choice' ? <div className={field.optionDisplay === 'horizontal' ? 'flex flex-wrap gap-2' : 'space-y-2'}>{field.options.map(option => <label key={option} className="flex cursor-pointer items-center gap-2 border border-slate-200 px-3 py-2 text-sm"><input type="radio" name={`preview-${field.id}`} checked={value === option} onChange={() => setValue(field.id, option)} className="accent-primary-700" />{option}</label>)}</div>
                : field.type === 'multiple_choice' ? <div className={field.optionDisplay === 'horizontal' ? 'flex flex-wrap gap-2' : 'space-y-2'}>{field.options.map(option => { const selected = Array.isArray(value) ? value : []; return <label key={option} className="flex cursor-pointer items-center gap-2 border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={selected.includes(option)} onChange={event => setValue(field.id, event.target.checked ? [...selected, option] : selected.filter(item => item !== option))} className="accent-primary-700" />{option}</label>; })}</div>
                : field.type === 'attachment' ? <div className="flex min-h-16 items-center justify-center gap-2 border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500"><Paperclip size={16} />选择附件</div>
                : field.type === 'rating' ? <div className="flex items-center gap-1.5">{Array.from({ length: field.ratingMax || 5 }, (_, i) => i + 1).map(score => <button key={score} type="button" onClick={() => setValue(field.id, String(score))} className={`flex h-10 w-10 items-center justify-center rounded border ${Number(value) >= score ? 'border-amber-400 bg-amber-50 text-amber-500' : 'border-slate-200 text-slate-300'}`}>{(field.ratingMax || 5) > 5 ? <span className="text-sm tabular-nums">{score}</span> : <Star size={18} className={Number(value) >= score ? 'fill-amber-400' : ''} />}</button>)}</div>
                : <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'} value={String(value || '')} onChange={event => setValue(field.id, event.target.value)} placeholder={field.placeholder} className="h-10 w-full border border-slate-300 px-3 text-sm outline-none focus:border-primary-600" />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
