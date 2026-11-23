import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Palette, Pencil, Plus, Share2, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Layout/Header';
import AppModal from '../components/Layout/AppModal';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import { MobileBaseAppbar } from '../components/Mobile/MobileBasePrimitives';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { api } from '../lib/api';
import { useThemeStore } from '../store/themeStore';
import {
  buildThemePreference,
  DEFAULT_THEME_SEED,
  isHexColor,
  THEME_PRESETS,
  type ThemePreset,
  type ThemeSeed,
} from '../theme/presets';

const COLOR_FIELDS: Array<{ key: keyof ThemeSeed; label: string }> = [
  { key: 'primary', label: '主色' },
  { key: 'accent', label: '强调色' },
  { key: 'background', label: '背景色' },
  { key: 'text', label: '文字色' },
];

type ThemeCard = {
  id: string;
  name: string;
  note: string;
  seed: ThemeSeed;
  shareCode: string;
  ownerName?: string;
};

type EditingCard = {
  id: string;
  name: string;
  seed: ThemeSeed;
};

type CreatingCard = {
  name: string;
  seed: ThemeSeed;
};

function normalizeSeed(seed: ThemeSeed): ThemeSeed {
  return buildThemePreference(seed).seed;
}

function Swatches({ seed, size = 'sm' }: { seed: ThemeSeed; size?: 'sm' | 'md' }) {
  const className = size === 'md' ? 'h-7 w-7' : 'h-4 w-4';
  return (
    <div className="flex items-center gap-1.5">
      {COLOR_FIELDS.map(field => (
        <span key={field.key} className={`${className} shrink-0 border border-black/10`} style={{ backgroundColor: seed[field.key] }} title={field.label} />
      ))}
    </div>
  );
}

function MobileAppearanceSheet({ open, title, subtitle, onClose, children }: {
  open: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="mobile-appearance-sheet-layer">
      <button type="button" className="mobile-appearance-sheet-backdrop" onClick={onClose} aria-label="关闭面板" />
      <section className="mobile-appearance-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <i className="mobile-appearance-sheet__handle" />
        <header>
          <div><h2>{title}</h2><p>{subtitle}</p></div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>
        <div className="mobile-appearance-sheet__body">{children}</div>
      </section>
    </div>,
    document.getElementById('root') || document.body,
  );
}

export default function AppearanceSettings() {
  const navigate = useNavigate();
  const isMobileViewport = useMobileViewport();
  const { preference, loading, applyPreference, saveTheme, resetTheme } = useThemeStore();
  const [seed, setSeed] = useState<ThemeSeed>(preference.seed);
  const [selectedId, setSelectedId] = useState(preference.presetId);
  const [cards, setCards] = useState<ThemeCard[]>([]);
  const [editing, setEditing] = useState<EditingCard | null>(null);
  const [importCode, setImportCode] = useState('');
  const [importCandidate, setImportCandidate] = useState<ThemeCard | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ThemeCard | null>(null);
  const [creating, setCreating] = useState<CreatingCard | null>(null);
  const [creatingCard, setCreatingCard] = useState(false);
  const [message, setMessage] = useState('');
  const saveTimerRef = useRef<number | null>(null);
  const importTimerRef = useRef<number | null>(null);

  const activeSeed = editing?.seed || seed;
  const hasInvalidColor = COLOR_FIELDS.some(field => !isHexColor(activeSeed[field.key]));

  useEffect(() => {
    setSeed(preference.seed);
    setSelectedId(preference.presetId);
  }, [preference]);

  useEffect(() => {
    const loadCards = async () => {
      setLoadingCards(true);
      try {
        const res = await api.get<{ cards: ThemeCard[] }>('/preferences/theme-cards');
        setCards(res.cards || []);
      } catch {
        setMessage('色卡加载失败，请稍后重试。');
      } finally {
        setLoadingCards(false);
      }
    };
    loadCards();
  }, []);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    if (importTimerRef.current) window.clearTimeout(importTimerRef.current);
  }, []);

  const applyAndSave = (nextSeed: ThemeSeed, id = 'custom') => {
    if (COLOR_FIELDS.some(field => !isHexColor(nextSeed[field.key]))) return;
    const normalized = normalizeSeed(nextSeed);
    setSeed(normalized);
    setSelectedId(id);
    applyPreference(buildThemePreference(normalized, id));
    setMessage('自动保存中...');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveTheme(normalized, id);
        setMessage('已保存到当前账号。');
      } catch {
        setMessage('保存失败，请稍后重试。');
      }
    }, 450);
  };

  const selectSeed = (id: string, nextSeed: ThemeSeed) => {
    setEditing(null);
    applyAndSave(nextSeed, id);
  };

  const startEditing = (card: ThemeCard) => {
    setEditing({ id: card.id, name: card.name, seed: card.seed });
    setSelectedId(card.id);
    setMessage('');
  };

  const openCreateCard = () => {
    setCreating({ name: '未命名色卡', seed: normalizeSeed(seed) });
    setMessage('');
  };

  const createCard = async () => {
    if (!creating || creatingCard) return;
    const name = creating.name.trim();
    if (!name || COLOR_FIELDS.some(field => !isHexColor(creating.seed[field.key]))) return;
    setCreatingCard(true);
    try {
      const res = await api.post<{ card: ThemeCard }>('/preferences/theme-cards', {
        name,
        note: '自定义色卡',
        seed: normalizeSeed(creating.seed),
      });
      setCards(current => [res.card, ...current]);
      setCreating(null);
      applyAndSave(res.card.seed, res.card.id);
    } catch {
      setMessage('新建色卡失败，请稍后重试。');
    } finally {
      setCreatingCard(false);
    }
  };

  const updateEditingSeed = (key: keyof ThemeSeed, value: string) => {
    setEditing(current => (current ? { ...current, seed: { ...current.seed, [key]: value.toUpperCase() } } : current));
  };

  const saveEditing = async () => {
    if (!editing) return;
    if (COLOR_FIELDS.some(field => !isHexColor(editing.seed[field.key]))) {
      setMessage('请先修正颜色值。');
      return;
    }
    try {
      const res = await api.put<{ card: ThemeCard }>(`/preferences/theme-cards/${editing.id}`, {
        name: editing.name,
        note: '自定义色卡',
        seed: editing.seed,
      });
      setCards(current => current.map(card => (card.id === editing.id ? res.card : card)));
      setEditing({ id: res.card.id, name: res.card.name, seed: res.card.seed });
      applyAndSave(res.card.seed, res.card.id);
      setMessage('色卡已保存。');
    } catch {
      setMessage('色卡保存失败，请稍后重试。');
    }
  };

  const deleteCard = async () => {
    if (!deleteTarget) return;
    const card = deleteTarget;
    try {
      await api.delete(`/preferences/theme-cards/${card.id}`);
      setCards(current => current.filter(item => item.id !== card.id));
      if (editing?.id === card.id) setEditing(null);
      if (selectedId === card.id) applyAndSave(DEFAULT_THEME_SEED, 'blue-rose');
      setMessage('色卡已删除。');
      setDeleteTarget(null);
    } catch {
      setMessage('删除失败，请稍后重试。');
    }
  };

  const copyShareCode = async (card: ThemeCard) => {
    try {
      await navigator.clipboard.writeText(card.shareCode);
      setMessage('分享码已复制。');
    } catch {
      setMessage('复制失败，请检查浏览器剪贴板权限。');
    }
  };

  const lookupImportCode = (value: string) => {
    setImportCode(value);
    setImportCandidate(null);
    if (importTimerRef.current) window.clearTimeout(importTimerRef.current);
    const code = value.trim();
    if (code.length < 8) return;
    importTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await api.get<{ card: ThemeCard }>(`/preferences/theme-cards/share/${encodeURIComponent(code)}`);
        setImportCandidate(res.card);
      } catch {
        setImportCandidate(null);
      }
    }, 500);
  };

  const confirmImport = async () => {
    if (!importCandidate) return;
    try {
      const res = await api.post<{ card: ThemeCard }>('/preferences/theme-cards/import', { shareCode: importCode.trim() });
      setCards(current => [res.card, ...current]);
      setImportCode('');
      setImportCandidate(null);
      setShareDialogOpen(false);
      startEditing(res.card);
      setMessage('分享色卡已导入。');
    } catch {
      setMessage('导入失败，请稍后重试。');
    }
  };

  const _handleReset = async () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setEditing(null);
    setSeed(DEFAULT_THEME_SEED);
    setSelectedId('blue-rose');
    await resetTheme();
    setMessage('已恢复默认配色。');
  };
  void _handleReset;

  const renderEditor = (card: ThemeCard) => {
    if (!editing || editing.id !== card.id) return null;
    return (
      <div className="border-x border-b border-surface-200 bg-white px-4 pb-4 pt-3">
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-surface-600">色卡名称</span>
            <input
              value={editing.name}
              onChange={event => setEditing(current => (current ? { ...current, name: event.target.value } : current))}
              className="h-10 border border-surface-200 bg-white px-3 text-sm text-surface-900 outline-none focus:border-primary-600"
            />
          </label>

          <div className="grid grid-cols-4 gap-3">
            {COLOR_FIELDS.map(field => (
              <label key={field.key} className="group grid cursor-pointer gap-2 text-center">
                <span className="h-10 border border-surface-200 shadow-sm group-hover:border-primary-600" style={{ backgroundColor: editing.seed[field.key] }} />
                <span className="text-[11px] text-surface-500">{field.label}</span>
                <input
                  type="color"
                  value={isHexColor(editing.seed[field.key]) ? editing.seed[field.key] : '#000000'}
                  onChange={event => updateEditingSeed(field.key, event.target.value)}
                  className="sr-only"
                />
              </label>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={saveEditing}
              disabled={loading || hasInvalidColor}
              className="inline-flex h-10 items-center justify-center gap-2 bg-primary-600 px-3 text-sm font-medium text-primary-contrast hover:bg-primary-700 disabled:opacity-60"
            >
              <Check size={15} />
              保存
            </button>
            <button
              type="button"
              onClick={() => copyShareCode(card)}
              className="inline-flex h-10 items-center justify-center gap-2 border border-surface-200 bg-white px-3 text-sm font-medium text-surface-700 hover:bg-surface-100"
            >
              <Share2 size={15} />
              分享
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (isMobileViewport) {
    const selectedPreset = THEME_PRESETS.find(preset => preset.id === selectedId);
    const selectedCard = cards.find(card => card.id === selectedId);
    const selectedThemeName = selectedPreset?.name || selectedCard?.name || '自定义主题';
    return (
      <>
        <div className="mobile-appearance-page square-ui">
          <MobileBaseAppbar
            title="外观设置"
            backLabel="返回更多功能"
            onBack={() => navigate(-1)}
            action={<button type="button" onClick={() => setShareDialogOpen(true)} aria-label="导入分享主题"><Share2 size={20} /></button>}
          />
          <main className="mobile-appearance-content">
            <section className="mobile-appearance-preview">
              <header><span><Palette size={18} /></span><div><h2>当前主题</h2><p>{selectedThemeName} · 已自动保存</p></div></header>
              <div className="mobile-theme-preview-canvas" style={{ backgroundColor: seed.background, color: seed.text }}>
                <div className="mobile-theme-preview-top"><i style={{ backgroundColor: seed.primary }} /><strong>工作台</strong><span /></div>
                <div className="mobile-theme-preview-hero" style={{ backgroundColor: `${seed.primary}18` }}><b style={{ color: seed.primary }}>上午好</b><span>这是你的工作空间</span></div>
                <div className="mobile-theme-preview-grid"><i /><i /><i /></div>
                <div className="mobile-theme-preview-line"><i style={{ backgroundColor: seed.accent }} /><span /><b /></div>
              </div>
              <div className="mobile-appearance-palette" aria-label="当前主题颜色">
                {COLOR_FIELDS.map(field => <span key={field.key}><i style={{ backgroundColor: seed[field.key] }} /><b>{field.label}</b><small>{seed[field.key]}</small></span>)}
              </div>
            </section>

            {message && <div className="mobile-appearance-message"><Check size={15} />{message}</div>}

            <section className="mobile-appearance-group">
              <header><div><h2>预设主题</h2><p>选择后立即应用到整个系统</p></div><span>{THEME_PRESETS.length} 套</span></header>
              <div className="mobile-preset-grid">
                {THEME_PRESETS.map(preset => {
                  const selected = selectedId === preset.id;
                  return <button key={preset.id} type="button" className={selected ? 'is-selected' : ''} onClick={() => selectSeed(preset.id, preset.seed)} aria-label={`应用主题 ${preset.name}`}>
                    <span className="mobile-preset-card__preview" style={{ backgroundColor: preset.seed.background }}>
                      <i style={{ backgroundColor: preset.seed.primary }} />
                      <b style={{ backgroundColor: preset.seed.text }} />
                      <em style={{ backgroundColor: preset.seed.accent }} />
                    </span>
                    <span className="mobile-preset-card__copy"><strong>{preset.name}</strong><small>{preset.note}</small></span>
                    {selected && <span className="mobile-preset-card__check"><Check size={13} /></span>}
                  </button>;
                })}
              </div>
            </section>

            <section className="mobile-appearance-group">
              <header><div><h2>我的色卡</h2><p>保存团队或个人专属配色</p></div><span>{loadingCards ? '加载中' : `${cards.length} 张`}</span></header>
              <div className="mobile-custom-theme-list">
                <button type="button" className="mobile-create-theme-row" onClick={openCreateCard}>
                  <span><Plus size={19} /></span><div><strong>新建色卡</strong><small>从当前配色创建</small></div>
                </button>
                {cards.map(card => (
                  <article key={card.id} className={selectedId === card.id ? 'is-selected' : ''}>
                    <button type="button" className="mobile-custom-theme-main" onClick={() => selectSeed(card.id, card.seed)}>
                      <span className="mobile-custom-theme-swatches">{COLOR_FIELDS.map(field => <i key={field.key} style={{ backgroundColor: card.seed[field.key] }} />)}</span>
                      <span><strong>{card.name}</strong><small>{card.note || '自定义色卡'}</small></span>
                      {selectedId === card.id && <Check size={17} />}
                    </button>
                    <div className="mobile-custom-theme-actions">
                      <button type="button" onClick={() => startEditing(card)} aria-label={`编辑色卡 ${card.name}`}><Pencil size={16} /></button>
                      <button type="button" onClick={() => copyShareCode(card)} aria-label={`复制 ${card.name} 分享码`}><Copy size={16} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <button type="button" className="mobile-appearance-import" onClick={() => setShareDialogOpen(true)}>
              <Share2 size={18} /><span><strong>导入分享主题</strong><small>通过分享码获取他人的色卡</small></span><b>›</b>
            </button>
          </main>
        </div>

        <MobileAppearanceSheet open={Boolean(editing)} title="编辑色卡" subtitle="调整名称和四个基础颜色" onClose={() => setEditing(null)}>
          {editing && <>
            <label className="mobile-theme-name-field"><span>色卡名称</span><input value={editing.name} maxLength={40} onChange={event => setEditing(current => current ? { ...current, name: event.target.value } : current)} /></label>
            <div className="mobile-theme-color-fields">
              {COLOR_FIELDS.map(field => <label key={field.key}>
                <input type="color" value={isHexColor(editing.seed[field.key]) ? editing.seed[field.key] : '#000000'} onChange={event => updateEditingSeed(field.key, event.target.value)} />
                <span><strong>{field.label}</strong><small>{editing.seed[field.key]}</small></span>
              </label>)}
            </div>
            <div className="mobile-theme-sheet-actions">
              <button type="button" className="is-secondary" onClick={() => editing && copyShareCode(cards.find(card => card.id === editing.id) || { ...editing, note: '', shareCode: '' })}><Share2 size={16} />分享</button>
              <button type="button" className="is-primary" onClick={() => void saveEditing()} disabled={loading || hasInvalidColor}><Check size={16} />保存修改</button>
            </div>
            <button type="button" className="mobile-theme-delete-action" onClick={() => { const card = cards.find(item => item.id === editing.id); if (card) { setEditing(null); setDeleteTarget(card); } }}><Trash2 size={15} />删除这张色卡</button>
          </>}
        </MobileAppearanceSheet>

        <MobileAppearanceSheet open={Boolean(creating)} title="新建色卡" subtitle="以当前主题为基础创建" onClose={() => { if (!creatingCard) setCreating(null); }}>
          {creating && <>
            <label className="mobile-theme-name-field"><span>色卡名称</span><input autoFocus value={creating.name} maxLength={40} onChange={event => setCreating(current => current ? { ...current, name: event.target.value } : current)} /></label>
            <div className="mobile-theme-color-fields">
              {COLOR_FIELDS.map(field => <label key={field.key}>
                <input type="color" value={isHexColor(creating.seed[field.key]) ? creating.seed[field.key] : '#000000'} onChange={event => setCreating(current => current ? { ...current, seed: { ...current.seed, [field.key]: event.target.value.toUpperCase() } } : current)} />
                <span><strong>{field.label}</strong><small>{creating.seed[field.key]}</small></span>
              </label>)}
            </div>
            <button type="button" className="mobile-theme-create-submit" onClick={() => void createCard()} disabled={creatingCard || !creating.name.trim() || COLOR_FIELDS.some(field => !isHexColor(creating.seed[field.key]))}>{creatingCard ? '正在创建…' : '创建并应用'}</button>
          </>}
        </MobileAppearanceSheet>

        <MobileAppearanceSheet open={shareDialogOpen} title="导入分享主题" subtitle="输入分享码预览并保存色卡" onClose={() => { setShareDialogOpen(false); setImportCode(''); setImportCandidate(null); }}>
          <label className="mobile-theme-name-field"><span>分享码</span><input autoFocus value={importCode} onChange={event => lookupImportCode(event.target.value)} placeholder="请输入至少 8 位分享码" /></label>
          {importCandidate ? <div className="mobile-import-candidate"><div><strong>{importCandidate.name}</strong><small>{importCandidate.ownerName ? `来自 ${importCandidate.ownerName}` : '分享主题'}</small></div><Swatches seed={importCandidate.seed} size="md" /></div> : importCode.trim().length >= 8 ? <p className="mobile-import-hint">正在查找，或分享码无效…</p> : <p className="mobile-import-hint">粘贴分享码后会自动显示主题预览。</p>}
          <button type="button" className="mobile-theme-create-submit" onClick={() => void confirmImport()} disabled={!importCandidate}>确认导入</button>
        </MobileAppearanceSheet>

        <DeleteConfirmDialog open={Boolean(deleteTarget)} title="删除色卡" targetName={deleteTarget?.name} onCancel={() => setDeleteTarget(null)} onConfirm={deleteCard} />
      </>
    );
  }

  return (
    <div className="square-ui flex min-h-full min-w-0 flex-col gap-5 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
      <Header title="外观设置" subtitle="管理预设主题与自定义色卡，统一系统视觉风格。">
        <button
          type="button"
          onClick={() => setShareDialogOpen(true)}
          className="inline-flex h-10 items-center justify-center gap-2 border border-surface-200 bg-white px-4 text-sm font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-60"
        >
          <Share2 size={16} />
          分享
        </button>
      </Header>
      <div className="min-h-0 min-w-0 flex-1 overflow-visible pr-0 lg:overflow-y-auto lg:pr-1">
        <section className="w-full pb-5">
          <div className="grid auto-rows-max gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <section className="contents">
              <div className="hidden">
                <div className="flex items-center gap-2 text-sm font-semibold text-surface-900">
                  预设主题
                </div>
                <span className="text-xs text-surface-400">{THEME_PRESETS.length} 套</span>
              </div>

              <div className="contents">
                {THEME_PRESETS.map((preset: ThemePreset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => selectSeed(preset.id, preset.seed)}
                    className={`group flex min-h-[144px] flex-col p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/10 ${selectedId === preset.id ? 'bg-primary-50 shadow-[0_8px_24px_rgba(15,23,42,0.08)]' : 'bg-white shadow-sm shadow-slate-900/5'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold tracking-tight text-surface-950">{preset.name}</div>
                        <div className="mt-1.5 line-clamp-2 text-xs leading-5 text-surface-400">{preset.note}</div>
                      </div>
                      <span className="shrink-0 bg-surface-100 px-2 py-1 text-[10px] font-medium text-surface-500">预设</span>
                    </div>
                    <div className="mt-auto pt-4">
                      <Swatches seed={preset.seed} size="md" />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="contents">
              <div className="hidden">
                <div className="text-sm font-semibold text-surface-900">我的色卡</div>
                <span className="text-xs text-surface-400">{loadingCards ? '加载中' : `${cards.length} 张`}</span>
              </div>

              <div className="contents">
                {cards.map(card => (
                  <div key={card.id} className="order-2">
                    <div className={`group grid min-h-[144px] grid-cols-[minmax(0,1fr)_40px] bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/10 ${selectedId === card.id ? 'bg-primary-50 shadow-[0_8px_24px_rgba(15,23,42,0.08)]' : 'shadow-sm shadow-slate-900/5'}`}>
                      <button type="button" onClick={() => selectSeed(card.id, card.seed)} onDoubleClick={() => startEditing(card)} className="flex min-w-0 flex-col text-left">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-semibold tracking-tight text-surface-950">{card.name}</div>
                            <div className="mt-1.5 truncate text-xs text-surface-400">{card.note}</div>
                          </div>
                          <span className="shrink-0 bg-surface-100 px-2 py-1 text-[10px] font-medium text-surface-500">自定义</span>
                        </div>
                        <div className="mt-auto pt-4">
                          <Swatches seed={card.seed} size="md" />
                        </div>
                      </button>
                      <div className="flex flex-col items-center justify-end gap-1 px-1 py-0">
                        <button type="button" onClick={() => copyShareCode(card)} className="inline-flex h-8 w-8 items-center justify-center text-surface-500 hover:bg-surface-100 hover:text-primary-600" title="复制分享码">
                          <Copy size={14} />
                        </button>
                        <button type="button" onClick={() => setDeleteTarget(card)} className="inline-flex h-8 w-8 items-center justify-center text-surface-500 hover:bg-danger-50 hover:text-danger-700" title="删除色卡">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {renderEditor(card)}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={openCreateCard}
                  className="order-1 flex min-h-[144px] w-full items-center justify-center border border-dashed border-surface-300 bg-transparent text-surface-400 transition-colors hover:border-primary-600 hover:text-primary-600"
                  title="新建色卡"
                >
                  <Plus size={26} strokeWidth={1.8} />
                  <span className="ml-2 text-xs font-medium">新建色卡</span>
                </button>
              </div>
            </section>

          </div>

          {false && <section className="border-t border-surface-200 pt-5">
            <input value={importCode} onChange={event => lookupImportCode(event.target.value)} placeholder="粘贴分享码" className="h-10 w-full border border-surface-200 bg-white px-3 text-sm text-surface-700 outline-none focus:border-primary-600" />
          </section>}
        </section>
      </div>

      {importCandidate && (
        <div className="hidden fixed inset-0 z-50 items-center justify-center bg-surface-900/35 px-4">
          <div className="w-full max-w-sm border border-surface-200 bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-surface-900">找到分享色卡</div>
                <div className="mt-1 text-sm text-surface-500">确认后会复制到“我的色卡”。</div>
              </div>
              <button type="button" onClick={() => setImportCandidate(null)} className="text-surface-400 hover:text-surface-700">
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 border border-surface-200 bg-surface-50 p-3">
              <div className="text-sm font-semibold text-surface-900">{importCandidate.name}</div>
              <div className="mt-1 text-xs text-surface-500">{importCandidate.ownerName ? `来自 ${importCandidate.ownerName}` : '分享色卡'}</div>
              <div className="mt-3">
                <Swatches seed={importCandidate.seed} size="md" />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setImportCandidate(null)} className="h-10 border border-surface-200 bg-white text-sm font-medium text-surface-700 hover:bg-surface-100">
                取消
              </button>
              <button type="button" onClick={confirmImport} className="h-10 bg-primary-600 text-sm font-medium text-primary-contrast hover:bg-primary-700">
                导入
              </button>
            </div>
          </div>
        </div>
      )}
      <AppModal
        open={Boolean(creating)}
        onClose={() => { if (!creatingCard) setCreating(null); }}
        title="新建色卡"
        size="sm"
        closeOnOverlay={!creatingCard}
        footer={<div className="grid w-full grid-cols-2 gap-3"><button type="button" onClick={() => setCreating(null)} disabled={creatingCard} className="app-button-secondary h-10 w-full disabled:opacity-50">取消</button><button type="button" onClick={() => void createCard()} disabled={creatingCard || !creating?.name.trim() || COLOR_FIELDS.some(field => !isHexColor(creating?.seed[field.key] || ''))} className="app-button-primary h-10 w-full disabled:opacity-50">{creatingCard ? '正在创建...' : '创建'}</button></div>}
      >
        {creating && <div className="space-y-5">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-surface-600">色卡名称</span>
            <input autoFocus value={creating.name} onChange={event => setCreating(current => current ? { ...current, name: event.target.value } : current)} maxLength={40} className="h-10 border border-surface-200 bg-white px-3 text-sm text-surface-900 outline-none focus:border-primary-600" />
          </label>
          <div className="grid grid-cols-4 gap-3">
            {COLOR_FIELDS.map(field => <label key={field.key} className="group grid cursor-pointer gap-2 text-center">
              <span className="h-12 border border-surface-200 shadow-sm group-hover:border-primary-600" style={{ backgroundColor: creating.seed[field.key] }} />
              <span className="text-[11px] text-surface-500">{field.label}</span>
              <input type="color" value={isHexColor(creating.seed[field.key]) ? creating.seed[field.key] : '#000000'} onChange={event => setCreating(current => current ? { ...current, seed: { ...current.seed, [field.key]: event.target.value.toUpperCase() } } : current)} className="sr-only" />
            </label>)}
          </div>
        </div>}
      </AppModal>
      <AppModal
        open={shareDialogOpen}
        onClose={() => { setShareDialogOpen(false); setImportCode(''); setImportCandidate(null); }}
        title="导入分享主题"
        showClose={false}
        size="sm"
        footer={<div className="grid w-full grid-cols-2 gap-3"><button type="button" onClick={() => { setShareDialogOpen(false); setImportCode(''); setImportCandidate(null); }} className="app-button-secondary h-10 w-full">取消</button><button type="button" onClick={() => void confirmImport()} disabled={!importCandidate} className="app-button-primary h-10 w-full disabled:opacity-50">确认</button></div>}
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-surface-500">输入他人提供的分享码，确认后会保存到“我的色卡”。</p>
          <input autoFocus value={importCode} onChange={event => lookupImportCode(event.target.value)} placeholder="输入分享码" className="h-10 w-full border border-surface-200 bg-white px-3 text-sm text-surface-700 outline-none focus:border-primary-600" />
          {importCandidate && <div className="border border-surface-200 bg-surface-50 p-3"><div className="text-sm font-semibold text-surface-900">{importCandidate.name}</div><div className="mt-1 text-xs text-surface-500">{importCandidate.ownerName ? `来自 ${importCandidate.ownerName}` : '分享主题'}</div><div className="mt-3"><Swatches seed={importCandidate.seed} size="md" /></div></div>}
        </div>
      </AppModal>
      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除色卡"
        targetName={deleteTarget?.name}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={deleteCard}
      />
    </div>
  );
}
