import {create} from'zustand';
import {WorkLogState, WorkLogEntry} from'../types';
import {generateId} from'../utils/id';
import {api} from'../lib/api';
import {getCurrentWeekKey} from'../utils/week';
import {_toast} from'./toastRef';
import {useSaveStatusStore} from'./saveStatusStore';
import {useSettingsStore} from'./settingsStore';

// Serialize writes per entry so moving quickly between fields cannot let two
// full-record PUT requests overwrite each other with different stale copies.
const entryUpdateQueues = new Map<string, Promise<void>>();
let fetchEntriesPromise: Promise<void> | null = null;

function enqueueEntryUpdate(id: string, task: () => Promise<void>): Promise<void> {
 const previous = entryUpdateQueues.get(id) || Promise.resolve();
 const current = previous.catch(() => {}).then(task);
 entryUpdateQueues.set(id, current);
 current.finally(() => {
  if (entryUpdateQueues.get(id) === current) entryUpdateQueues.delete(id);
 }).catch(() => {});
 return current;
}

export const useWorkLogStore = create<WorkLogState>((set, get) => {const currentWeekKey = getCurrentWeekKey();
 return {entries: [],
 currentWeekKey,
 selectedWeekKey: currentWeekKey,
 isLoading: false,

 refreshCurrentWeek: () => {const nextWeekKey = getCurrentWeekKey();
 const state = get();
 if (nextWeekKey !== state.currentWeekKey) {
  set({
   currentWeekKey: nextWeekKey,
   selectedWeekKey: !state.selectedWeekKey || state.selectedWeekKey === state.currentWeekKey
    ? nextWeekKey
    : state.selectedWeekKey,
  });
 }
 get().fetchEntries();},

 fetchEntries: () => {
  if (fetchEntriesPromise) return fetchEntriesPromise;
  set({isLoading: true});
  fetchEntriesPromise = (async () => {
   try {const res = await api.get<{entries: WorkLogEntry[]}>('/entries');
   set({entries: res.entries, isLoading: false});
   useSettingsStore.getState().scanProductNameTemplates(res.entries.map(entry => entry.productName), 'workLog');} catch (err: any) {_toast?.error?.(err.message ||'获取工作日志失败');
   set({isLoading: false});}
  })().finally(() => {fetchEntriesPromise = null;});
  return fetchEntriesPromise;
 },

 addEntry: async (entry: any) => {const now = new Date().toISOString();
 const newEntry: WorkLogEntry = {...entry, id: generateId(), createdAt: now, updatedAt: now};
 try {await api.post('/entries', {entry: newEntry});
 set((state) => ({entries: [...state.entries, newEntry]}));
 useSettingsStore.getState().scanProductNameTemplates([newEntry.productName], 'workLog');} catch (err: any) {_toast?.error?.(err.message ||'添加记录失败');}},

 updateEntry: (id: string, updates: Partial<WorkLogEntry>) => {enqueueEntryUpdate(id, async () => {const entry = get().entries.find(e => e.id === id);
 if (!entry) return;
 const updated = {...entry, ...updates, updatedAt: new Date().toISOString()};
 useSaveStatusStore.getState().setSaving();
 try {await api.put(`/entries/${id}`, {entry: updated, changedFields: Object.keys(updates)});
 set((state) => ({entries: state.entries.map((e) => (e.id === id ? updated : e))}));
 if (Object.prototype.hasOwnProperty.call(updates, 'productName')) {
  useSettingsStore.getState().scanProductNameTemplates([updated.productName], 'workLog');
 }
 useSaveStatusStore.getState().setSaved();
 const historyChanges: Array<{field: string; oldValue: unknown; newValue: unknown}> = [];
 Object.keys(updates).filter(field => field !== 'updatedAt').forEach(field => {
  if (field === 'dynamicFields') {
   const before = entry.dynamicFields || {};
   const after = updated.dynamicFields || {};
   Object.keys(after).forEach(key => {
    if (String(before[key] ?? '') !== String(after[key] ?? '')) historyChanges.push({field: `dynamicFields.${key}`, oldValue: before[key], newValue: after[key]});
   });
   return;
  }
  if (field === 'weeklyProgress') {
   const before = entry.weeklyProgress || {};
   const after = updated.weeklyProgress || {};
   Object.keys(after).forEach(key => {
    if (String(before[key] ?? '') !== String(after[key] ?? '')) historyChanges.push({field: 'weeklyProgress', oldValue: before[key], newValue: after[key]});
   });
   return;
  }
  if (String((entry as any)[field] ?? '') !== String((updated as any)[field] ?? '')) historyChanges.push({field, oldValue: (entry as any)[field], newValue: (updated as any)[field]});
 });
 historyChanges.forEach(change => api.post('/history', {recordId: id, recordType: 'entry', ...change}).catch(() => {}));
 } catch (err: any) {useSaveStatusStore.getState().setError();
 _toast?.error?.(err.message ||'更新记录失败');}});},

 deleteEntry: async (id: string) => {try {await api.delete(`/entries/${id}`);
 set((state) => ({entries: state.entries.filter((e) => e.id !== id)}));} catch (err: any) {_toast?.error?.(err.message ||'删除记录失败');}},

 deleteEntries: async (ids: string[]) => {try {await api.post('/entries/batch-delete', {ids});
 set((state) => ({entries: state.entries.filter((e) => !ids.includes(e.id))}));
 _toast?.success?.(`已删除 ${ids.length} 条记录`);} catch (err: any) {_toast?.error?.(err.message ||'批量删除失败');}},

 insertEntryAt: async (index: number, entry: WorkLogEntry) => {const fixed = {...entry, weekKey: entry.weekKey || get().currentWeekKey};
 try {await api.post('/entries', {entry: fixed});
 set((state) => {const u = [...state.entries]; u.splice(index, 0, fixed); return {entries: u};});
 useSettingsStore.getState().scanProductNameTemplates([fixed.productName], 'workLog');} catch (err: any) {_toast?.error?.(err.message ||'插入记录失败');}},

 replaceEntries: async (newEntries: WorkLogEntry[]) => {try {await api.post('/entries/replace', {entries: newEntries});
 set(() => ({entries: newEntries}));
 useSettingsStore.getState().scanProductNameTemplates(newEntries.map(entry => entry.productName), 'workLog');} catch (err: any) {_toast?.error?.(err.message ||'替换记录失败'); throw err;}},

 mergeEntries: async (mergedEntries: WorkLogEntry[]) => {try {await api.post('/entries/merge', {entries: mergedEntries});
 set((state) => {const mergedById = new Map(mergedEntries.map(entry => [entry.id, entry]));
 const existingIds = new Set(state.entries.map(entry => entry.id));
 return {entries: [
  ...state.entries.map(entry => mergedById.get(entry.id) || entry),
  ...mergedEntries.filter(entry => !existingIds.has(entry.id)),
 ]};});
 useSettingsStore.getState().scanProductNameTemplates(mergedEntries.map(entry => entry.productName), 'workLog');} catch (err: any) {_toast?.error?.(err.message ||'合并周报失败'); throw err;}},

 moveEntry: (id: string, toIndex: number) => {set((state) => {const i = state.entries.findIndex(e => e.id === id);
 if (i === -1) return state;
 const u = [...state.entries]; const [item] = u.splice(i, 1); u.splice(toIndex, 0, item);
 return {entries: u};});
 get().fetchEntries();},

 setSelectedWeekKey: (key: string | null) => set({selectedWeekKey: key}),

 copyEntriesFromWeek: async (fromWeekKey: string, toWeekKey: string) => {const {entries} = get();
 let sourceEntries = entries.filter(e => e.weekKey === fromWeekKey);
 if (sourceEntries.length === 0 && (fromWeekKey ==='__legacy__'|| fromWeekKey ==='legacy')) {sourceEntries = entries.filter(e => !e.weekKey);}
 if (sourceEntries.length === 0) return 0;

 // 去重：目标周已有的记录按 productName+category 对比
 const existingInTarget = entries.filter(e => e.weekKey === toWeekKey);
 const existingKeys = new Set(existingInTarget.map(e =>`${e.productName}|${e.category}`));
 const toCopy = sourceEntries.filter(s => !existingKeys.has(`${s.productName}|${s.category}`));

 if (toCopy.length === 0) {_toast?.info?.('目标周已有全部记录，无需复制'); return 0;}

 const now = new Date().toISOString();
 const newEntries = toCopy.map(source => ({...source, id: generateId(), weekKey: toWeekKey, createdAt: now, updatedAt: now,}));

 try {await api.post('/entries/batch-create', {entries: newEntries});
 await get().fetchEntries();
 useSettingsStore.getState().scanProductNameTemplates(newEntries.map(entry => entry.productName), 'workLog');
 _toast?.success?.(`已复制 ${newEntries.length} 条记录（跳过 ${sourceEntries.length - toCopy.length} 条重复）`);
 return newEntries.length;} catch (err: any) {_toast?.error?.(err.message ||'复制记录失败'); return 0;}},

 blankEntry: () => {const now = new Date().toISOString();
 return {id: generateId(), createdAt: now, updatedAt: now,
 category:'正常项目', subCategory:'', productName:'', status:'', clientType:'',
 navScale:'', description:'', establishDate:'', deadline:'', productTerm:'',
 personA:'', personB:'', activePassive:'', collectiveSingle:'',
 advisorManager:'', channelSales:'', features:'', managementReport:'',
 riskReport:'', salesReport:'', nextWeekPlan:'', nav: 0,
 yearStartNav: 0, changePercent: 0, weeklyProgress: {},
 navScaleHistory: {}, weekKey: get().currentWeekKey, dynamicFields: {},};},};});
