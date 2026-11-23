import { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Info, ArrowRight, Bell, ChevronLeft, Clock3, FileText, Filter, Folder, ListTodo, Maximize2, Menu, Minimize2, Pencil, Plus, Search, SlidersHorizontal, Square, Table2, Trash2, Upload } from 'lucide-react';
import Header from '../components/Layout/Header';
import FeatureInfo from '../components/Guidance/FeatureInfo';
import AppModal from '../components/Layout/AppModal';
import DetailModal, { DetailGrid, DetailSection } from '../components/Layout/DetailModal';
import ListCardShell from '../components/Layout/ListCardShell';
import TableToolbar from '../components/DataTable/TableToolbar';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import ImportModal from '../components/DataTable/ImportModal';
import AppSelect from '../components/Form/AppSelect';
import ManagerScopeFilter from '../components/ManagerScopeFilter';
import { MobileDateInput, MobileNumberInput, MobileSelectInput, MobileTextInput } from '../components/MobileWheelPicker';
import {
  MobileDetailEditorSheet,
  MobileDetailFieldRow,
  MobileDetailSection,
  type MobileDetailEditorField,
} from '../components/Mobile/MobileBasePrimitives';
import LoadingSpinner from '../components/LoadingSpinner';
import VersionHistory from '../components/Collaboration/VersionHistory';
import ProductCards, { PROJECT_CARD_FIELD_OPTIONS } from '../components/ProductCards';
import ProjectExcelView from '../components/ProjectExcelView';
import ProjectFortuneSheetModule from '../modules/project-fortune-sheet/ProjectFortuneSheetModule';
import { useProjectStore } from '../store/projectStore';
import { useWorkLogStore } from '../store/workLogStore';
import { useSettingsStore } from '../store/settingsStore';
import { useCollaborationStore } from '../store/collaborationStore';
import { broadcastEditingStart, broadcastEditingStop } from '../hooks/useCollaboration';
import { useMobileViewport } from '../hooks/useMobileViewport';
import { useAuthStore } from '../store/authStore';
import { DEFAULT_PROJECT_CARD_FIELDS, useUiPreferenceStore } from '../store/uiPreferenceStore';
import { useShallow } from 'zustand/react/shallow';
import { useDebounce } from '../utils/useDebounce';
import { _toast } from '../store/toastRef';
import { InvestmentProduct, ImportMode, WorkLogEntry } from '../types';
import { exportProjectProgress } from '../utils/projectProgressExport';
import { generateId } from '../utils/id';
import { calculateDerivedFields, computeIncome, defaultDeadlineForEstablishDate } from '../utils/investmentCalculations';
import { normalizeRate } from '../utils/format';
import { getWorkWeekLabelForKey } from '../utils/workWeek';
import { api } from '../lib/api';
import { getWorkLogSnapshotWeekKeys } from '../lib/workLogSnapshotCache';
import { mergeImportRows, projectImportIdentity } from '../utils/importMerge';
import {
  PRODUCT_NAME_TEMPLATE_SLOT,
  normalizeProductNameTemplateSlots,
  scopedProductNameTemplateKey,
} from '../utils/productNameTemplates';
import { findProjectNameDuplicate } from '../utils/duplicateDetection';
import { isProjectAssignedToAccount } from '../utils/accountParticipation';
import { readPageSnapshot, writePageSnapshot } from '../utils/pageSnapshot';
import { ACTIVE_PASSIVE_OPTIONS, COLLECTIVE_SINGLE_OPTIONS, PROJECT_CATEGORY_OPTIONS, projectCategoryLinkage } from '../utils/projectClassification';
import {
  FIELD_LABELS,
  PROJECT_BACKUP_STATUS_CONFIG,
  PROJECT_STATUS_COLORS,
  feeRateToPercentInput,
  formatWorkspaceFileSize,
  formatWorkspaceTime,
  isRelatedWorkLog,
  latestWorkLogProgress,
  mergeSelectOptions,
  percentInputToFeeRate,
  projectRelationKey,
  projectSeriesKey,
  relationPartyKey,
} from '../modules/project-list/projectListModel';

type ProjectWorkspaceTab = 'overview' | 'tasks' | 'worklogs' | 'files' | 'activity';

function mobileProjectTime(value?: string) {
  if (!value) return '暂无更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

interface ProjectCloudFile {
  id: string;
  fileName: string;
  fileSize?: number;
  uploadedBy?: string;
  uploadedAt?: string;
  remark?: string;
  projectId?: string;
}

interface ProjectHistoryEntry {
  id: string;
  field: string;
  oldValue: string;
  newValue: string;
  editedBy: string;
  editedAt: string;
  editedName?: string;
}

interface LastEditInfo {
  editedBy: string;
  editedName?: string;
  editedAt: string;
}

interface WorkLogHandoff {
  product: InvestmentProduct;
  existingEntry?: WorkLogEntry;
}
interface ProjectPageSnapshot {
  searchQuery: string;
  detailProductId: string | null;
  newProjectDraft: InvestmentProduct | null;
  activeProjectStageIds: string[];
  selectedProductIds: string[];
  workspaceTab: ProjectWorkspaceTab;
  newProjectNamePrefix: string;
  newProjectNameSuffix: string;
  newProjectNumber: string;
  focusedProjectField: string | null;
}
const detailFieldClass = (focused: boolean) =>
  `project-detail-field group relative ${focused ? 'is-focused' : ''}`;

function FieldLastEdit({ info }: { info?: LastEditInfo }) {
  const [hovered, setHovered] = useState(false);
  if (!info) return null;
  const editor = info.editedName || info.editedBy || '未知用户';
  const time = formatWorkspaceTime(info.editedAt);
  return (
    <span className="relative ml-2 inline-flex shrink-0">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center text-slate-400 opacity-80 transition-colors hover:text-primary-600"
        aria-label={`${time} · ${editor}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Clock3 size={14} />
      </button>
      {hovered && <span role="tooltip" className="pointer-events-none absolute right-0 top-6 z-50 w-max max-w-64 border border-slate-200 bg-slate-950 px-2.5 py-2 text-left text-xs leading-5 text-white shadow-lg">
        <span className="block font-medium">{time} · {editor}</span>
      </span>}
    </span>
  );
}

function normalizeProjectStatus(status?: string) {
  if (!status) return '未填写';
  if (status.includes('成立')) return '已成立';
  if (status.includes('落地')) return '已成立';
  if (status.includes('过会')) return '已过会';
  if (status.includes('上会')) return '上会中';
  if (status.includes('报告')) return '报告撰写';
  if (status.includes('材料')) return '材料收集';
  if (status.includes('终止')) return '项目中止';
  if (status.includes('中止')) return '项目中止';
  return status;
}

function statusColor(status: string | undefined, configs: { name: string; color: string }[]) {
  if (!status) return PROJECT_STATUS_COLORS.未填写;
  const normalized = normalizeProjectStatus(status);
  if (PROJECT_STATUS_COLORS[normalized]) return PROJECT_STATUS_COLORS[normalized];
  const exact = configs.find(config => config.name === status);
  if (exact?.color) return exact.color;
  const partial = configs.find(config => status.includes(config.name) || config.name.includes(status));
  return partial?.color || PROJECT_STATUS_COLORS.未填写;
}

function EditableProjectField({
  label,
  value,
  onChange,
  multiline = false,
  type = 'text',
  options,
  suggestions,
  fieldKey,
  focused = false,
  onEditingStart,
  onEditingStop,
  lastEdit,
  readOnly = false,
  selectVariant = 'inline',
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  multiline?: boolean;
  type?: 'text' | 'number' | 'date';
  options?: string[];
  suggestions?: string[];
  fieldKey?: string;
  focused?: boolean;
  onEditingStart?: () => void;
  onEditingStop?: () => void;
  lastEdit?: LastEditInfo;
  readOnly?: boolean;
  selectVariant?: 'popover' | 'inline' | 'anchored';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [draftValue, setDraftValue] = useState<string | number>(value);
  const latestDraftRef = useRef<string | number>(value);
  const latestValueRef = useRef<string | number>(value);
  const onChangeRef = useRef(onChange);
  const draftDirtyRef = useRef(false);
  const isComposingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSuggestions = !options && !multiline && type === 'text' && Boolean(suggestions?.length);

  latestValueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (draftDirtyRef.current) return;
    latestDraftRef.current = value;
    setDraftValue(value);
    draftDirtyRef.current = false;
  }, [value]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (draftDirtyRef.current && String(latestDraftRef.current ?? '') !== String(latestValueRef.current ?? '')) {
      draftDirtyRef.current = false;
      onChangeRef.current(String(latestDraftRef.current));
    }
  }, []);

  const commitValue = (nextValue: string | number) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    draftDirtyRef.current = false;
    if (String(nextValue ?? '') !== String(latestValueRef.current ?? '')) onChangeRef.current(String(nextValue));
  };

  const changeDraft = (nextValue: string) => {
    latestDraftRef.current = nextValue;
    setDraftValue(nextValue);
    draftDirtyRef.current = true;
    if (!isComposingRef.current && !readOnly && !options && type !== 'date') {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (draftDirtyRef.current) commitValue(latestDraftRef.current);
      }, 500);
    }
  };

  const flushDraft = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (draftDirtyRef.current) commitValue(latestDraftRef.current);
  };

  const filteredSuggestions = useMemo(() => {
    const query = String(draftValue || '').trim().toLowerCase();
    return (suggestions || [])
      .filter(option => !query || option.toLowerCase().includes(query))
      .slice(0, 8);
  }, [suggestions, draftValue]);

  return (
    <label
      data-project-field={fieldKey}
      className={detailFieldClass(focused)}
      onFocusCapture={onEditingStart}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        flushDraft();
        onEditingStop?.();
      }}
    >
      <span className="flex items-center justify-between"><span className="text-xs text-slate-500">{label}</span><FieldLastEdit info={lastEdit} /></span>
      {options ? (
        <>
          <div className="hidden lg:block"><AppSelect value={value} options={options} onChange={onChange} className="mt-1" variant={selectVariant} clearable /></div>
          <MobileSelectInput value={String(value || '')} options={options} onChange={onChange} title={label} className="mt-1 h-9 w-full" />
        </>
      ) : multiline ? (
        <>
        <div className="hidden lg:block">
          <textarea
            value={draftValue}
            autoComplete="off"
            onCompositionStart={() => {
              isComposingRef.current = true;
              if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
              }
            }}
            onCompositionEnd={event => {
              isComposingRef.current = false;
              changeDraft(event.currentTarget.value);
            }}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => setSuggestionsOpen(false)}
            onChange={event => changeDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.ctrlKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitValue(event.currentTarget.value);
                event.currentTarget.blur();
              }
            }}
            className="mt-1 min-h-20 w-full resize-y border border-slate-200 bg-white px-2.5 py-2 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
          />
          {suggestionsOpen && filteredSuggestions.length > 0 && (
            <div className="project-detail-suggestions">
              {filteredSuggestions.map(option => (
                <button
                  key={option}
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    latestDraftRef.current = option;
                    setDraftValue(option);
                    commitValue(option);
                    setSuggestionsOpen(false);
                  }}
                  className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  title={option}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>
        <MobileTextInput
          value={draftValue}
          multiline
          title={label}
          onChange={changeDraft}
          onCommit={commitValue}
          className="mt-1 min-h-14 w-full lg:!hidden"
        />
        </>
      ) : type === 'date' ? (
        <MobileDateInput
          value={String(draftValue || '')}
          onChange={nextValue => {
            changeDraft(nextValue);
            commitValue(nextValue);
          }}
          title={label}
          className="mt-1 h-9 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
        />
      ) : type === 'number' ? (
        <MobileNumberInput
          value={draftValue}
          onChange={changeDraft}
          onCommit={commitValue}
          title={label}
          className="mt-1 h-9 w-full border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400"
        />
      ) : (
        <>
          <input
            ref={inputRef}
            type={type}
            value={draftValue}
            autoComplete="off"
            onCompositionStart={() => {
              isComposingRef.current = true;
              if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
              }
            }}
            onCompositionEnd={event => {
              isComposingRef.current = false;
              changeDraft(event.currentTarget.value);
            }}
            readOnly={readOnly}
            aria-readonly={readOnly}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => setSuggestionsOpen(false)}
            onChange={event => changeDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitValue(event.currentTarget.value);
                event.currentTarget.blur();
              }
            }}
            className={`mt-1 hidden h-9 w-full border border-slate-200 px-2.5 text-sm font-medium outline-none transition-colors lg:block ${readOnly ? 'cursor-default bg-slate-50 text-slate-600' : 'bg-white text-slate-900 focus:border-slate-400'}`}
          />
          <MobileTextInput
            value={draftValue}
            readOnly={readOnly}
            title={label}
            onChange={changeDraft}
            onCommit={commitValue}
            className="mt-1 h-9 w-full lg:!hidden"
          />
          {suggestionsOpen && hasSuggestions && filteredSuggestions.length > 0 && (
            <div className="project-detail-suggestions hidden lg:block">
              {filteredSuggestions.map(option => (
                <button
                  key={option}
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    latestDraftRef.current = option;
                    setDraftValue(option);
                    commitValue(option);
                    setSuggestionsOpen(false);
                  }}
                  className="block w-full truncate px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                  title={option}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </label>
  );
}

function ProjectNameField({
  value,
  onChange,
  focused = false,
  duplicate = false,
  isDuplicate,
  onEditingStart,
  onEditingStop,
  lastEdit,
}: {
  value: string;
  onChange: (value: string) => void;
  focused?: boolean;
  duplicate?: boolean;
  isDuplicate?: (value: string) => boolean;
  onEditingStart?: () => void;
  onEditingStop?: () => void;
  lastEdit?: LastEditInfo;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const draftDuplicate = isDuplicate ? isDuplicate(draftValue) : duplicate;
  const latestDraftRef = useRef(value);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const draftDirtyRef = useRef(false);
  const isComposingRef = useRef(false);
  latestValueRef.current = value;
  onChangeRef.current = onChange;
  useEffect(() => {
    if (draftDirtyRef.current) return;
    latestDraftRef.current = value;
    setDraftValue(value);
  }, [value]);

  useEffect(() => () => {
    if (draftDirtyRef.current && latestDraftRef.current !== latestValueRef.current) {
      draftDirtyRef.current = false;
      onChangeRef.current(latestDraftRef.current);
    }
  }, []);

  const commitDraft = () => {
    if (!draftDirtyRef.current) return;
    draftDirtyRef.current = false;
    if (latestDraftRef.current !== latestValueRef.current) onChangeRef.current(latestDraftRef.current);
  };

  const changeDraft = (nextValue: string) => {
    latestDraftRef.current = nextValue;
    setDraftValue(nextValue);
    draftDirtyRef.current = true;
  };

  const flushDraft = () => {
    commitDraft();
  };

  return (
    <div
      data-project-field="productName"
      className={detailFieldClass(focused)}
      onFocusCapture={onEditingStart}
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        flushDraft();
        onEditingStop?.();
      }}
    >
      <span className="flex items-center justify-between"><span className="text-xs text-slate-500">{'\u9879\u76ee\u540d\u79f0'}</span><FieldLastEdit info={lastEdit} /></span>
      <div className="relative mt-1">
        <input
          value={draftValue}
          autoComplete="off"
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={event => {
            isComposingRef.current = false;
            changeDraft(event.currentTarget.value);
          }}
          onChange={event => changeDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              commitDraft();
              event.currentTarget.blur();
            }
          }}
          className={`h-9 w-full border bg-white px-2.5 text-sm font-medium text-slate-900 outline-none transition-colors focus:border-slate-400 ${draftDuplicate ? 'border-red-400 pr-8' : 'border-slate-200'}`}
          placeholder={'\u9879\u76ee\u540d\u79f0'}
        />
        {draftDuplicate && (
          <span className="group absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500" aria-label="项目名称重复">
            <Info size={15} />
            <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+7px)] right-0 z-50 hidden w-max max-w-56 bg-slate-950 px-2.5 py-1.5 text-xs leading-5 text-white shadow-lg group-hover:block">
              该名称已被占号项目使用
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function getProductNameTemplateValues(productName: string, template: string) {
  const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = normalizeProductNameTemplateSlots(template)
    .split(PRODUCT_NAME_TEMPLATE_SLOT)
    .map(escapePattern)
    .join('(.+?)');
  if (!pattern) return null;
  const match = new RegExp(`^${pattern}$`).exec(productName.trim());
  return match ? match.slice(1) : null;
}

function getOccupiedProjectNumbers(
  products: InvestmentProduct[],
  template: string,
  reservedNumbers: number[],
  occupiedStatusNames: string[],
) {
  const occupied = new Set<number>(reservedNumbers);
  products.forEach(product => {
    const backup = product.status === '项目备用' || product.projectBackup;
    const stopped = product.status.includes('中止') || product.status.includes('终止');
    if (!backup && stopped) return;
    if (!backup && !occupiedStatusNames.includes(product.status)) return;
    const value = getProductNameTemplateValues(product.productName || '', template)?.[0];
    if (value && /^\d+$/.test(value)) occupied.add(Number(value));
  });
  return occupied;
}

function smallestAvailableProjectNumber(
  products: InvestmentProduct[],
  template: string,
  reservedNumbers: number[],
  occupiedStatusNames: string[],
) {
  const occupied = getOccupiedProjectNumbers(products, template, reservedNumbers, occupiedStatusNames);
  let candidate = 1;
  while (occupied.has(candidate)) candidate += 1;
  return candidate;
}

function ProjectTablePreferenceSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-5 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative flex h-7 w-12 shrink-0 items-center border p-[3px] ${checked ? 'border-primary-600 bg-primary-600' : 'border-slate-300 bg-slate-200'}`}
      >
        <span
          aria-hidden="true"
          className={`block h-5 w-5 shrink-0 bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

export default function ProjectList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const routeProjectId = searchParams.get('projectId');
  const routeTableRowId = searchParams.get('tableRow');
  const routeProjectField = searchParams.get('field');
  const { products, fetchProducts, isLoading, updateProduct, batchUpdateProducts, applyRemoteProductUpdate, addProduct, insertProductAt, deleteProduct, deleteProducts, replaceProducts, mergeProducts } = useProjectStore(useShallow(s => ({products: s.products, fetchProducts: s.fetchProducts, isLoading: s.isLoading, updateProduct: s.updateProduct, batchUpdateProducts: s.batchUpdateProducts, applyRemoteProductUpdate: s.applyRemoteProductUpdate, addProduct: s.addProduct, insertProductAt: s.insertProductAt, deleteProduct: s.deleteProduct, deleteProducts: s.deleteProducts, replaceProducts: s.replaceProducts, mergeProducts: s.mergeProducts})));
  const {
    entries: workLogEntries,
    currentWeekKey,
    selectedWeekKey,
    setSelectedWeekKey,
  } = useWorkLogStore(useShallow(s => ({
    entries: s.entries,
    currentWeekKey: s.currentWeekKey,
    selectedWeekKey: s.selectedWeekKey,
    setSelectedWeekKey: s.setSelectedWeekKey,
  })));
  const settings = useSettingsStore(s => s.settings);
  const updateColumnOrder = useSettingsStore(s => s.updateColumnOrder);
  const currentUser = useAuthStore(s => s.user);
  const projectPageSnapshot = useMemo(() => readPageSnapshot<ProjectPageSnapshot>('projects', currentUser?.id), [currentUser?.id]);
  const accountName = currentUser?.display_name?.trim() || '';
  const [searchQuery, setSearchQuery] = useState(() => String(projectPageSnapshot.searchQuery || ''));
  const showOnlyMine = useUiPreferenceStore(state => state.preferences.projectOnlyMine);
  const selectedManagerFilters = useUiPreferenceStore(state => state.preferences.projectManagerFilters);
  const projectCardFields = useUiPreferenceStore(state => state.preferences.projectCardFields);
  const projectUiPreferences = useUiPreferenceStore(state => state.preferences);
  const setOnlyMinePreference = useUiPreferenceStore(state => state.setOnlyMine);
  const setProjectCardFieldsPreference = useUiPreferenceStore(state => state.setProjectCardFields);
  const updateUiPreferences = useUiPreferenceStore(state => state.updatePreferences);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importInitialFile, setImportInitialFile] = useState<File | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
  const [detailProductId, setDetailProductId] = useState<string | null>(() => projectPageSnapshot.detailProductId || null);
  const [newProjectDraft, setNewProjectDraft] = useState<InvestmentProduct | null>(() => projectPageSnapshot.newProjectDraft || null);
  const [newProjectNamePrefix, setNewProjectNamePrefix] = useState(() => String(projectPageSnapshot.newProjectNamePrefix || ''));
  const [newProjectNameSuffix, setNewProjectNameSuffix] = useState(() => String(projectPageSnapshot.newProjectNameSuffix || ''));
  const [newProjectNumber, setNewProjectNumber] = useState(() => String(projectPageSnapshot.newProjectNumber || ''));
  const [focusedProjectField, setFocusedProjectField] = useState<string | null>(() => projectPageSnapshot.focusedProjectField || null);
  const [activeProjectStageIds, setActiveProjectStageIds] = useState<string[]>(() => projectPageSnapshot.activeProjectStageIds || []);
  const projectStageTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const pendingProjectStageTapRef = useRef<{ stageId: string; wasActive: boolean; time: number } | null>(null);
  const pendingProjectStageTapTimerRef = useRef<number | null>(null);
  // The preference store is the single source of truth. Keeping a second local
  // state allowed preference hydration/remounts to restore the stale card view.
  const displayMode: 'cards' | 'table' | 'fs' = projectUiPreferences.projectViewMode;
  const isMobileViewport = useMobileViewport();
  const effectiveDisplayMode: 'cards' | 'table' | 'fs' = isMobileViewport ? 'cards' : displayMode;
  const [excelFullscreen, setExcelFullscreen] = useState(false);
  const [cardSettingsOpen, setCardSettingsOpen] = useState(false);
  const [tableSettingsOpen, setTableSettingsOpen] = useState(false);
  const [cardFieldDraft, setCardFieldDraft] = useState<string[]>(projectCardFields);
  const [cardSettingsSaving, setCardSettingsSaving] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(() => projectPageSnapshot.selectedProductIds || []);
  const [filteredTableRowIds, setFilteredTableRowIds] = useState<string[]>([]);
  const [projectTableToolbarHost, setProjectTableToolbarHost] = useState<HTMLDivElement | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<ProjectWorkspaceTab>(() => projectPageSnapshot.workspaceTab || 'overview');
  const [mobileProjectStage, setMobileProjectStage] = useState('all');
  const [mobileProjectFilterOpen, setMobileProjectFilterOpen] = useState(false);
  const [mobileCreateStep, setMobileCreateStep] = useState<1 | 2 | 3>(1);
  const [mobileProjectEditField, setMobileProjectEditField] = useState<MobileDetailEditorField | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<ProjectCloudFile[]>([]);
  const [workspaceHistory, setWorkspaceHistory] = useState<ProjectHistoryEntry[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [snapshotEntries, setSnapshotEntries] = useState<WorkLogEntry[]>([]);
  const [snapshotWeekKeys, setSnapshotWeekKeys] = useState<string[]>([]);
  const [workLogHandoff, setWorkLogHandoff] = useState<WorkLogHandoff | null>(null);
  const [temporarilyPinnedProjectIds, setTemporarilyPinnedProjectIds] = useState<string[]>([]);
  useEffect(() => {
    writePageSnapshot<ProjectPageSnapshot>('projects', currentUser?.id, {
      searchQuery, detailProductId, newProjectDraft, activeProjectStageIds, selectedProductIds,
      workspaceTab, newProjectNamePrefix, newProjectNameSuffix, newProjectNumber, focusedProjectField,
    });
  }, [activeProjectStageIds, currentUser?.id, detailProductId, focusedProjectField, newProjectDraft, newProjectNamePrefix, newProjectNameSuffix, newProjectNumber, searchQuery, selectedProductIds, workspaceTab]);
  const changeDisplayMode = (mode: 'cards' | 'table' | 'fs') => {
    void updateUiPreferences({ projectViewMode: mode }, '项目视图偏好保存失败');
  };

  useEffect(() => {
    const syncFullscreen = () => {
      setExcelFullscreen(document.fullscreenElement?.id === 'projects-content-scope');
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    syncFullscreen();
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleExcelFullscreen = async () => {
    const workspaceId = 'projects-content-scope';
    const workspace = document.getElementById(workspaceId);
    if (!workspace) return;
    try {
      if (document.fullscreenElement === workspace) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await workspace.requestFullscreen();
      }
    } catch {
      // 浏览器不支持或拒绝全屏时保持当前布局，不影响表格编辑。
    }
  };

  useEffect(() => {
    if (cardSettingsOpen) setCardFieldDraft(projectCardFields);
  }, [cardSettingsOpen, projectCardFields]);

  const lastEditByField = useMemo(() => {
    const latest: Record<string, LastEditInfo> = {};
    for (const entry of workspaceHistory) {
      if (!latest[entry.field]) latest[entry.field] = { editedBy: entry.editedBy, editedName: entry.editedName, editedAt: entry.editedAt };
    }
    return latest;
  }, [workspaceHistory]);
  const allWeekKeys = useMemo(() => {
    const keys = new Set<string>([currentWeekKey]);
    workLogEntries.forEach(entry => {
      if (entry.weekKey) keys.add(entry.weekKey);
      Object.keys(entry.weeklyProgress || {}).forEach(key => {
        if (key) keys.add(key);
      });
    });
    snapshotWeekKeys.forEach(key => {
      if (key) keys.add(key);
    });
    return Array.from(keys).filter(key => key !== '__legacy__').sort().reverse();
  }, [currentWeekKey, snapshotWeekKeys, workLogEntries]);
  const weekOptions = useMemo(
    () => allWeekKeys.map(key => ({ key, label: getWorkWeekLabelForKey(key) })),
    [allWeekKeys],
  );
  const workWeekLabel = getWorkWeekLabelForKey(selectedWeekKey || currentWeekKey);
  const visibleWorkLogEntries = useMemo(() => {
    if (!selectedWeekKey || selectedWeekKey === currentWeekKey) return workLogEntries;
    if (snapshotEntries.length > 0) return snapshotEntries;
    return workLogEntries.filter(entry => (
      entry.weekKey === selectedWeekKey
      || Object.prototype.hasOwnProperty.call(entry.weeklyProgress || {}, selectedWeekKey)
    ));
  }, [currentWeekKey, selectedWeekKey, snapshotEntries, workLogEntries]);

  // 订阅远程编辑
  useEffect(() => {
    const unsub = useCollaborationStore.subscribe((state, prev) => {
      if (state.edits !== prev.edits && state.edits.length > 0) {
        const latest = state.edits[state.edits.length - 1];
        if (latest.userId !== state.userId) {
          const existing = products.find(p => p.id === latest.recordId);
          if (existing) {
            applyRemoteProductUpdate(latest.recordId, { [latest.field]: latest.value } as any);
          }
        }
      }
    });
    return unsub;
  }, [products, applyRemoteProductUpdate]);

  useEffect(() => {
    let cancelled = false;
    getWorkLogSnapshotWeekKeys()
      .then(weekKeys => {
        if (!cancelled) setSnapshotWeekKeys(weekKeys);
      })
      .catch(() => {
        if (!cancelled) setSnapshotWeekKeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workLogEntries.length]);

  useEffect(() => {
    if (
      !selectedWeekKey
      || selectedWeekKey === currentWeekKey
      || selectedWeekKey === '__legacy__'
    ) {
      setSnapshotEntries([]);
      return;
    }
    setSnapshotEntries([]);
    let cancelled = false;
    api.get<{ entries: WorkLogEntry[] }>(`/entries/snapshots/${encodeURIComponent(selectedWeekKey)}`)
      .then(result => {
        if (!cancelled) setSnapshotEntries(result.entries || []);
      })
      .catch(() => {
        if (!cancelled) setSnapshotEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentWeekKey, selectedWeekKey]);

  useEffect(() => {
    if (!routeProjectId) return;
    const target = products.find(product => product.id === routeProjectId);
    if (!target) return;
    setNewProjectDraft(null);
    setDetailProductId(target.id);
    setFocusedProjectField(routeProjectField);
  }, [products, routeProjectField, routeProjectId]);

  useEffect(() => {
    if (!routeTableRowId || !products.some(product => product.id === routeTableRowId)) return;
    setNewProjectDraft(null);
    if (isMobileViewport) {
      setDetailProductId(routeTableRowId);
      return;
    }
    setDetailProductId(null);
    if (displayMode !== 'table') changeDisplayMode('table');
  }, [displayMode, isMobileViewport, products, routeTableRowId]);

  useEffect(() => {
    if (routeProjectId) setWorkspaceTab('overview');
  }, [routeProjectField, routeProjectId]);

  const debouncedQuery = useDebounce(searchQuery, 200);

  const accountFilteredProducts = useMemo(
    () => currentUser?.business_role === 'admin' && selectedManagerFilters.length > 0
      ? products.filter(product => selectedManagerFilters.includes(String(product.trustManager || '').trim()) || selectedManagerFilters.includes(String(product.trustManagerB || '').trim()))
      : showOnlyMine && currentUser?.business_role !== 'admin'
        ? products.filter(product => isProjectAssignedToAccount(product, accountName))
        : products,
    [accountName, currentUser?.business_role, products, selectedManagerFilters, showOnlyMine],
  );

  const filteredProducts = useMemo(() => {
    if (!debouncedQuery) return accountFilteredProducts;
    const query = debouncedQuery.toLowerCase();
    return accountFilteredProducts.filter(
      (p) =>
        p.productName.toLowerCase().includes(query) ||
        p.client.toLowerCase().includes(query) ||
        p.trustManager.toLowerCase().includes(query) ||
        String(p.trustManagerB || '').toLowerCase().includes(query)
    );
  }, [accountFilteredProducts, debouncedQuery]);

  const activeProjectStages = useMemo(
    () => settings.statusConfigs.some(status => status.name === PROJECT_BACKUP_STATUS_CONFIG.name)
      ? settings.statusConfigs
      : [...settings.statusConfigs, PROJECT_BACKUP_STATUS_CONFIG],
    [settings.statusConfigs],
  );

  useEffect(() => {
    const availableIds = new Set(activeProjectStages.map(status => status.id));
    setActiveProjectStageIds(current => {
      if (current.length === 0) return activeProjectStages.map(status => status.id);
      const valid = current.filter(id => availableIds.has(id));
      return valid.length === current.length ? current : valid;
    });
  }, [activeProjectStages]);

  useEffect(() => () => {
    if (pendingProjectStageTapTimerRef.current !== null) {
      window.clearTimeout(pendingProjectStageTapTimerRef.current);
    }
  }, []);

  const selectedProjectStages = useMemo(
    () => activeProjectStages.filter(status => activeProjectStageIds.includes(status.id)),
    [activeProjectStageIds, activeProjectStages],
  );
  const selectedProjectStageNames = useMemo(
    () => new Set(selectedProjectStages.map(status => status.name)),
    [selectedProjectStages],
  );

  const stageFilteredProducts = useMemo(() => {
    if (selectedProjectStageNames.size === 0) return [];
    return filteredProducts.filter(product => selectedProjectStageNames.has(product.status));
  }, [filteredProducts, selectedProjectStageNames]);

  const modeFilteredProducts = effectiveDisplayMode === 'fs' ? filteredProducts : stageFilteredProducts;
  const viewFilteredProducts = useMemo(() => {
    if (!routeTableRowId || modeFilteredProducts.some(product => product.id === routeTableRowId)) {
      return modeFilteredProducts;
    }
    const searchTarget = products.find(product => product.id === routeTableRowId);
    return searchTarget ? [searchTarget, ...modeFilteredProducts] : modeFilteredProducts;
  }, [modeFilteredProducts, products, routeTableRowId]);
  const boardStatusConfigs = useMemo(() => {
    return selectedProjectStages;
  }, [selectedProjectStages]);
  const projectFieldOptions = useMemo(() => ({
    ...settings.fieldOptions,
    status: mergeSelectOptions(
      settings.statusConfigs.map(status => status.name),
      [PROJECT_BACKUP_STATUS_CONFIG.name],
      products.map(product => product.status),
    ),
    trustManager: mergeSelectOptions(
      settings.trustManagers.map(manager => manager.name),
      products.map(product => product.trustManager),
    ),
    trustManagerB: mergeSelectOptions(
      settings.trustManagers.map(manager => manager.name),
      products.map(product => product.trustManagerB || ''),
    ),
    custodianBank: mergeSelectOptions(
      settings.custodianBanks.map(bank => bank.name),
      products.map(product => product.custodianBank),
    ),
    projectCategory: mergeSelectOptions([...PROJECT_CATEGORY_OPTIONS], products.map(product => product.projectCategory || '')),
    activePassive: mergeSelectOptions([...ACTIVE_PASSIVE_OPTIONS], products.map(product => product.activePassive || '')),
    collectiveSingle: mergeSelectOptions([...COLLECTIVE_SINGLE_OPTIONS], products.map(product => product.collectiveSingle || '')),
  }), [products, settings.statusConfigs, settings.trustManagers, settings.custodianBanks, settings.fieldOptions]);

  const projectNamePrefixes = settings.projectNamePrefixes?.length
    ? settings.projectNamePrefixes
    : ['跨境投资'];
  const projectNameSuffixes = settings.projectNameSuffixes?.length
    ? settings.projectNameSuffixes
    : ['号'];
  const newProjectNameTemplate = newProjectNamePrefix && newProjectNameSuffix
    ? `${newProjectNamePrefix}${PRODUCT_NAME_TEMPLATE_SLOT}${newProjectNameSuffix}`
    : '';
  const occupiedProjectStatusNames = useMemo(() => {
    const occupiedIds = settings.projectNumberOccupiedStatusIds
      ?? settings.statusConfigs.map(status => status.id);
    return settings.statusConfigs
      .filter(status => occupiedIds.includes(status.id))
      .map(status => status.name);
  }, [settings.projectNumberOccupiedStatusIds, settings.statusConfigs]);
  const reservedNumbersForNewProject = useMemo(() => (
    newProjectNameTemplate
      ? settings.reservedProjectNumbersByTemplate?.[
        scopedProductNameTemplateKey('project', newProjectNameTemplate)
      ] || []
      : []
  ), [newProjectNameTemplate, settings.reservedProjectNumbersByTemplate]);
  const occupiedNumbersForNewProject = useMemo(() => (
    newProjectNameTemplate
      ? getOccupiedProjectNumbers(
        products,
        newProjectNameTemplate,
        reservedNumbersForNewProject,
        occupiedProjectStatusNames,
      )
      : new Set<number>()
  ), [newProjectNameTemplate, occupiedProjectStatusNames, products, reservedNumbersForNewProject]);
  const newProjectNumberConflict = /^\d+$/.test(newProjectNumber)
    && occupiedNumbersForNewProject.has(Number(newProjectNumber));

  // 当前汇率
  const activeExchangeRate = settings.exchangeRate;
  const createProjectDraft = (): InvestmentProduct => {
    const now = new Date().toISOString();
    const defaultTrustManager = currentUser?.business_role === 'trust_manager' ? (currentUser.display_name || '') : '';
    return {
      id: `draft-${generateId()}`,
      createdAt: now,
      updatedAt: now,
      productName: '',
      usd: 0,
      rmb: 0,
      feeRate: 0,
      projectCreatedDate: now.slice(0, 10),
      establishDate: '',
      projectStoppedDate: '',
      target: '',
      client: '',
      brokerChannel: '',
      strategy: '',
      custodianBank: '',
      tradingBroker: '',
      annualIncome: 0,
      thisYearIncome: 0,
      performanceIncome: 0,
      status: settings.statusConfigs[0]?.name || '',
      projectCategory: '',
      activePassive: '',
      collectiveSingle: '',
      trustManager: defaultTrustManager,
      trustManagerB: '',
      deadline: '',
      remarks: '',
      dynamicFields: {},
    };
  };
  const detailProduct = useMemo(
    () => newProjectDraft || products.find(product => product.id === detailProductId) || null,
    [detailProductId, newProjectDraft, products],
  );
  const isCreatingProject = Boolean(newProjectDraft);
  const hasDetailProduct = Boolean(detailProduct);
  const relatedWorkLogs = useMemo(() => {
    if (!detailProduct?.productName) return [];
    return visibleWorkLogEntries
      .filter(entry => isRelatedWorkLog(detailProduct, entry, products))
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''));
  }, [detailProduct, products, visibleWorkLogEntries]);
  const relatedFiles = useMemo(() => {
    const key = projectRelationKey(detailProduct?.productName);
    if (!key) return [];
    const seriesKey = projectSeriesKey(detailProduct?.productName);
    const sameSeriesCount = seriesKey ? products.filter(item => projectSeriesKey(item.productName) === seriesKey).length : 0;
    const clientKey = relationPartyKey(detailProduct?.client);
    return workspaceFiles
      .filter(file => {
        if (file.projectId) return file.projectId === detailProduct?.id;
        const text = projectRelationKey(`${file.fileName} ${file.remark || ''}`);
        if (!text.includes(key)) return false;
        if (sameSeriesCount <= 1) return true;
        return Boolean(clientKey) && relationPartyKey(text).includes(clientKey);
      })
      .sort((left, right) => (right.uploadedAt || '').localeCompare(left.uploadedAt || ''));
  }, [detailProduct?.client, detailProduct?.productName, products, workspaceFiles]);

  const openLinkedWorkLogDraft = () => {
    if (!detailProduct) return;
    window.location.href = `/worklog?createFromProject=${encodeURIComponent(detailProduct.id)}`;
  };

  const promptWorkLogHandoff = (product: InvestmentProduct) => {
    const existingEntry = workLogEntries
      .filter(entry => entry.projectId === product.id)
      .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))[0];
    setWorkLogHandoff({ product: { ...product, status: '已成立' }, existingEntry });
  };

  useEffect(() => {
    if (!detailProductId || newProjectDraft) {
      setWorkspaceFiles([]);
      setWorkspaceHistory([]);
      setWorkspaceLoading(false);
      return;
    }

    let cancelled = false;
    setWorkspaceLoading(true);
    Promise.all([
      api.get<{ items: ProjectCloudFile[] }>('/clouddrive').catch(() => ({ items: [] })),
      api.get<{ entries: ProjectHistoryEntry[] }>(`/history/product/${encodeURIComponent(detailProductId)}`).catch(() => ({ entries: [] })),
    ]).then(([fileResult, historyResult]) => {
      if (cancelled) return;
      setWorkspaceFiles(fileResult.items || []);
      setWorkspaceHistory(historyResult.entries || []);
    }).finally(() => {
      if (!cancelled) setWorkspaceLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [detailProductId, newProjectDraft, workspaceTab]);
  const projectEditingPresenceRef = useRef<{
    recordType: string;
    recordId: string | null;
    recordLabel: string;
    field: string;
    fieldLabel: string;
    location: string;
    startedAt: number;
  } | null>(null);
  const projectEditingTimerRef = useRef<number | null>(null);

  const stopProjectEditing = () => {
    if (projectEditingTimerRef.current) {
      window.clearInterval(projectEditingTimerRef.current);
      projectEditingTimerRef.current = null;
    }
    if (!projectEditingPresenceRef.current) return;
    broadcastEditingStop(projectEditingPresenceRef.current);
    projectEditingPresenceRef.current = null;
  };

  const startProjectEditing = (field: string, fieldLabel: string) => {
    if (!detailProduct || newProjectDraft) return;
    if (
      projectEditingPresenceRef.current?.recordId === detailProduct.id &&
      projectEditingPresenceRef.current?.field === field
    ) {
      return;
    }
    stopProjectEditing();
    const payload = {
      recordType: 'product',
      recordId: detailProduct.id,
      recordLabel: detailProduct.productName || detailProduct.id,
      field,
      fieldLabel,
      location: '项目进度',
      startedAt: Date.now(),
    };
    projectEditingPresenceRef.current = payload;
    broadcastEditingStart(payload);
    projectEditingTimerRef.current = window.setInterval(() => {
      if (projectEditingPresenceRef.current) broadcastEditingStart(projectEditingPresenceRef.current);
    }, 15000);
  };

  useEffect(() => () => {
    stopProjectEditing();
  }, []);

  useEffect(() => {
    if (!detailProduct || newProjectDraft) {
      stopProjectEditing();
      return;
    }
    startProjectEditing('detail', '详情');
    return () => {
      stopProjectEditing();
    };
  }, [detailProduct?.id, newProjectDraft?.id]);

  useEffect(() => {
    if (!hasDetailProduct || !focusedProjectField) return;
    const timer = window.setTimeout(() => {
      const target = document.querySelector(`[data-project-field="${CSS.escape(focusedProjectField)}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [detailProductId, focusedProjectField, hasDetailProduct, newProjectDraft?.id]);

  const openProjectDetail = (product: InvestmentProduct, fieldKey?: string) => {
    setNewProjectDraft(null);
    setDetailProductId(product.id);
    setFocusedProjectField(fieldKey || null);
    setWorkspaceTab('overview');
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.set('projectId', product.id);
      if (fieldKey) next.set('field', fieldKey);
      else next.delete('field');
      return next;
    });
  };

  useEffect(() => {
    if (!detailProductId || newProjectDraft || effectiveDisplayMode !== 'cards') return;
    const handleProjectCardNavigation = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="listbox"], [role="dialog"]')) return;

      const pinRank = new Map(temporarilyPinnedProjectIds.map((id, index) => [id, index]));
      const sortStageProducts = (items: InvestmentProduct[]) => [...items].sort((left, right) => {
        const leftRank = pinRank.get(left.id);
        const rightRank = pinRank.get(right.id);
        if (leftRank !== undefined || rightRank !== undefined) {
          if (leftRank === undefined) return 1;
          if (rightRank === undefined) return -1;
          return leftRank - rightRank;
        }
        return (left.productName || '').localeCompare(right.productName || '', 'zh-CN');
      });
      const current = viewFilteredProducts.find(product => product.id === detailProductId);
      if (!current) return;
      const currentStageIndex = boardStatusConfigs.findIndex(stage => stage.name === current.status);
      if (currentStageIndex < 0) return;
      const currentStageProducts = sortStageProducts(viewFilteredProducts.filter(product => product.status === current.status));
      const currentItemIndex = currentStageProducts.findIndex(product => product.id === current.id);
      let nextProduct: InvestmentProduct | undefined;

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const nextIndex = Math.max(0, Math.min(currentStageProducts.length - 1, currentItemIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        nextProduct = currentStageProducts[nextIndex];
      } else {
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        for (let stageIndex = currentStageIndex + direction; stageIndex >= 0 && stageIndex < boardStatusConfigs.length; stageIndex += direction) {
          const stageProducts = sortStageProducts(viewFilteredProducts.filter(product => product.status === boardStatusConfigs[stageIndex].name));
          if (!stageProducts.length) continue;
          nextProduct = stageProducts[Math.max(0, Math.min(stageProducts.length - 1, currentItemIndex))];
          break;
        }
      }

      if (!nextProduct || nextProduct.id === current.id) return;
      event.preventDefault();
      openProjectDetail(nextProduct);
    };
    window.addEventListener('keydown', handleProjectCardNavigation);
    return () => window.removeEventListener('keydown', handleProjectCardNavigation);
  }, [boardStatusConfigs, detailProductId, effectiveDisplayMode, newProjectDraft, temporarilyPinnedProjectIds, viewFilteredProducts]);

  const buildProjectUpdates = (product: InvestmentProduct, field: string, value: string | number) => {
    const updates: Partial<InvestmentProduct> = {};
    const numberFields = new Set<keyof InvestmentProduct>([
      'usd',
      'rmb',
      'feeRate',
      'annualIncome',
      'thisYearIncome',
      'performanceIncome',
    ]);

    if (field.startsWith('dynamicFields.')) {
      const dynamicKey = field.replace('dynamicFields.', '');
      updates.dynamicFields = {
        ...(product.dynamicFields || {}),
        [dynamicKey]: value,
      };
    } else {
      (updates as any)[field] = numberFields.has(field as keyof InvestmentProduct)
        ? (field === 'feeRate' ? normalizeRate(Number(value)) : Number(value) || 0)
        : value;
    }

    if (field === 'projectCategory') {
      Object.assign(updates, projectCategoryLinkage(String(value)) || {});
    }

    if (field === 'usd') {
      const usd = Number(value) || 0;
      if (usd > 0) updates.rmb = Math.round(usd * activeExchangeRate * 100) / 100;
    }
    if (field === 'rmb') {
      const rmb = Number(value) || 0;
      if (rmb > 0) updates.usd = Math.round(rmb / activeExchangeRate * 100) / 100;
    }

    if (field === 'establishDate') {
      updates.deadline = defaultDeadlineForEstablishDate(String(value));
    }

    if (['usd', 'rmb', 'feeRate', 'establishDate', 'deadline'].includes(String(field))) {
      const rmb = Number(updates.rmb ?? product.rmb) || 0;
      const feeRate = Number(updates.feeRate ?? product.feeRate) || 0;
      const establishDate = String(updates.establishDate ?? product.establishDate ?? '');
      const deadline = String(updates.deadline ?? product.deadline ?? defaultDeadlineForEstablishDate(establishDate));
      Object.assign(updates, computeIncome(rmb, feeRate, establishDate, deadline));
    }

    return updates;
  };

  const updateProjectField = (product: InvestmentProduct, field: string, value: string | number) => {
    if (field === 'productName') {
      const productName = String(value).trim();
      if (!productName) {
        _toast.warning?.('项目名称不能为空');
        return false;
      }
      const duplicate = findProjectNameDuplicate(products, productName, product.id, occupiedProjectStatusNames);
      if (duplicate) {
        _toast.warning?.(`项目名称“${productName}”已存在`);
        return false;
      }
      value = productName;
    }
    const updates = buildProjectUpdates(product, field, value);
    updateProduct(product.id, updates);
    return true;
  };

  const handleAdvanceProject = (product: InvestmentProduct, nextStatus: string) => {
    if (!nextStatus || nextStatus === product.status) return;
    updateProduct(product.id, { status: nextStatus });
    setTemporarilyPinnedProjectIds(current => [product.id, ...current.filter(id => id !== product.id)]);
    if (nextStatus === '已成立' && product.status !== '已成立') promptWorkLogHandoff(product);
  };

  const handleRetreatProject = (product: InvestmentProduct, previousStatus: string) => {
    if (!previousStatus || previousStatus === product.status) return;
    updateProduct(product.id, { status: previousStatus });
    setTemporarilyPinnedProjectIds(current => current.filter(id => id !== product.id));
  };

  const requestDeleteProject = (product: InvestmentProduct) => {
    setDeleteTargetId(product.id);
    setDeleteConfirmOpen(true);
  };

  const handleExcelBatchEdit = async (changes: Array<{ id: string; field: string; lockField?: string; value: string | number }>, label?: string) => {
    const working = new Map(products.map(product => [product.id, product]));
    const expanded = new Map<string, { id: string; field: string; lockField?: string; value: string | number }>();
    for (const change of changes) {
      const product = working.get(change.id);
      if (!product) continue;
      const updates = buildProjectUpdates(product, change.field, change.value);
      const nextProduct = { ...product, ...updates };
      working.set(change.id, nextProduct);
      for (const [field, value] of Object.entries(updates)) {
        if (field === 'dynamicFields') {
          const dynamicEntries: Array<[string, string | number]> = change.field.startsWith('dynamicFields.')
            ? [[change.field.slice('dynamicFields.'.length), (value as Record<string, string | number>)[change.field.slice('dynamicFields.'.length)]]]
            : Object.entries(value || {}) as Array<[string, string | number]>;
          for (const [dynamicKey, dynamicValue] of dynamicEntries) {
            expanded.set(`${change.id}:dynamicFields.${dynamicKey}`, {
              id: change.id, field: `dynamicFields.${dynamicKey}`, lockField: dynamicKey,
              value: dynamicValue as string | number,
            });
          }
        } else if (typeof value === 'string' || typeof value === 'number') {
          expanded.set(`${change.id}:${field}`, { id: change.id, field, lockField: field === change.field ? change.lockField : field, value });
        }
      }
    }
    return batchUpdateProducts([...expanded.values()], label);
  };

  const updateDetailField = (field: keyof InvestmentProduct, value: string | number) => {
    if (!detailProduct) return;
    if (newProjectDraft) {
      const updates = buildProjectUpdates(newProjectDraft, field, value);
      setNewProjectDraft(current => current ? { ...current, ...updates, updatedAt: new Date().toISOString() } : current);
      return;
    }
    const previousValue = (detailProduct as any)[field];
    if (String(previousValue ?? '') !== String(value ?? '')) {
      setWorkspaceHistory(current => [{
        id: `local-${Date.now()}-${String(field)}`,
        field: String(field),
        oldValue: String(previousValue ?? ''),
        newValue: String(value ?? ''),
        editedBy: currentUser?.id || '',
        editedName: currentUser?.display_name || currentUser?.id || '当前用户',
        editedAt: new Date().toISOString(),
      }, ...current]);
    }
    const changed = updateProjectField(detailProduct, field, value);
    if (changed && field === 'status' && value === '已成立' && detailProduct.status !== '已成立') {
      promptWorkLogHandoff(detailProduct);
    }
  };

  const applyNewProjectName = (prefix: string, number: string, suffix: string) => {
    setNewProjectNamePrefix(prefix);
    setNewProjectNumber(number);
    setNewProjectNameSuffix(suffix);
    setNewProjectDraft(current => current
      ? {
        ...current,
        productName: prefix && suffix ? `${prefix}${number}${suffix}` : '',
        updatedAt: new Date().toISOString(),
      }
      : current);
  };

  const openNewProjectDetail = () => {
    setMobileCreateStep(1);
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.delete('projectId');
      next.delete('field');
      return next;
    });
    setDetailProductId(null);
    setFocusedProjectField('productName');
    setWorkspaceTab('overview');
    const defaultPrefix = projectNamePrefixes[0] || '';
    const defaultSuffix = projectNameSuffixes[0] || '';
    const defaultTemplate = defaultPrefix && defaultSuffix
      ? `${defaultPrefix}${PRODUCT_NAME_TEMPLATE_SLOT}${defaultSuffix}`
      : '';
    const defaultNumber = defaultTemplate
      ? String(smallestAvailableProjectNumber(
        products,
        defaultTemplate,
        settings.reservedProjectNumbersByTemplate?.[
          scopedProductNameTemplateKey('project', defaultTemplate)
        ] || [],
        occupiedProjectStatusNames,
      ))
      : '';
    const draft = createProjectDraft();
    draft.productName = defaultTemplate ? `${defaultPrefix}${defaultNumber}${defaultSuffix}` : '';
    setNewProjectNamePrefix(defaultPrefix);
    setNewProjectNameSuffix(defaultSuffix);
    setNewProjectNumber(defaultNumber);
    setNewProjectDraft(draft);
  };

  const closeProjectDetail = () => {
    stopProjectEditing();
    setDeleteConfirmOpen(false);
    setDetailProductId(null);
    setNewProjectDraft(null);
    setNewProjectNamePrefix('');
    setNewProjectNameSuffix('');
    setNewProjectNumber('');
    setFocusedProjectField(null);
    setWorkspaceTab('overview');
    setMobileCreateStep(1);
    setSearchParams(params => {
      const next = new URLSearchParams(params);
      next.delete('projectId');
      next.delete('field');
      return next;
    });
  };

  const saveNewProject = () => {
    if (!newProjectDraft) return;
    if (!newProjectNamePrefix || !newProjectNameSuffix) {
      _toast.warning?.('请先在产品设置中添加项目名称前缀和后缀');
      return;
    }
    if (!/^\d+$/.test(newProjectNumber) || Number(newProjectNumber) < 1) {
      _toast.warning?.('项目编号只能填写正整数');
      return;
    }
    if (newProjectNumberConflict) {
      _toast.warning?.(`编号 ${newProjectNumber} 已被占用或预留`);
      return;
    }
    const productName = newProjectDraft.productName.trim();
    if (!productName) {
      _toast.warning?.('项目名称不能为空');
      return;
    }
    if (findProjectNameDuplicate(products, productName, newProjectDraft.id, occupiedProjectStatusNames)) {
      _toast.warning?.(`项目名称“${productName}”已存在`);
      return;
    }
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...product } = newProjectDraft;
    addProduct({ ...product, productName });
    closeProjectDetail();
  };

  const handleDeleteProject = async () => {
    const target = products.find(product => product.id === deleteTargetId) || detailProduct;
    if (!target || newProjectDraft) return;
    const deleted = await deleteProduct(target.id);
    if (!deleted) return;
    setSelectedProductIds(current => current.filter(id => id !== target.id));
    if (detailProduct?.id === target.id) closeProjectDetail();
    setDeleteTargetId(null);
    setDeleteConfirmOpen(false);
  };

  const handleBatchDeleteProjects = async () => {
    if (selectedProductIds.length === 0) return;
    const ids = [...selectedProductIds];
    if (ids.length === 1) {
      const deleted = await deleteProduct(ids[0]);
      if (!deleted) return;
      setSelectedProductIds([]);
      setBatchDeleteConfirmOpen(false);
      if (detailProduct?.id === ids[0]) closeProjectDetail();
      return;
    }
    const result = await deleteProducts(ids);
    setSelectedProductIds(result.deniedIds);
    setBatchDeleteConfirmOpen(false);
    if (detailProduct && result.deletedIds.includes(detailProduct.id)) closeProjectDetail();
  };

  const projectShellViews = useMemo(() => {
    return activeProjectStages.map(stage => ({
      key: stage.id,
      label: stage.name,
      count: accountFilteredProducts.filter(product => product.status === stage.name).length,
      active: activeProjectStageIds.includes(stage.id),
      onClick: () => setActiveProjectStageIds(current => current.includes(stage.id)
        ? current.filter(id => id !== stage.id)
        : [...current, stage.id]),
    }));
  }, [accountFilteredProducts, activeProjectStageIds, activeProjectStages]);

  const toggleProjectStage = (stageId: string) => {
    setActiveProjectStageIds(current => current.includes(stageId)
      ? current.filter(id => id !== stageId)
      : [...current, stageId]);
  };

  const handleProjectStageTouchEnd = (stageId: string, wasActive: boolean, x: number, y: number) => {
    const touchStart = projectStageTouchStartRef.current;
    projectStageTouchStartRef.current = null;
    if (!touchStart || Math.hypot(x - touchStart.x, y - touchStart.y) > 10) {
      if (pendingProjectStageTapTimerRef.current !== null) {
        window.clearTimeout(pendingProjectStageTapTimerRef.current);
        pendingProjectStageTapTimerRef.current = null;
      }
      pendingProjectStageTapRef.current = null;
      return false;
    }

    const now = Date.now();
    const pendingTap = pendingProjectStageTapRef.current;
    if (pendingTap && pendingTap.stageId === stageId && now - pendingTap.time <= 320) {
      if (pendingProjectStageTapTimerRef.current !== null) {
        window.clearTimeout(pendingProjectStageTapTimerRef.current);
        pendingProjectStageTapTimerRef.current = null;
      }
      pendingProjectStageTapRef.current = null;
      setActiveProjectStageIds(pendingTap.wasActive ? [] : activeProjectStages.map(stage => stage.id));
      return true;
    }

    if (pendingTap) {
      if (pendingProjectStageTapTimerRef.current !== null) {
        window.clearTimeout(pendingProjectStageTapTimerRef.current);
      }
      toggleProjectStage(pendingTap.stageId);
    }

    pendingProjectStageTapRef.current = { stageId, wasActive, time: now };
    pendingProjectStageTapTimerRef.current = window.setTimeout(() => {
      toggleProjectStage(stageId);
      pendingProjectStageTapRef.current = null;
      pendingProjectStageTapTimerRef.current = null;
    }, 320);
    return true;
  };

  const handleExport = async () => {
    await exportProjectProgress({
      products: viewFilteredProducts,
      scopeLabel: searchQuery ? `搜索_${searchQuery}` : '当前视图',
      exchangeRate: activeExchangeRate,
    });
  };

  const handleImport = async (rows: Partial<InvestmentProduct>[], mode: ImportMode) => {
    const now = new Date().toISOString();
    const exchangeRate = activeExchangeRate;

    const preparedRows: Partial<InvestmentProduct>[] = rows.map(row => {
      const derived = calculateDerivedFields(row, exchangeRate);
      return { ...row, ...derived };
    });
    const createImportedProduct = (row: Partial<InvestmentProduct>): InvestmentProduct => ({
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        productName: row.productName || '',
        usd: row.usd ?? 0,
        rmb: row.rmb ?? 0,
        feeRate: row.feeRate ?? 0,
        projectCreatedDate: row.projectCreatedDate || row.progressStartDate || '',
        establishDate: row.establishDate || '',
        projectStoppedDate: row.projectStoppedDate || '',
        target: row.target || '',
        client: row.client || '',
        brokerChannel: row.brokerChannel || '',
        strategy: row.strategy || '',
        custodianBank: row.custodianBank || '',
        tradingBroker: row.tradingBroker || '',
        annualIncome: row.annualIncome ?? 0,
        thisYearIncome: row.thisYearIncome ?? 0,
        performanceIncome: row.performanceIncome ?? 0,
        status: row.status || '',
        trustManager: row.trustManager || '',
        trustManagerB: row.trustManagerB || '',
        deadline: row.deadline || '',
        remarks: row.remarks || '',
        dynamicFields: row.dynamicFields || {},
      });
    const newProducts = preparedRows.map(createImportedProduct);

    try {
      if (mode === 'overwrite') {
        await replaceProducts(newProducts);
      } else {
        const merged = mergeImportRows(
          products,
          preparedRows,
          projectImportIdentity,
          createImportedProduct,
          now,
        );
        await mergeProducts(merged.changes);
        _toast.success?.(`合并完成：更新 ${merged.updated} 条，新增 ${merged.added} 条，未变化 ${merged.unchanged} 条`);
      }
      setShowImportModal(false);
      setImportInitialFile(null);
      if (mode === 'overwrite') {
        _toast.success?.(`已清除原有项目并导入 ${newProducts.length} 条项目数据`);
      }
      await fetchProducts();
    } catch {
      _toast.error?.(mode === 'overwrite' ? '导入失败，原有项目数据未被替换' : '合并失败，原有项目数据保持不变');
    }
  };

  const detailHeaderColor = detailProduct ? statusColor(detailProduct.status, settings.statusConfigs) : undefined;
  const detailStatus = String(detailProduct?.status || '');
  const detailIsStopped = detailStatus === '项目备用' || detailStatus.includes('中止') || detailStatus.includes('终止');
  const detailIsEstablished = detailStatus.includes('成立') || detailStatus.includes('落地');
  const establishDateLabel = detailIsEstablished ? '成立/落地日' : '（拟）成立日';
  const projectEditingHandlers = (_field: string, _label: string) => ({});
  const detailPanel = effectiveDisplayMode === 'cards' && detailProduct && !isCreatingProject ? (
    <DetailModal
      mode="panel"
      open
      title={detailProduct.productName || '未命名项目'}
      subtitle={`${detailProduct.status || '未填写状态'} · A角 ${detailProduct.trustManager || '未分配'}${detailProduct.trustManagerB ? ` · B角 ${detailProduct.trustManagerB}` : ''}`}
      headerColor={detailHeaderColor}
      onClose={closeProjectDetail}
    >
      <div className="space-y-4">
        {workspaceTab === 'overview' && (
          <>
        <DetailSection title="基础信息">
          <DetailGrid columns={1}>
            <ProjectNameField lastEdit={lastEditByField.productName} value={detailProduct.productName || ''} onChange={value => updateDetailField('productName', value)} focused={focusedProjectField === 'productName'} isDuplicate={value => Boolean(findProjectNameDuplicate(products, value, detailProduct.id, occupiedProjectStatusNames))} {...projectEditingHandlers('productName', '\u9879\u76ee\u540d\u79f0')} />
            <EditableProjectField lastEdit={lastEditByField.status} fieldKey="status" focused={focusedProjectField === 'status'} label="项目进度" value={detailProduct.status || ''} onChange={value => updateDetailField('status', value)} options={projectFieldOptions.status || []} {...projectEditingHandlers('status', '项目进度')} />
            <EditableProjectField lastEdit={lastEditByField.projectCategory} fieldKey="projectCategory" focused={focusedProjectField === 'projectCategory'} label="项目分类" value={detailProduct.projectCategory || ''} onChange={value => updateDetailField('projectCategory', value)} options={projectFieldOptions.projectCategory || []} {...projectEditingHandlers('projectCategory', '项目分类')} />
            <EditableProjectField lastEdit={lastEditByField.activePassive} fieldKey="activePassive" focused={focusedProjectField === 'activePassive'} label="主动 / 被动" value={detailProduct.activePassive || ''} onChange={value => updateDetailField('activePassive', value)} options={projectFieldOptions.activePassive || []} {...projectEditingHandlers('activePassive', '主动 / 被动')} />
            <EditableProjectField lastEdit={lastEditByField.collectiveSingle} fieldKey="collectiveSingle" focused={focusedProjectField === 'collectiveSingle'} label="集合 / 单一" value={detailProduct.collectiveSingle || ''} onChange={value => updateDetailField('collectiveSingle', value)} options={projectFieldOptions.collectiveSingle || []} {...projectEditingHandlers('collectiveSingle', '集合 / 单一')} />
            <EditableProjectField lastEdit={lastEditByField.trustManager} fieldKey="trustManager" focused={focusedProjectField === 'trustManager'} label="A角" value={detailProduct.trustManager || ''} onChange={value => updateDetailField('trustManager', value)} options={projectFieldOptions.trustManager || []} {...projectEditingHandlers('trustManager', 'A角')} />
            <EditableProjectField lastEdit={lastEditByField.trustManagerB} fieldKey="trustManagerB" focused={focusedProjectField === 'trustManagerB'} label="B角" value={detailProduct.trustManagerB || ''} onChange={value => updateDetailField('trustManagerB', value)} options={projectFieldOptions.trustManagerB || []} {...projectEditingHandlers('trustManagerB', 'B角')} />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="金额与收益">
          <DetailGrid columns={1}>
            <EditableProjectField lastEdit={lastEditByField.usd} fieldKey="usd" focused={focusedProjectField === 'usd'} label="美元规模（万美元）" value={detailProduct.usd ?? ''} onChange={value => updateDetailField('usd', value)} type="number" {...projectEditingHandlers('usd', '美元规模（万美元）')} />
            <EditableProjectField lastEdit={lastEditByField.rmb} fieldKey="rmb" focused={focusedProjectField === 'rmb'} label="人民币规模（万元）" value={detailProduct.rmb ?? ''} onChange={value => updateDetailField('rmb', value)} type="number" {...projectEditingHandlers('rmb', '人民币规模（万元）')} />
            <EditableProjectField lastEdit={lastEditByField.feeRate} fieldKey="feeRate" focused={focusedProjectField === 'feeRate'} label="费率（%）" value={feeRateToPercentInput(detailProduct.feeRate)} onChange={value => updateDetailField('feeRate', percentInputToFeeRate(value))} type="number" {...projectEditingHandlers('feeRate', '费率')} />
            <EditableProjectField lastEdit={lastEditByField.annualIncome} fieldKey="annualIncome" focused={focusedProjectField === 'annualIncome'} label="年化收入（万元）· 自动计算" value={detailProduct.annualIncome ?? ''} onChange={() => {}} type="number" readOnly />
            <EditableProjectField lastEdit={lastEditByField.thisYearIncome} fieldKey="thisYearIncome" focused={focusedProjectField === 'thisYearIncome'} label="今年收入（万元）· 自动计算" value={detailProduct.thisYearIncome ?? ''} onChange={() => {}} type="number" readOnly />
            <EditableProjectField lastEdit={lastEditByField.performanceIncome} fieldKey="performanceIncome" focused={focusedProjectField === 'performanceIncome'} label="绩效收入（万元）· 自动计算" value={detailProduct.performanceIncome ?? ''} onChange={() => {}} type="number" readOnly />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="业务信息">
          <DetailGrid columns={1}>
            <EditableProjectField lastEdit={lastEditByField.client} fieldKey="client" focused={focusedProjectField === 'client'} label="委托人" value={detailProduct.client || ''} onChange={value => updateDetailField('client', value)} {...projectEditingHandlers('client', '委托人')} />
            <EditableProjectField lastEdit={lastEditByField.target} fieldKey="target" focused={focusedProjectField === 'target'} label="标的" value={detailProduct.target || ''} onChange={value => updateDetailField('target', value)} {...projectEditingHandlers('target', '标的')} />
            <EditableProjectField lastEdit={lastEditByField.brokerChannel} fieldKey="brokerChannel" focused={focusedProjectField === 'brokerChannel'} label="券商渠道" value={detailProduct.brokerChannel || ''} onChange={value => updateDetailField('brokerChannel', value)} {...projectEditingHandlers('brokerChannel', '券商渠道')} />
            <EditableProjectField lastEdit={lastEditByField.custodianBank} fieldKey="custodianBank" focused={focusedProjectField === 'custodianBank'} label="托管行" value={detailProduct.custodianBank || ''} onChange={value => updateDetailField('custodianBank', value)} options={projectFieldOptions.custodianBank || []} {...projectEditingHandlers('custodianBank', '托管行')} />
            <EditableProjectField lastEdit={lastEditByField.tradingBroker} fieldKey="tradingBroker" focused={focusedProjectField === 'tradingBroker'} label="交易券商" value={detailProduct.tradingBroker || ''} onChange={value => updateDetailField('tradingBroker', value)} {...projectEditingHandlers('tradingBroker', '交易券商')} />
            <EditableProjectField lastEdit={lastEditByField.strategy} fieldKey="strategy" focused={focusedProjectField === 'strategy'} label="投资策略" value={detailProduct.strategy || ''} onChange={value => updateDetailField('strategy', value)} {...projectEditingHandlers('strategy', '投资策略')} />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="备注">
          <DetailGrid columns={1}>
            <EditableProjectField lastEdit={lastEditByField.remarks} fieldKey="remarks" focused={focusedProjectField === 'remarks'} label="备注" value={detailProduct.remarks || ''} onChange={value => updateDetailField('remarks', value)} multiline {...projectEditingHandlers('remarks', '备注')} />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="业务节点日期" description="截止日用于计算信托报酬，默认取（拟）成立日当年11月30日。">
          <DetailGrid columns={1}>
            <EditableProjectField lastEdit={lastEditByField.projectCreatedDate} fieldKey="projectCreatedDate" focused={focusedProjectField === 'projectCreatedDate'} label="项目创建日" value={detailProduct.projectCreatedDate || detailProduct.progressStartDate || ''} onChange={value => updateDetailField('projectCreatedDate', value)} type="date" {...projectEditingHandlers('projectCreatedDate', '项目创建日')} />
            <EditableProjectField lastEdit={lastEditByField.establishDate} fieldKey="establishDate" focused={focusedProjectField === 'establishDate'} label={establishDateLabel} value={detailProduct.establishDate || ''} onChange={value => updateDetailField('establishDate', value)} type="date" {...projectEditingHandlers('establishDate', establishDateLabel)} />
            <EditableProjectField lastEdit={lastEditByField.deadline} fieldKey="deadline" focused={focusedProjectField === 'deadline'} label="截止日" value={detailProduct.deadline || ''} onChange={value => updateDetailField('deadline', value)} type="date" {...projectEditingHandlers('deadline', '截止日')} />
            {detailIsStopped && <EditableProjectField lastEdit={lastEditByField.projectStoppedDate} fieldKey="projectStoppedDate" focused={focusedProjectField === 'projectStoppedDate'} label="项目中止日" value={detailProduct.projectStoppedDate || ''} onChange={value => updateDetailField('projectStoppedDate', value)} type="date" {...projectEditingHandlers('projectStoppedDate', '项目中止日')} />}
          </DetailGrid>
        </DetailSection>

        {!isCreatingProject && (
          <button
            type="button"
            onClick={() => requestDeleteProject(detailProduct)}
            className="flex h-11 w-full items-center justify-center gap-2 bg-danger-600 px-4 text-sm font-medium text-white hover:bg-danger-700"
          >
            <Trash2 size={16} />
            删除该条目
          </button>
        )}
          </>
        )}

        {workspaceTab === 'worklogs' && (
          <DetailSection title="关联周报" description="按项目名称自动聚合，点击可进入对应周报继续处理。">
            <div className="space-y-2">
              <button type="button" onClick={openLinkedWorkLogDraft} className="inline-flex h-9 items-center gap-2 border border-primary-600 bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700">
                <Plus size={15} />新建关联周报
              </button>
              {workspaceLoading && <div className="py-6 text-center text-sm text-slate-400">正在整理项目周报...</div>}
              {!workspaceLoading && relatedWorkLogs.length === 0 && (
                <div className="border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  暂未找到同名关联周报
                </div>
              )}
              {!workspaceLoading && relatedWorkLogs.map(entry => {
                const latest = latestWorkLogProgress(entry, selectedWeekKey || currentWeekKey);
                const href = `/worklog?entryId=${encodeURIComponent(entry.id)}${latest.weekKey ? `&weekKey=${encodeURIComponent(latest.weekKey)}` : ''}&field=weeklyProgress`;
                return (
                  <Link key={entry.id} to={href} className="group block border border-slate-200 bg-white px-3 py-3 hover:border-primary-600 hover:bg-primary-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{entry.productName || '未命名周报'}</div>
                        <div className="mt-1 text-xs text-slate-500">{entry.category || '管理周报'} · {[entry.personA, entry.personB].filter(Boolean).join(' / ') || '未分配'}</div>
                      </div>
                      <ArrowRight size={15} className="mt-0.5 shrink-0 text-slate-400 group-hover:text-primary-600" />
                    </div>
                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{latest.progress || '本周暂未填写进展'}</div>
                  </Link>
                );
              })}
            </div>
          </DetailSection>
        )}

        {workspaceTab === 'tasks' && (
          <DetailSection title="项目任务" description="进入任务中心查看、分派和闭环当前项目的执行事项。">
            <Link to={`/tasks?projectId=${encodeURIComponent(detailProduct.id)}`} className="inline-flex h-10 items-center gap-2 bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-800">
              <ListTodo size={16} />打开项目任务
            </Link>
          </DetailSection>
        )}

        {workspaceTab === 'files' && (
          <DetailSection title="关联文件" description="优先按项目 ID 关联，旧文件继续兼容名称匹配。">
            <div className="space-y-2">
              <Link to={`/cloud-drive?projectId=${encodeURIComponent(detailProduct.id)}`} className="inline-flex h-9 items-center gap-2 border border-primary-600 bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700">
                <Upload size={15} />上传项目文件
              </Link>
              {workspaceLoading && <div className="py-6 text-center text-sm text-slate-400">正在整理项目文件...</div>}
              {!workspaceLoading && relatedFiles.length === 0 && (
                <div className="border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  <div>暂未找到关联文件</div>
                  <Link to={`/cloud-drive?projectId=${encodeURIComponent(detailProduct.id)}`} className="mt-3 inline-flex items-center gap-1 font-medium text-primary-700 hover:text-primary-800">
                    前往云盘
                    <ArrowRight size={13} />
                  </Link>
                </div>
              )}
              {!workspaceLoading && relatedFiles.map(file => (
                <Link key={file.id} to={`/cloud-drive?fileId=${encodeURIComponent(file.id)}`} className="group flex items-center gap-3 border border-slate-200 bg-white px-3 py-3 hover:border-primary-600 hover:bg-primary-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-slate-100 text-slate-500"><FileText size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{file.fileName}</span>
                    <span className="mt-1 block truncate text-xs text-slate-500">{formatWorkspaceFileSize(file.fileSize)} · {file.uploadedBy || '未知上传人'} · {formatWorkspaceTime(file.uploadedAt)}</span>
                  </span>
                  <ArrowRight size={15} className="shrink-0 text-slate-400 group-hover:text-primary-600" />
                </Link>
              ))}
            </div>
          </DetailSection>
        )}

        {workspaceTab === 'activity' && (
          <DetailSection title="最近动态" description="展示当前项目最近的字段修改记录。">
            <div className="space-y-2">
              {workspaceLoading && <div className="py-6 text-center text-sm text-slate-400">正在加载项目动态...</div>}
              {!workspaceLoading && workspaceHistory.length === 0 && (
                <div className="border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">暂无修改记录</div>
              )}
              {!workspaceLoading && workspaceHistory.slice(0, 20).map(item => (
                <div key={item.id} className="border-l-2 border-primary-600 bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-slate-900">更新了{FIELD_LABELS[item.field] || item.field}</span>
                    <span className="shrink-0 text-xs text-slate-400">{formatWorkspaceTime(item.editedAt)}</span>
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">{item.oldValue || '空'} → {item.newValue || '空'}</div>
                </div>
              ))}
            </div>
          </DetailSection>
        )}
      </div>
    </DetailModal>
  ) : null;

  const mobileStageOptions = activeProjectStages;
  const mobileVisibleProducts = mobileProjectStage === 'all'
    ? filteredProducts
    : filteredProducts.filter(product => product.status === mobileProjectStage);
  const mobileProjectProgress = (product: InvestmentProduct) => {
    const index = activeProjectStages.findIndex(stage => stage.name === product.status);
    if (index < 0 || activeProjectStages.length === 0) return 20;
    return Math.max(12, Math.min(100, Math.round(((index + 1) / activeProjectStages.length) * 100)));
  };
  const mobileLatestProgress = detailProduct && relatedWorkLogs.length > 0
    ? latestWorkLogProgress(relatedWorkLogs[0], selectedWeekKey || currentWeekKey).progress
    : '';

  if (isMobileViewport) {
    if (isCreatingProject && newProjectDraft) {
      return <div className="mobile-project-create square-ui">
        <header className="mobile-project-appbar">
          <button type="button" onClick={closeProjectDetail} aria-label="返回项目列表"><ChevronLeft size={23} /></button>
          <h1>新建项目</h1>
          <span />
        </header>
        <div className="mobile-project-steps" aria-label="创建项目步骤">
          {([1, 2, 3] as const).map((step, index) => <div key={step} className="mobile-project-step-wrap"><span className={`mobile-project-step ${mobileCreateStep >= step ? 'is-active' : ''}`}><i>{step}</i>{step === 1 ? '基础信息' : step === 2 ? '金额收益' : '业务信息'}</span>{index < 2 && <b />}</div>)}
        </div>
        {mobileCreateStep === 1 && <>
          <section className="mobile-project-form-section">
            <h2>项目名称</h2>
            <label><span>项目前缀</span><select value={newProjectNamePrefix} onChange={event => applyNewProjectName(event.target.value, newProjectNumber, newProjectNameSuffix)}>{projectNamePrefixes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>项目编号</span><input value={newProjectNumber} inputMode="numeric" onChange={event => applyNewProjectName(newProjectNamePrefix, event.target.value.replace(/[^\d]/g, ''), newProjectNameSuffix)} placeholder="请输入正整数" />{newProjectNumberConflict && <small>该编号已被占用或预留</small>}</label>
            <label><span>项目后缀</span><select value={newProjectNameSuffix} onChange={event => applyNewProjectName(newProjectNamePrefix, newProjectNumber, event.target.value)}>{projectNameSuffixes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          </section>
          <section className="mobile-project-form-section">
            <h2>基础信息</h2>
            <label><span>项目分类</span><select value={newProjectDraft.projectCategory || ''} onChange={event => updateDetailField('projectCategory', event.target.value)}><option value="">请选择项目分类</option>{projectFieldOptions.projectCategory.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>客户名称 / 类型</span><input value={newProjectDraft.client || ''} onChange={event => updateDetailField('client', event.target.value)} placeholder="请输入客户名称" /></label>
            <label><span>投资标的</span><input value={newProjectDraft.target || ''} onChange={event => updateDetailField('target', event.target.value)} placeholder="请输入投资标的" /></label>
            <label><span>A角经理</span><select value={newProjectDraft.trustManager || ''} onChange={event => updateDetailField('trustManager', event.target.value)}><option value="">请选择A角经理</option>{projectFieldOptions.trustManager.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          </section>
        </>}
        {mobileCreateStep === 2 && <section className="mobile-project-form-section">
          <h2>金额收益</h2>
          <label><span>美元规模（万美元）</span><input type="number" value={newProjectDraft.usd || ''} onChange={event => updateDetailField('usd', event.target.value)} placeholder="请输入美元规模" /></label>
          <label><span>人民币规模（万元）</span><input type="number" value={newProjectDraft.rmb || ''} onChange={event => updateDetailField('rmb', event.target.value)} placeholder="请输入人民币规模" /></label>
          <label><span>费率（%）</span><input type="number" value={feeRateToPercentInput(newProjectDraft.feeRate)} onChange={event => updateDetailField('feeRate', percentInputToFeeRate(event.target.value))} placeholder="请输入费率" /></label>
          <label><span>（拟）成立日</span><input type="date" value={newProjectDraft.establishDate || ''} onChange={event => updateDetailField('establishDate', event.target.value)} /></label>
        </section>}
        {mobileCreateStep === 3 && <section className="mobile-project-form-section">
          <h2>业务信息</h2>
          <label><span>项目进度</span><select value={newProjectDraft.status || ''} onChange={event => updateDetailField('status', event.target.value)}>{projectFieldOptions.status.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>主动 / 被动</span><select value={newProjectDraft.activePassive || ''} onChange={event => updateDetailField('activePassive', event.target.value)}><option value="">请选择</option>{projectFieldOptions.activePassive.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>集合 / 单一</span><select value={newProjectDraft.collectiveSingle || ''} onChange={event => updateDetailField('collectiveSingle', event.target.value)}><option value="">请选择</option>{projectFieldOptions.collectiveSingle.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>备注</span><textarea value={newProjectDraft.remarks || ''} onChange={event => updateDetailField('remarks', event.target.value)} placeholder="补充项目说明" /></label>
        </section>}
        <div className="mobile-project-form-actions">
          <button type="button" className="is-secondary" onClick={() => mobileCreateStep === 1 ? closeProjectDetail() : setMobileCreateStep((mobileCreateStep - 1) as 1 | 2)}> {mobileCreateStep === 1 ? '取消' : '上一步'} </button>
          <button type="button" className="is-primary" onClick={() => mobileCreateStep < 3 ? setMobileCreateStep((mobileCreateStep + 1) as 2 | 3) : saveNewProject()}>{mobileCreateStep < 3 ? '下一步' : '创建项目'}</button>
        </div>
      </div>;
    }

    if (detailProduct) {
      const detailTabs: Array<{ key: ProjectWorkspaceTab; label: string; count?: number }> = [
        { key: 'overview', label: '概览' },
        { key: 'worklogs', label: '周报', count: relatedWorkLogs.length },
        { key: 'tasks', label: '任务' },
        { key: 'files', label: '文件', count: relatedFiles.length },
      ];
      type MobileProjectRecordField = MobileDetailEditorField & { readOnly?: boolean; displayValue?: string };
      const withCurrentOption = (options: string[], value?: string) => Array.from(new Set([value || '', ...options].filter(Boolean)));
      const mobileNumberDisplay = (value: number | string | null | undefined) => value === '' || value == null
        ? ''
        : Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
      const projectRecordSections: Array<{ title: string; fields: MobileProjectRecordField[] }> = [
        {
          title: '基础信息',
          fields: [
            { key: 'productName', label: '项目名称', value: detailProduct.productName || '', type: 'text' },
            { key: 'status', label: '项目进度', value: detailProduct.status || '', type: 'select', options: withCurrentOption(projectFieldOptions.status, detailProduct.status) },
            { key: 'projectCategory', label: '项目分类', value: detailProduct.projectCategory || '', type: 'select', options: withCurrentOption(projectFieldOptions.projectCategory, detailProduct.projectCategory) },
            { key: 'activePassive', label: '主动 / 被动', value: detailProduct.activePassive || '', type: 'select', options: withCurrentOption(projectFieldOptions.activePassive, detailProduct.activePassive) },
            { key: 'collectiveSingle', label: '集合 / 单一', value: detailProduct.collectiveSingle || '', type: 'select', options: withCurrentOption(projectFieldOptions.collectiveSingle, detailProduct.collectiveSingle) },
            { key: 'trustManager', label: 'A角经理', value: detailProduct.trustManager || '', type: 'select', options: withCurrentOption(projectFieldOptions.trustManager, detailProduct.trustManager) },
            { key: 'trustManagerB', label: 'B角经理', value: detailProduct.trustManagerB || '', type: 'select', options: withCurrentOption(projectFieldOptions.trustManagerB, detailProduct.trustManagerB) },
          ],
        },
        {
          title: '金额与收益',
          fields: [
            { key: 'usd', label: '美元规模', value: detailProduct.usd ?? '', displayValue: mobileNumberDisplay(detailProduct.usd), type: 'number', unit: '万美元' },
            { key: 'rmb', label: '人民币规模', value: detailProduct.rmb ?? '', displayValue: mobileNumberDisplay(detailProduct.rmb), type: 'number', unit: '万元' },
            { key: 'feeRate', label: '费率', value: feeRateToPercentInput(detailProduct.feeRate), type: 'number', unit: '%' },
            { key: 'annualIncome', label: '年化收入', value: detailProduct.annualIncome ?? '', displayValue: mobileNumberDisplay(detailProduct.annualIncome), type: 'number', unit: '万元', readOnly: true },
            { key: 'thisYearIncome', label: '今年收入', value: detailProduct.thisYearIncome ?? '', displayValue: mobileNumberDisplay(detailProduct.thisYearIncome), type: 'number', unit: '万元', readOnly: true },
            { key: 'performanceIncome', label: '绩效收入', value: detailProduct.performanceIncome ?? '', displayValue: mobileNumberDisplay(detailProduct.performanceIncome), type: 'number', unit: '万元', readOnly: true },
          ],
        },
        {
          title: '业务信息',
          fields: [
            { key: 'client', label: '委托人', value: detailProduct.client || '', type: 'text' },
            { key: 'target', label: '投资标的', value: detailProduct.target || '', type: 'text' },
            { key: 'brokerChannel', label: '券商渠道', value: detailProduct.brokerChannel || '', type: 'text' },
            { key: 'custodianBank', label: '托管行', value: detailProduct.custodianBank || '', type: 'select', options: withCurrentOption(projectFieldOptions.custodianBank, detailProduct.custodianBank) },
            { key: 'tradingBroker', label: '交易券商', value: detailProduct.tradingBroker || '', type: 'text' },
            { key: 'strategy', label: '投资策略', value: detailProduct.strategy || '', type: 'textarea' },
            { key: 'remarks', label: '备注', value: detailProduct.remarks || '', type: 'textarea' },
          ],
        },
        {
          title: '业务节点',
          fields: [
            { key: 'projectCreatedDate', label: '项目创建日', value: detailProduct.projectCreatedDate || detailProduct.progressStartDate || '', type: 'date' },
            { key: 'establishDate', label: establishDateLabel, value: detailProduct.establishDate || '', type: 'date' },
            { key: 'deadline', label: '截止日', value: detailProduct.deadline || '', type: 'date' },
            ...(detailIsStopped ? [{ key: 'projectStoppedDate', label: '项目中止日', value: detailProduct.projectStoppedDate || '', type: 'date' as const }] : []),
          ],
        },
      ];
      const configuredDynamicKeys = new Set(settings.customColumns.map(column => column.key));
      const customProjectFields: MobileProjectRecordField[] = settings.customColumns.map(column => ({
        key: `dynamicFields.${column.key}`,
        label: column.title,
        value: detailProduct.dynamicFields?.[column.key] ?? '',
        type: column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text',
      }));
      Object.entries(detailProduct.dynamicFields || {}).forEach(([key, value]) => {
        if (!configuredDynamicKeys.has(key)) customProjectFields.push({ key: `dynamicFields.${key}`, label: key, value: value ?? '', type: typeof value === 'number' ? 'number' : 'text' });
      });
      if (customProjectFields.length) projectRecordSections.push({ title: '补充字段', fields: customProjectFields });
      const saveMobileProjectField = (value: string) => {
        const field = mobileProjectEditField;
        if (!field) return;
        if (field.key.startsWith('dynamicFields.')) {
          const dynamicKey = field.key.slice('dynamicFields.'.length);
          updateProduct(detailProduct.id, {
            dynamicFields: {
              ...(detailProduct.dynamicFields || {}),
              [dynamicKey]: field.type === 'number' ? Number(value) || 0 : value,
            },
          });
          return;
        }
        const normalizedValue = field.key === 'feeRate'
          ? percentInputToFeeRate(value)
          : field.type === 'number'
            ? Number(value) || 0
            : value;
        updateDetailField(field.key as keyof InvestmentProduct, normalizedValue);
      };
      return <div className="mobile-project-detail square-ui">
        <header className="mobile-project-appbar is-transparent">
          <button type="button" onClick={closeProjectDetail} aria-label="返回项目列表"><ChevronLeft size={23} /></button>
          <h1>项目详情</h1>
          <button type="button" aria-label="编辑项目名称" onClick={() => setMobileProjectEditField(projectRecordSections[0].fields[0])}><Pencil size={19} /></button>
        </header>
        <section className="mobile-record-intro">
          <span>PROJECT · {detailProduct.id.slice(-6).toUpperCase()}</span>
          <h2>{detailProduct.productName || '未命名项目'}</h2>
          <div><em>{detailProduct.status || '未填写'}</em><em>{detailProduct.projectCategory || '未分类'}</em></div>
        </section>
        <nav className="mobile-project-detail-tabs" aria-label="项目详情内容">
          {detailTabs.map(tab => <button key={tab.key} type="button" onClick={() => setWorkspaceTab(tab.key)} className={workspaceTab === tab.key ? 'is-active' : ''}>{tab.label}{tab.count !== undefined ? ` ${tab.count}` : ''}</button>)}
        </nav>
        {workspaceTab === 'overview' && <>
          <div className="mobile-record-summary">完整项目档案 · 点击任意可编辑字段，从底部打开对应编辑面板。</div>
          {projectRecordSections.map(section => (
            <MobileDetailSection key={section.title} title={section.title} hint={section.title === '金额与收益' ? '收入自动计算' : undefined}>
              {section.fields.map(field => (
                <MobileDetailFieldRow
                  key={field.key}
                  label={field.label}
                  value={field.displayValue ?? field.value}
                  unit={field.unit}
                  readOnly={field.readOnly}
                  onClick={field.readOnly ? undefined : () => setMobileProjectEditField(field)}
                />
              ))}
            </MobileDetailSection>
          ))}
          <MobileDetailSection title="本周进展" hint={relatedWorkLogs.length ? `${relatedWorkLogs.length} 条周报` : '暂无周报'}>
            <MobileDetailFieldRow label="最新进展" value={mobileLatestProgress || '本周暂未填写进展'} readOnly />
          </MobileDetailSection>
          <section className="mobile-project-detail-section">
            <h3>关联内容</h3>
            <button type="button" className="mobile-project-related" onClick={() => setWorkspaceTab('worklogs')}><span><i><FileText size={18} /></i>管理周报</span><b>{relatedWorkLogs.length} 条记录　›</b></button>
            <Link className="mobile-project-related" to={`/discussions?projectId=${encodeURIComponent(detailProduct.id)}`}><span><i><ListTodo size={18} /></i>项目任务</span><b>查看待办　›</b></Link>
            <button type="button" className="mobile-project-related" onClick={() => setWorkspaceTab('files')}><span><i><Folder size={18} /></i>项目文件</span><b>{relatedFiles.length} 个文件　›</b></button>
            <button type="button" className="mobile-project-related" onClick={() => setWorkspaceTab('activity')}><span><i><Bell size={18} /></i>最近动态</span><b>{mobileProjectTime(detailProduct.updatedAt)}　›</b></button>
          </section>
        </>}
        {workspaceTab === 'worklogs' && <section className="mobile-project-detail-section"><h3>管理周报</h3>{relatedWorkLogs.length ? relatedWorkLogs.map(entry => <Link key={entry.id} className="mobile-project-related" to={`/worklog?entryId=${encodeURIComponent(entry.id)}`}><span><i><FileText size={18} /></i>{entry.productName || '管理周报'}</span><b>查看　›</b></Link>) : <p>暂无关联周报。</p>}</section>}
        {workspaceTab === 'tasks' && <section className="mobile-project-detail-section"><h3>项目任务</h3><Link className="mobile-project-related" to={`/discussions?projectId=${encodeURIComponent(detailProduct.id)}`}><span><i><ListTodo size={18} /></i>打开项目任务</span><b>查看　›</b></Link></section>}
        {workspaceTab === 'files' && <section className="mobile-project-detail-section"><h3>项目文件</h3>{relatedFiles.length ? relatedFiles.map(file => <Link key={file.id} className="mobile-project-related" to={`/cloud-drive?fileId=${encodeURIComponent(file.id)}`}><span><i><Folder size={18} /></i>{file.fileName}</span><b>查看　›</b></Link>) : <p>暂无关联文件。</p>}</section>}
        {workspaceTab === 'activity' && <section className="mobile-project-detail-section"><h3>最近动态</h3>{workspaceHistory.length ? workspaceHistory.slice(0, 10).map(item => <div key={item.id} className="mobile-project-related"><span><i><Bell size={18} /></i>{FIELD_LABELS[item.field] || item.field}</span><b>{formatWorkspaceTime(item.editedAt)}</b></div>) : <p>暂无最近动态。</p>}</section>}
        <MobileDetailEditorSheet field={mobileProjectEditField} onClose={() => setMobileProjectEditField(null)} onSave={saveMobileProjectField} />
      </div>;
    }

    return <div className="mobile-project-list square-ui">
      <header className="mobile-project-appbar"><span /><h1>项目</h1><button type="button" onClick={openNewProjectDetail} aria-label="新增项目"><Plus size={22} /></button></header>
      <div className="mobile-project-toolbar"><label><Search size={18} /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="搜索项目名称或经理" /></label><button type="button" aria-label="筛选项目" aria-expanded={mobileProjectFilterOpen} className={mobileProjectFilterOpen || mobileProjectStage !== 'all' || showOnlyMine || selectedManagerFilters.length > 0 ? 'is-active' : ''} onClick={() => setMobileProjectFilterOpen(true)}><Filter size={19} /></button></div>
      <div className="mobile-project-stage-strip">
        <button type="button" onClick={() => setMobileProjectStage('all')} className={mobileProjectStage === 'all' ? 'is-active' : ''}><strong>全部项目</strong><span>{filteredProducts.length} 个</span></button>
        {mobileStageOptions.map(stage => <button key={stage.id} type="button" onClick={() => setMobileProjectStage(stage.name)} className={mobileProjectStage === stage.name ? 'is-active' : ''}><strong>{stage.name}</strong><span>{filteredProducts.filter(product => product.status === stage.name).length} 个</span></button>)}
      </div>
      {mobileProjectFilterOpen && <div className="mobile-project-filter-layer" role="dialog" aria-modal="true" aria-label="筛选项目">
        <button type="button" className="mobile-project-filter-backdrop" aria-label="关闭筛选" onClick={() => setMobileProjectFilterOpen(false)} />
        <section className="mobile-project-filter-sheet">
          <i className="mobile-project-filter-handle" />
          <header><div><h2>筛选项目</h2><p>按查看范围和项目阶段筛选</p></div><button type="button" onClick={() => setMobileProjectFilterOpen(false)}>完成</button></header>
          <div className="mobile-project-filter-body">
            <div className="mobile-project-filter-group"><h3>查看范围</h3>
              {currentUser?.business_role === 'admin' ? <div className="mobile-project-filter-options is-wrap">
                <button type="button" className={selectedManagerFilters.length === 0 ? 'is-active' : ''} onClick={() => void updateUiPreferences({ projectManagerFilters: [] }, '经理筛选保存失败')}>全部经理</button>
                {settings.trustManagers.map(manager => { const active = selectedManagerFilters.includes(manager.name); return <button key={manager.name} type="button" className={active ? 'is-active' : ''} onClick={() => void updateUiPreferences({ projectManagerFilters: active ? selectedManagerFilters.filter(name => name !== manager.name) : [...selectedManagerFilters, manager.name] }, '经理筛选保存失败')}>{manager.name}</button>; })}
              </div> : <div className="mobile-project-filter-options"><button type="button" className={!showOnlyMine ? 'is-active' : ''} onClick={() => void setOnlyMinePreference('project', false)}>全部项目</button><button type="button" className={showOnlyMine ? 'is-active' : ''} onClick={() => void setOnlyMinePreference('project', true)}>只看我的</button></div>}
            </div>
            <div className="mobile-project-filter-group"><h3>项目阶段</h3><div className="mobile-project-filter-options is-wrap"><button type="button" className={mobileProjectStage === 'all' ? 'is-active' : ''} onClick={() => setMobileProjectStage('all')}>全部阶段</button>{activeProjectStages.map(stage => <button key={stage.id} type="button" className={mobileProjectStage === stage.name ? 'is-active' : ''} onClick={() => setMobileProjectStage(stage.name)}>{stage.name}</button>)}</div></div>
          </div>
          <footer><button type="button" onClick={() => { setMobileProjectStage('all'); if (currentUser?.business_role === 'admin') void updateUiPreferences({ projectManagerFilters: [] }, '经理筛选保存失败'); else void setOnlyMinePreference('project', false); }}>重置</button><button type="button" className="is-primary" onClick={() => setMobileProjectFilterOpen(false)}>查看 {mobileVisibleProducts.length} 个项目</button></footer>
        </section>
      </div>}
      <main className="mobile-project-card-list">{isLoading && products.length === 0 ? <div className="mobile-project-empty">项目加载中…</div> : mobileVisibleProducts.length === 0 ? <div className="mobile-project-empty">暂无项目数据</div> : mobileVisibleProducts.map(product => {
        const progress = mobileProjectProgress(product);
        return <article key={product.id} data-mobile-project-id={product.id} className="mobile-project-card" onClick={() => openProjectDetail(product)}>
          <div><h2>{product.productName || '未命名项目'}</h2><em>{product.status || '未填写'}</em></div>
          <p>{product.trustManager || '未分配'} · A角</p>
          <span className="mobile-project-progress"><i style={{ width: `${progress}%`, background: statusColor(product.status, settings.statusConfigs) }} /></span>
          <footer><span>最近更新 {mobileProjectTime(product.updatedAt)}</span><strong>{progress}%</strong></footer>
        </article>;
      })}</main>
      <button type="button" onClick={openNewProjectDetail} className="mobile-project-fab" aria-label="新增项目"><Plus size={24} /></button>
    </div>;
  }

  return (
    <div className="mobile-card-page square-ui -m-4 flex min-h-[calc(100%+2rem)] w-screen flex-col gap-0 sm:-m-5 sm:min-h-[calc(100%+2.5rem)] lg:m-0 lg:h-full lg:min-h-full lg:w-full lg:gap-5">
      <Header className="mobile-shared-page-header" title="项目进度" info={<FeatureInfo label="项目进度功能说明">可切换卡片和表格，显示设置按账号保存。</FeatureInfo>} subtitle="集中查看和维护项目阶段、进展与业务信息。">
        <button
          type="button"
          onClick={openNewProjectDetail}
          className="hidden h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 lg:inline-flex"
        >
          <Plus size={16} />
          新增
        </button>
      </Header>

      <button type="button" onClick={openNewProjectDetail} className="mobile-card-page__fab fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-12 w-12 items-center justify-center bg-primary-600 text-white shadow-[0_10px_24px_rgba(37,87,214,.28)] lg:hidden" aria-label="新增项目">
        <Plus size={24} />
      </button>

      <ListCardShell
        id="projects-content-scope"
        views={projectShellViews}
        metrics={[]}
        hideViews
        stickyWorkspace
        mergeToolbarWithContent
        contentClassName="px-4 pb-4 pt-0"
        toolbar={(
          <div><TableToolbar
            className="mobile-card-toolbar"
            hideSearch
            leadingContent={effectiveDisplayMode === 'table' ? (
              <div className="flex h-10 min-w-0 flex-1 items-center">
                <AppSelect
                  value=""
                  selectedValues={activeProjectStageIds}
                  options={activeProjectStages.map(stage => ({
                    value: stage.id,
                    label: (
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <span className="truncate">{stage.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-400">
                          {accountFilteredProducts.filter(product => product.status === stage.name).length}
                        </span>
                      </span>
                    ),
                  }))}
                  onToggle={toggleProjectStage}
                  size="sm"
                  className="w-9 shrink-0"
                  triggerClassName="worklog-table-category-trigger !h-9 !w-9 !border-0 !bg-transparent !p-0 hover:!bg-slate-50"
                  triggerContent={<Menu size={18} />}
                  hideChevron
                  panelClassName="w-44"
                  ariaLabel="筛选项目阶段"
                />
                <span className="mx-0.5 h-6 w-px shrink-0 bg-slate-200" />
                <div
                  ref={setProjectTableToolbarHost}
                  className="project-format-toolbar-host flex h-10 min-w-0 flex-1 items-center"
                  aria-label="表格格式工具栏"
                />
              </div>
            ) : <div className="flex min-w-0 max-w-full flex-1 items-center overflow-x-auto overscroll-x-contain">{projectShellViews.map(view => (
              <div key={view.key} className="inline-flex shrink-0 items-center">
              <button
                type="button"
                onClick={view.onClick}
                onDoubleClick={() => setActiveProjectStageIds(
                  view.active ? [] : activeProjectStages.map(stage => stage.id),
                )}
                onTouchStart={event => {
                  const touch = event.touches[0];
                  projectStageTouchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
                }}
                onTouchEnd={event => {
                  const touch = event.changedTouches[0];
                  if (touch && handleProjectStageTouchEnd(view.key, view.active, touch.clientX, touch.clientY)) {
                    event.preventDefault();
                  }
                }}
                title={view.active ? '双击或双触取消全部选择' : '双击或双触选择全部阶段'}
                className={`relative inline-flex h-9 shrink-0 touch-manipulation items-center gap-2 px-2 text-sm font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:content-[''] ${
                  view.active
                    ? 'text-primary-600 after:bg-primary-600'
                    : 'text-slate-500 after:bg-transparent hover:text-slate-900'
                }`}
              >
                <span>{view.label}</span>
                <span className={`text-xs tabular-nums ${view.active ? 'text-primary-600' : 'text-slate-400'}`}>{view.count}</span>
              </button>
              {view.label === '项目备用' && (
                <FeatureInfo label="阶段筛选操作说明">
                  单击可多选阶段；双击未选项全选，双击已选项清空。
                </FeatureInfo>
              )}
              </div>
            ))}</div>}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedCount={effectiveDisplayMode === 'table'
              && !(filteredTableRowIds.length > 0 && filteredTableRowIds.every(id => selectedProductIds.includes(id)))
              ? selectedProductIds.length
              : 0}
            onDeleteSelected={effectiveDisplayMode === 'table' ? () => setBatchDeleteConfirmOpen(true) : undefined}
            onExport={() => void handleExport()}
            onImport={() => importFileInputRef.current?.click()}
            hideTransferOnMobile
            menuActions={[
              {
                label: excelFullscreen ? '退出全屏' : '全屏编辑',
                icon: excelFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />,
                onClick: toggleExcelFullscreen,
                hideOnMobile: true,
              },
              ...(['cards', 'table'].includes(effectiveDisplayMode) ? [{
                label: '设置',
                icon: <SlidersHorizontal size={15} />,
                onClick: () => {
                  if (effectiveDisplayMode === 'table') {
                    setTableSettingsOpen(true);
                  } else {
                    setCardSettingsOpen(true);
                  }
                },
              }] : []),
            ]}
            searchPlaceholder="搜索项目、委托人或信托经理A/B角..."
            weekDateLabel={workWeekLabel}
            weekLeadingContent={(
              <div className="flex items-center gap-2">
                <div className="hidden h-10 shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 lg:flex" aria-label="项目视图切换">
                  <button
                    type="button"
                    aria-label="卡片视图"
                    aria-pressed={displayMode === 'cards'}
                    title="卡片视图"
                    onClick={() => {
                      setSearchParams(params => {
                        const next = new URLSearchParams(params);
                        next.delete('tableRow');
                        next.delete('field');
                        return next;
                      });
                      setDetailProductId(null);
                      setNewProjectDraft(null);
                      changeDisplayMode('cards');
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${displayMode === 'cards' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    <Square size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label="表格视图"
                    aria-pressed={displayMode === 'table'}
                    title="表格模式"
                    onClick={() => {
                      closeProjectDetail();
                      changeDisplayMode('table');
                    }}
                    className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${displayMode === 'table' ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    <Table2 size={17} />
                  </button>
                </div>
                <ManagerScopeFilter
                  isAdmin={currentUser?.business_role === 'admin'}
                  accountName={accountName}
                  managers={settings.trustManagers.map(manager => manager.name)}
                  selectedManagers={selectedManagerFilters}
                  onlyMine={showOnlyMine}
                  onManagersChange={managers => void updateUiPreferences({ projectManagerFilters: managers }, '经理筛选保存失败')}
                  onOnlyMineChange={enabled => void setOnlyMinePreference('project', enabled)}
                  scopeLabel="项目进度"
                />
              </div>
            )}
            weekOptions={weekOptions}
            selectedWeekKey={selectedWeekKey || currentWeekKey}
            onWeekChange={setSelectedWeekKey}
          /></div>
        )}
      >
      <AppModal
        open={cardSettingsOpen}
        title="卡片设置"
        subtitle="选择项目卡片中展示的字段，每位用户可保存自己的显示方式。"
        onClose={() => setCardSettingsOpen(false)}
        size="sm"
        footer={(
          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setCardFieldDraft(DEFAULT_PROJECT_CARD_FIELDS)}
              className="h-10 border border-slate-200 bg-white px-4 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={async () => {
                setCardSettingsSaving(true);
                const saved = await setProjectCardFieldsPreference(cardFieldDraft);
                setCardSettingsSaving(false);
                if (saved) setCardSettingsOpen(false);
              }}
              disabled={cardFieldDraft.length === 0 || cardSettingsSaving}
              className="h-10 bg-primary-600 px-5 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cardSettingsSaving ? '保存中…' : '保存设置'}
            </button>
          </div>
        )}
      >
        <div className="grid grid-cols-2 gap-2">
          {PROJECT_CARD_FIELD_OPTIONS.map(option => {
            const checked = cardFieldDraft.includes(option.key);
            return (
              <label
                key={option.key}
                className={`flex min-h-11 cursor-pointer items-center gap-3 border px-3 text-sm transition-colors ${checked ? 'border-primary-300 bg-primary-50 text-primary-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setCardFieldDraft(current => (
                    checked
                      ? current.filter(field => field !== option.key)
                      : [...current, option.key]
                  ))}
                  className="h-4 w-4 accent-primary-600 outline-none"
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      </AppModal>

      <AppModal
        open={tableSettingsOpen}
        title="表格设置"
        subtitle="调整项目进度表格的显示方式，设置仅对当前账号生效。"
        onClose={() => setTableSettingsOpen(false)}
        size="sm"
      >
        <div className="divide-y divide-slate-100 border-y border-slate-200">
          <ProjectTablePreferenceSwitch
            label="显示表格公式栏"
            description="在表格上方显示 fx 完整内容编辑栏。"
            checked={projectUiPreferences.projectExcelShowFormulaBar}
            onChange={value => void updateUiPreferences(
              { projectExcelShowFormulaBar: value },
              '表格设置保存失败',
            )}
          />
          <ProjectTablePreferenceSwitch
            label="显示表格坐标"
            description="显示列字母和行号，便于整行、整列及矩形选择。"
            checked={projectUiPreferences.projectExcelShowCoordinates}
            onChange={value => void updateUiPreferences(
              { projectExcelShowCoordinates: value },
              '表格设置保存失败',
            )}
          />
        </div>
      </AppModal>

      <div className={`grid min-h-0 flex-1 gap-4 transition-[grid-template-columns] duration-200 ${detailPanel ? 'lg:grid-cols-[minmax(360px,1fr)_1px_minmax(360px,520px)] lg:gap-0' : 'grid-cols-1'}`}>
        <div
          key={`${activeProjectStageIds.join(',')}-${effectiveDisplayMode}`}
          className="app-cloud-preview min-h-0 min-w-0 overflow-visible lg:h-full lg:overflow-hidden"
        >
          {isLoading && products.length === 0 ? (
            <LoadingSpinner fullPage message="加载项目数据..." />
          ) : effectiveDisplayMode === 'cards' ? (
            <ProductCards
              data={viewFilteredProducts}
              onOpenDetail={openProjectDetail}
              statusConfigs={boardStatusConfigs}
              advanceStatusConfigs={settings.statusConfigs}
              onAdvance={handleAdvanceProject}
              onRetreat={handleRetreatProject}
              onDelete={requestDeleteProject}
              selectedId={detailProduct?.id ?? null}
              visibleFieldKeys={projectCardFields}
              temporarilyPinnedIds={temporarilyPinnedProjectIds}
            />
          ) : effectiveDisplayMode === 'table' ? (
            <ProjectExcelView
              data={viewFilteredProducts}
              customColumns={settings.customColumns}
              statusOptions={projectFieldOptions.status || []}
              managerOptions={settings.trustManagers.map(manager => manager.name)}
              bankOptions={settings.custodianBanks.map(bank => bank.name)}
              fieldOptions={{
                projectCategory: projectFieldOptions.projectCategory || [],
                activePassive: projectFieldOptions.activePassive || [],
                collectiveSingle: projectFieldOptions.collectiveSingle || [],
              }}
              columnOrder={settings.columnOrder}
              focusRowId={routeTableRowId}
              focusField={routeProjectField}
              selectedIds={selectedProductIds}
              onToggleSelect={id => {
                setSelectedProductIds(current => current.includes(id)
                  ? current.filter(item => item !== id)
                  : [...current, id]);
              }}
              onSetSelectedRows={setSelectedProductIds}
              onFilteredRowIdsChange={setFilteredTableRowIds}
              onBatchCellEdit={handleExcelBatchEdit}
              onRefresh={fetchProducts}
              onColumnOrderChange={updateColumnOrder}
              onDelete={id => {
                const product = products.find(item => item.id === id);
                if (product) requestDeleteProject(product);
              }}
              onDuplicateRow={async product => {
                const now = new Date().toISOString();
                const duplicate: InvestmentProduct = {
                  ...product,
                  id: generateId(),
                  productName: '',
                  createdAt: now,
                  updatedAt: now,
                  dynamicFields: { ...(product.dynamicFields || {}) },
                };
                delete (duplicate as InvestmentProduct & { _version?: number })._version;
                const sourceIndex = products.findIndex(item => item.id === product.id);
                const saved = await insertProductAt(sourceIndex < 0 ? products.length : sourceIndex + 1, duplicate);
                if (saved) _toast.info?.('已复制为新项目，请填写唯一的项目名称');
                return saved;
              }}
              onAdvance={handleAdvanceProject}
              onRetreat={handleRetreatProject}
              toolbarHost={projectTableToolbarHost}
            />
          ) : (
            <ProjectFortuneSheetModule
              data={viewFilteredProducts}
              customColumns={settings.customColumns}
              statusOptions={projectFieldOptions.status || []}
              managerOptions={settings.trustManagers.map(manager => manager.name)}
              bankOptions={settings.custodianBanks.map(bank => bank.name)}
              frozenColumn={projectUiPreferences.projectFortuneSheetFrozenColumn}
              onFrozenColumnChange={column => { void updateUiPreferences({ projectFortuneSheetFrozenColumn: column }, 'FS 固定列偏好保存失败'); }}
              onCellEdit={(id, field, value) => {
                void handleExcelBatchEdit([{ id, field, lockField: field, value }], `FS 编辑${field}`);
                return true;
              }}
              onCreateRow={async (field, value) => {
                const now = new Date().toISOString();
                const product = useProjectStore.getState().blankProduct();
                const updates = buildProjectUpdates(product, field, value);
                return insertProductAt(products.length, { ...product, ...updates, createdAt: now, updatedAt: now });
              }}
              onDeleteRow={product => requestDeleteProject(product)}
              onFallbackToCards={() => changeDisplayMode('cards')}
            />
          )}
        </div>

        {detailPanel && <div aria-hidden="true" className="hidden h-full bg-slate-200 lg:block" />}

        {detailPanel && (
          <aside className="contents min-w-0 lg:block lg:h-full lg:min-h-0 lg:overflow-hidden">
            {detailPanel}
          </aside>
        )}
      </div>
      </ListCardShell>

      <AppModal
        open={isCreatingProject}
        onClose={closeProjectDetail}
        title="新增项目"
        subtitle="填写项目基础信息、金额收益和业务信息。"
        size="xl"
        fillContent
        scopeId="projects-content-scope"
        backdrop="none"
        exitAnimation={false}
        panelClassName="project-create-panel"
        bodyClassName="project-create-body"
        footer={(
          <>
            <button type="button" onClick={closeProjectDetail} className="inline-flex h-10 items-center justify-center border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              取消
            </button>
            <button type="button" onClick={saveNewProject} className="inline-flex h-10 items-center justify-center bg-slate-950 px-5 text-sm font-medium text-white hover:bg-slate-800">
              创建项目
            </button>
          </>
        )}
      >
        {detailProduct && isCreatingProject && (
          <div className="project-create-sections grid lg:grid-cols-2">
            <DetailSection title="项目概览" description="定义项目名称、委托人和投资标的。">
              <DetailGrid columns={3}>
                <div data-project-field="productName" className={detailFieldClass(focusedProjectField === 'productName')}>
                  <span className="text-xs text-slate-500">项目前缀</span>
                  <AppSelect
                    value={newProjectNamePrefix}
                    options={projectNamePrefixes.map(prefix => ({
                      value: prefix,
                      label: prefix,
                      searchText: prefix,
                    }))}
                    onChange={prefix => {
                      const template = `${prefix}${PRODUCT_NAME_TEMPLATE_SLOT}${newProjectNameSuffix}`;
                      const nextNumber = String(smallestAvailableProjectNumber(
                        products,
                        template,
                        settings.reservedProjectNumbersByTemplate?.[
                          scopedProductNameTemplateKey('project', template)
                        ] || [],
                        occupiedProjectStatusNames,
                      ));
                      applyNewProjectName(prefix, nextNumber, newProjectNameSuffix);
                    }}
                    placeholder="选择前缀"
                    emptyText="暂无项目前缀"
                    variant="anchored"
                    triggerClassName="mt-1 h-11 sm:h-9"
                  />
                </div>
                <label className={detailFieldClass(false)}>
                  <span className="text-xs text-slate-500">项目编号</span>
                  <input
                    value={newProjectNumber}
                    inputMode="numeric"
                    onChange={event => applyNewProjectName(
                      newProjectNamePrefix,
                      event.target.value.replace(/[^\d]/g, ''),
                      newProjectNameSuffix,
                    )}
                    disabled={!newProjectNameTemplate}
                    className={`mt-1 h-11 w-full border bg-white px-2.5 text-sm font-medium outline-none sm:h-9 ${
                      newProjectNumberConflict ? 'border-red-400 text-red-700' : 'border-slate-200 text-slate-900'
                    } disabled:bg-slate-50`}
                    placeholder="正整数"
                  />
                  {newProjectNumberConflict && (
                    <span className="mt-1 block text-xs font-medium text-red-600">
                      编号已被现有项目占用或已在产品设置中预留
                    </span>
                  )}
                </label>
                <div className={detailFieldClass(false)}>
                  <span className="text-xs text-slate-500">项目后缀</span>
                  <AppSelect
                    value={newProjectNameSuffix}
                    options={projectNameSuffixes.map(suffix => ({
                      value: suffix,
                      label: suffix,
                      searchText: suffix,
                    }))}
                    onChange={suffix => {
                      const template = `${newProjectNamePrefix}${PRODUCT_NAME_TEMPLATE_SLOT}${suffix}`;
                      const nextNumber = String(smallestAvailableProjectNumber(
                        products,
                        template,
                        settings.reservedProjectNumbersByTemplate?.[
                          scopedProductNameTemplateKey('project', template)
                        ] || [],
                        occupiedProjectStatusNames,
                      ));
                      applyNewProjectName(newProjectNamePrefix, nextNumber, suffix);
                    }}
                    placeholder="选择后缀"
                    emptyText="暂无项目后缀"
                    variant="anchored"
                    triggerClassName="mt-1 h-11 sm:h-9"
                  />
                </div>
                <div className={`${detailFieldClass(false)} md:col-span-3`}>
                  <span className="text-xs text-slate-500">生成的项目名称</span>
                  <output className="mt-1 flex h-11 items-center border border-slate-200 bg-slate-50 px-2.5 text-sm font-medium text-slate-700 sm:h-9">
                    {detailProduct.productName || '请选择前缀、填写编号并选择后缀'}
                  </output>
                </div>
                <EditableProjectField lastEdit={lastEditByField.client} fieldKey="client" focused={focusedProjectField === 'client'} label="委托人" value={detailProduct.client || ''} onChange={value => updateDetailField('client', value)} {...projectEditingHandlers('client', '委托人')} />
                <EditableProjectField lastEdit={lastEditByField.target} fieldKey="target" focused={focusedProjectField === 'target'} label="标的" value={detailProduct.target || ''} onChange={value => updateDetailField('target', value)} {...projectEditingHandlers('target', '标的')} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title="规模、日期与收益" description="收入自动计算；截止日默认为成立年份的11月30日。">
              <DetailGrid columns={3}>
                <EditableProjectField lastEdit={lastEditByField.rmb} fieldKey="rmb" focused={focusedProjectField === 'rmb'} label="人民币规模（万元）" value={detailProduct.rmb ?? ''} onChange={value => updateDetailField('rmb', value)} type="number" {...projectEditingHandlers('rmb', '人民币规模（万元）')} />
                <EditableProjectField lastEdit={lastEditByField.usd} fieldKey="usd" focused={focusedProjectField === 'usd'} label="美元规模（万美元）" value={detailProduct.usd ?? ''} onChange={value => updateDetailField('usd', value)} type="number" {...projectEditingHandlers('usd', '美元规模（万美元）')} />
                <EditableProjectField lastEdit={lastEditByField.feeRate} fieldKey="feeRate" focused={focusedProjectField === 'feeRate'} label="费率（%）" value={feeRateToPercentInput(detailProduct.feeRate)} onChange={value => updateDetailField('feeRate', percentInputToFeeRate(value))} type="number" {...projectEditingHandlers('feeRate', '费率')} />
                <EditableProjectField lastEdit={lastEditByField.establishDate} fieldKey="establishDate" focused={focusedProjectField === 'establishDate'} label={establishDateLabel} value={detailProduct.establishDate || ''} onChange={value => updateDetailField('establishDate', value)} type="date" {...projectEditingHandlers('establishDate', establishDateLabel)} />
                <EditableProjectField lastEdit={lastEditByField.deadline} fieldKey="deadline" focused={focusedProjectField === 'deadline'} label="截止日" value={detailProduct.deadline || ''} onChange={value => updateDetailField('deadline', value)} type="date" {...projectEditingHandlers('deadline', '截止日')} />
                <EditableProjectField lastEdit={lastEditByField.projectCreatedDate} fieldKey="projectCreatedDate" focused={focusedProjectField === 'projectCreatedDate'} label="项目创建日" value={detailProduct.projectCreatedDate || detailProduct.progressStartDate || ''} onChange={value => updateDetailField('projectCreatedDate', value)} type="date" {...projectEditingHandlers('projectCreatedDate', '项目创建日')} />
                <EditableProjectField lastEdit={lastEditByField.annualIncome} fieldKey="annualIncome" focused={focusedProjectField === 'annualIncome'} label="年化收入（万元）" value={detailProduct.annualIncome ?? ''} onChange={() => {}} type="number" readOnly />
                <EditableProjectField lastEdit={lastEditByField.thisYearIncome} fieldKey="thisYearIncome" focused={focusedProjectField === 'thisYearIncome'} label="今年收入（万元）" value={detailProduct.thisYearIncome ?? ''} onChange={() => {}} type="number" readOnly />
                <EditableProjectField lastEdit={lastEditByField.performanceIncome} fieldKey="performanceIncome" focused={focusedProjectField === 'performanceIncome'} label="绩效收入（万元）" value={detailProduct.performanceIncome ?? ''} onChange={() => {}} type="number" readOnly />
              </DetailGrid>
            </DetailSection>

            <div className="lg:col-span-2">
              <DetailSection title="业务信息">
                <DetailGrid columns={3}>
                  <EditableProjectField lastEdit={lastEditByField.status} fieldKey="status" focused={focusedProjectField === 'status'} label="项目进度" value={detailProduct.status || ''} onChange={value => updateDetailField('status', value)} options={projectFieldOptions.status || []} selectVariant="anchored" {...projectEditingHandlers('status', '项目进度')} />
                  <EditableProjectField lastEdit={lastEditByField.projectCategory} fieldKey="projectCategory" focused={focusedProjectField === 'projectCategory'} label="项目分类" value={detailProduct.projectCategory || ''} onChange={value => updateDetailField('projectCategory', value)} options={projectFieldOptions.projectCategory || []} selectVariant="anchored" {...projectEditingHandlers('projectCategory', '项目分类')} />
                  <EditableProjectField lastEdit={lastEditByField.activePassive} fieldKey="activePassive" focused={focusedProjectField === 'activePassive'} label="主动 / 被动" value={detailProduct.activePassive || ''} onChange={value => updateDetailField('activePassive', value)} options={projectFieldOptions.activePassive || []} selectVariant="anchored" {...projectEditingHandlers('activePassive', '主动 / 被动')} />
                  <EditableProjectField lastEdit={lastEditByField.collectiveSingle} fieldKey="collectiveSingle" focused={focusedProjectField === 'collectiveSingle'} label="集合 / 单一" value={detailProduct.collectiveSingle || ''} onChange={value => updateDetailField('collectiveSingle', value)} options={projectFieldOptions.collectiveSingle || []} selectVariant="anchored" {...projectEditingHandlers('collectiveSingle', '集合 / 单一')} />
                  <EditableProjectField lastEdit={lastEditByField.trustManager} fieldKey="trustManager" focused={focusedProjectField === 'trustManager'} label="A角" value={detailProduct.trustManager || ''} onChange={value => updateDetailField('trustManager', value)} options={projectFieldOptions.trustManager || []} selectVariant="anchored" {...projectEditingHandlers('trustManager', 'A角')} />
                  <EditableProjectField lastEdit={lastEditByField.trustManagerB} fieldKey="trustManagerB" focused={focusedProjectField === 'trustManagerB'} label="B角" value={detailProduct.trustManagerB || ''} onChange={value => updateDetailField('trustManagerB', value)} options={projectFieldOptions.trustManagerB || []} selectVariant="anchored" {...projectEditingHandlers('trustManagerB', 'B角')} />
                  <EditableProjectField lastEdit={lastEditByField.brokerChannel} fieldKey="brokerChannel" focused={focusedProjectField === 'brokerChannel'} label="券商渠道" value={detailProduct.brokerChannel || ''} onChange={value => updateDetailField('brokerChannel', value)} {...projectEditingHandlers('brokerChannel', '券商渠道')} />
                  <EditableProjectField lastEdit={lastEditByField.custodianBank} fieldKey="custodianBank" focused={focusedProjectField === 'custodianBank'} label="托管行" value={detailProduct.custodianBank || ''} onChange={value => updateDetailField('custodianBank', value)} options={projectFieldOptions.custodianBank || []} selectVariant="anchored" {...projectEditingHandlers('custodianBank', '托管行')} />
                  <EditableProjectField lastEdit={lastEditByField.tradingBroker} fieldKey="tradingBroker" focused={focusedProjectField === 'tradingBroker'} label="交易券商" value={detailProduct.tradingBroker || ''} onChange={value => updateDetailField('tradingBroker', value)} {...projectEditingHandlers('tradingBroker', '交易券商')} />
                  <EditableProjectField lastEdit={lastEditByField.strategy} fieldKey="strategy" focused={focusedProjectField === 'strategy'} label="投资策略" value={detailProduct.strategy || ''} onChange={value => updateDetailField('strategy', value)} {...projectEditingHandlers('strategy', '投资策略')} />
                </DetailGrid>
              </DetailSection>
            </div>

            <div className="lg:col-span-2">
              <DetailSection title="备注">
                <DetailGrid columns={1}>
                  <EditableProjectField lastEdit={lastEditByField.remarks} fieldKey="remarks" focused={focusedProjectField === 'remarks'} label="备注" value={detailProduct.remarks || ''} onChange={value => updateDetailField('remarks', value)} multiline {...projectEditingHandlers('remarks', '备注')} />
                </DetailGrid>
              </DetailSection>
            </div>

          </div>
        )}
      </AppModal>

      <input
        ref={importFileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] || null;
          event.target.value = '';
          if (!file) return;
          setImportInitialFile(file);
          setShowImportModal(true);
        }}
      />

      {showImportModal && (
        <ImportModal
          isOpen={showImportModal}
          onClose={() => { setShowImportModal(false); setImportInitialFile(null); }}
          onImport={handleImport}
          initialFile={importInitialFile}
        />
      )}

      {historyRecordId && (
        <VersionHistory
          recordId={historyRecordId}
          recordType="product"
          onClose={() => setHistoryRecordId(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        title="删除项目进度条目"
        targetName={(products.find(product => product.id === deleteTargetId) || detailProduct)?.productName || '未命名项目'}
        onCancel={() => { setDeleteConfirmOpen(false); setDeleteTargetId(null); }}
        onConfirm={handleDeleteProject}
      />

      <AppModal
        open={Boolean(workLogHandoff)}
        onClose={() => setWorkLogHandoff(null)}
        title={workLogHandoff?.existingEntry ? '查看管理周报' : '项目已进入管理阶段'}
        subtitle={workLogHandoff?.product.productName || ''}
        size="sm"
        footer={(
          <div className="grid w-full grid-cols-2 gap-0">
            <button type="button" onClick={() => setWorkLogHandoff(null)} className="h-11 border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50">
              {workLogHandoff?.existingEntry ? '继续留在项目进度' : '暂不创建'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!workLogHandoff) return;
                const target = workLogHandoff.existingEntry
                  ? `/worklog?entryId=${encodeURIComponent(workLogHandoff.existingEntry.id)}`
                  : `/worklog?createFromProject=${encodeURIComponent(workLogHandoff.product.id)}`;
                setWorkLogHandoff(null);
                window.location.href = target;
              }}
              className="h-11 bg-primary-600 text-sm font-medium text-white hover:bg-primary-700"
            >
              {workLogHandoff?.existingEntry ? '查看管理周报' : '创建管理周报'}
            </button>
          </div>
        )}
      >
        <p className="text-sm leading-6 text-slate-600">
          {workLogHandoff?.existingEntry
            ? '该项目已经存在关联的管理周报记录，是否前往查看？'
            : '是否为该项目创建管理周报？系统会带入已有项目资料，周报内容由你确认后保存。'}
        </p>
      </AppModal>
      <DeleteConfirmDialog
        open={batchDeleteConfirmOpen}
        title="批量删除项目进度条目"
        targetName={`已选择的 ${selectedProductIds.length} 个项目`}
        onCancel={() => setBatchDeleteConfirmOpen(false)}
        onConfirm={handleBatchDeleteProjects}
      />

    </div>
  );
}
