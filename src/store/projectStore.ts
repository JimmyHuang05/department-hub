import {create} from'zustand';
import {ProductState, InvestmentProduct} from'../types';
import {generateId} from'../utils/id';
import {api} from'../lib/api';
import {_toast} from'./toastRef';
import {useSaveStatusStore} from'./saveStatusStore';
import {normalizeRate} from'../utils/format';
import {useSettingsStore} from'./settingsStore';

const PROJECT_BACKUP_STATUS = '项目备用';
const PROJECT_STOPPED_STATUS = '项目中止';

function serializeProductForStorage(product: InvestmentProduct): InvestmentProduct {
 const backup = product.status === PROJECT_BACKUP_STATUS;
 return {
  ...product,
  status: backup ? PROJECT_STOPPED_STATUS : product.status,
  projectBackup: backup,
 };
}

function normalizeProductNumbers(product: InvestmentProduct): InvestmentProduct {
 const feeRate = normalizeRate(Number(product.feeRate) || 0);
 const backup = product.status === PROJECT_BACKUP_STATUS
  || (product.projectBackup === true && (product.status === PROJECT_STOPPED_STATUS || product.status === '终止'));
 return {
  ...product,
  status: backup
   ? PROJECT_BACKUP_STATUS
   : product.status === '已落地' ? '已成立' : product.status === '终止' ? PROJECT_STOPPED_STATUS : product.status,
  projectBackup: backup,
  feeRate,
  annualIncome: Number(product.annualIncome) || 0,
  thisYearIncome: Number(product.thisYearIncome) || 0,
  performanceIncome: Number(product.performanceIncome) || 0,
 };
}

// Serialize writes per product so rapid edits use the version returned by the
// preceding request. A rejected request must not block later writes.
const productUpdateQueues = new Map<string, Promise<void>>();
let fetchProductsPromise: Promise<void> | null = null;

function enqueueProductUpdate(id: string, task: () => Promise<void>): Promise<void> {
 const previous = productUpdateQueues.get(id) || Promise.resolve();
 const current = previous.catch(() => {}).then(task);
 productUpdateQueues.set(id, current);
 current.finally(() => {
  if (productUpdateQueues.get(id) === current) productUpdateQueues.delete(id);
 }).catch(() => {});
 return current;
}

function enqueueProductBatch<T>(ids: string[], task: () => Promise<T>): Promise<T> {
 const uniqueIds = [...new Set(ids)];
 const predecessors = uniqueIds.map(id => productUpdateQueues.get(id) || Promise.resolve());
 const current = Promise.all(predecessors.map(previous => previous.catch(() => {}))).then(task);
 const queueMarker = current.then(() => undefined, () => undefined);
 uniqueIds.forEach(id => productUpdateQueues.set(id, queueMarker));
 queueMarker.finally(() => {
  uniqueIds.forEach(id => {
   if (productUpdateQueues.get(id) === queueMarker) productUpdateQueues.delete(id);
  });
 }).catch(() => {});
 return current;
}

function readProjectField(product: InvestmentProduct | undefined, field: string): unknown {
 if (!product) return undefined;
 if (field.startsWith('dynamicFields.')) return product.dynamicFields?.[field.slice('dynamicFields.'.length)];
 return (product as any)[field];
}

function sameProjectField(left: unknown, right: unknown) {
 return JSON.stringify(left ?? '') === JSON.stringify(right ?? '');
}

export const useProjectStore = create<ProductState>((set, get) => ({products: [],
 isLoading: false,

 fetchProducts: () => {
  if (fetchProductsPromise) return fetchProductsPromise;
  set({isLoading: true});
  fetchProductsPromise = (async () => {
   try {const res = await api.get<{products: InvestmentProduct[]}>('/products');
   const products = res.products.map(normalizeProductNumbers);
   set({products, isLoading: false});
   useSettingsStore.getState().scanProductNameTemplates(products.map(product => product.productName), 'project');} catch (err: any) {_toast?.error?.(err.message ||'获取产品列表失败');
   set({isLoading: false});}
  })().finally(() => {fetchProductsPromise = null;});
  return fetchProductsPromise;
 },

 addProduct: async (product: any) => {const now = new Date().toISOString();
 const newProduct: InvestmentProduct = normalizeProductNumbers({...product, id: generateId(), createdAt: now, updatedAt: now});
 try {await api.post('/products', {product: serializeProductForStorage(newProduct)});
 set((state) => ({products: [...state.products, newProduct]}));
 useSettingsStore.getState().scanProductNameTemplates([newProduct.productName], 'project');
 _toast?.success?.('产品添加成功');} catch (err: any) {_toast?.error?.(err.message ||'添加产品失败');}},

 updateProduct: (id: string, updates: Partial<InvestmentProduct>) => {enqueueProductUpdate(id, async () => {const product = get().products.find(p => p.id === id);
 if (!product) return;
 // 去掉 _originField 避免存到数据库
 const {_originField, ...cleanUpdates} = updates as any;
 const updated = normalizeProductNumbers({...product, ...cleanUpdates, updatedAt: new Date().toISOString()});
 useSaveStatusStore.getState().setSaving();
 try {const res = await api.put<any>(`/products/${id}`, {product: serializeProductForStorage(updated), changedFields: Object.keys(cleanUpdates)});
 // 保存服务端返回的新版本号
 if (res && res.version) (updated as any)._version = res.version;
 set((state) => ({products: state.products.map((p) => (p.id === id ? updated : p))}));
 if (Object.prototype.hasOwnProperty.call(cleanUpdates, 'productName')) {
  useSettingsStore.getState().scanProductNameTemplates([updated.productName], 'project');
 }
 useSaveStatusStore.getState().setSaved();
 // 广播所有变更 + 记录历史
 const collab = (window as any).__collab;
 const originField = (updates as any)._originField;
 const changedFields = Object.keys(cleanUpdates).filter(f => f !=='updatedAt');
 if (collab) {for (const field of changedFields) {collab.send({type:'cell-edit', recordId: id, field, value: (cleanUpdates as any)[field], isOrigin: field === originField});}}
 for (const field of changedFields) {api.post('/history', {recordId: id, recordType:'product', field, oldValue: (product as any)[field], newValue: (cleanUpdates as any)[field]}).catch(() => {});}} catch (err: any) {useSaveStatusStore.getState().setError();
 if (err.conflict || err.status === 409) {_toast?.warning?.('数据已被其他用户修改，已自动刷新');
 await get().fetchProducts();} else {_toast?.error?.(err.message ||'更新产品失败');}}});},

 batchUpdateProducts: async (changes, label) => {
  if (changes.length === 0) return true;
  const effectiveChanges = changes.flatMap(change => {
   if (change.field !== 'status') return [change];
   const backup = String(change.value) === PROJECT_BACKUP_STATUS;
   return [
    {...change, value: backup ? PROJECT_STOPPED_STATUS : change.value},
    {...change, field: 'projectBackup', lockField: 'status', value: backup},
   ];
  });
  return enqueueProductBatch(effectiveChanges.map(change => change.id), async () => {
   useSaveStatusStore.getState().setSaving();
   const productsAtStart = new Map(get().products.map(product => [product.id, product]));
   const beforeValues = effectiveChanges.map(change => readProjectField(productsAtStart.get(change.id), change.field));
   const makePayload = (useExplicitVersion: boolean) => effectiveChanges.map(change => {
    const product = get().products.find(item => item.id === change.id) as (InvestmentProduct & { _version?: number }) | undefined;
    return {...change, version: useExplicitVersion && change.version != null ? change.version : product?._version};
   });
   const save = async (payload: ReturnType<typeof makePayload>) => {
    const res = await api.put<{products: InvestmentProduct[]}>('/products/batch-fields', {changes: payload, label});
    const saved = (res.products || []).map(normalizeProductNumbers);
    const savedById = new Map(saved.map(product => [product.id, product]));
    set(state => ({products: state.products.map(product => savedById.get(product.id) || product)}));
   };
   try {
    await save(makePayload(true));
   } catch (err: any) {
    const isVersionConflict = err.status === 409 && Boolean(err.data?.conflict);
    if (!isVersionConflict) {
     useSaveStatusStore.getState().setError();
     if (err.status === 409) await get().fetchProducts();
     _toast?.error?.(err.message || '批量修改项目失败');
     return false;
    }
    await get().fetchProducts();
    const refreshed = new Map(get().products.map(product => [product.id, product]));
    const sameTargets = effectiveChanges.every((change, index) => sameProjectField(readProjectField(refreshed.get(change.id), change.field), beforeValues[index]));
    if (!sameTargets) {
     useSaveStatusStore.getState().setError();
     _toast?.warning?.('该单元格已被其他用户修改，已保留服务器上的最新内容');
     return false;
    }
    try {
     await save(makePayload(false));
     _toast?.info?.('检测到数据版本变化，已使用最新版本完成保存');
    } catch (retryError: any) {
     useSaveStatusStore.getState().setError();
     if (retryError.status === 409) await get().fetchProducts();
     _toast?.error?.(retryError.message || '刷新后重试仍然失败');
     return false;
    }
   }
   const collab = (window as any).__collab;
   if (collab) effectiveChanges.forEach(change => collab.send({type:'cell-edit', recordId:change.id, field:change.field, value:change.value}));
   useSaveStatusStore.getState().setSaved();
   return true;
  });
 },

 applyRemoteProductUpdate: (id: string, updates: Partial<InvestmentProduct>) => {
  set((state) => ({products: state.products.map((product) =>
   product.id === id ? normalizeProductNumbers({...product, ...updates}) : product
  )}));
 },

 deleteProduct: async (id: string) => {try {await api.delete(`/products/${id}`);
 set((state) => ({products: state.products.filter((p) => p.id !== id)}));
 _toast?.success?.('项目已删除'); return true;} catch (err: any) {_toast?.error?.(err.message ||'删除项目失败'); return false;}},

 deleteProducts: async (ids: string[]) => {try {
 const result = await api.post<{deletedIds?: string[]; deniedIds?: string[]; missingIds?: string[]}>('/products/batch-delete', {ids});
 const deletedIds = result.deletedIds || [];
 const deniedIds = result.deniedIds || [];
 const missingIds = result.missingIds || [];
 set((state) => ({products: state.products.filter((p) => !deletedIds.includes(p.id))}));
 if (deletedIds.length && deniedIds.length) _toast?.warning?.(`已删除 ${deletedIds.length} 个项目，${deniedIds.length} 个项目无权删除`);
 else if (deletedIds.length) _toast?.success?.(`已删除 ${deletedIds.length} 个项目`);
 else if (deniedIds.length) _toast?.error?.('所选项目均无删除权限');
 return {deletedIds, deniedIds, missingIds};
 } catch (err: any) {_toast?.error?.(err.message ||'批量删除失败'); return {deletedIds: [], deniedIds: ids, missingIds: []};}},

 getProductById: (id: string) => get().products.find((p) => p.id === id),

 insertProductAt: async (index: number, product: InvestmentProduct) => {try {const res = await api.post<{version?: number; product?: InvestmentProduct}>('/products', {product: serializeProductForStorage(product)});
 const savedProduct = normalizeProductNumbers((res.product || {...product, _version: res.version || 1}) as InvestmentProduct);
 set((state) => {const u = [...state.products]; u.splice(index, 0, savedProduct); return {products: u};});
 useSettingsStore.getState().scanProductNameTemplates([savedProduct.productName], 'project');
 return true;} catch (err: any) {_toast?.error?.(err.message ||'插入产品失败'); return false;}},

 replaceProducts: async (newProducts: InvestmentProduct[]) => {const normalizedProducts = newProducts.map(normalizeProductNumbers);
 try {await api.post('/products/replace', {products: normalizedProducts.map(serializeProductForStorage)});
 set(() => ({products: normalizedProducts}));
 useSettingsStore.getState().scanProductNameTemplates(normalizedProducts.map(product => product.productName), 'project');} catch (err: any) {_toast?.error?.(err.message ||'替换产品失败'); throw err;}},

 mergeProducts: async (mergedProducts: InvestmentProduct[]) => {const normalizedProducts = mergedProducts.map(normalizeProductNumbers);
 try {const res = await api.post<{products: InvestmentProduct[]}>('/products/merge', {products: normalizedProducts.map(serializeProductForStorage)});
 const savedProducts = (res.products || normalizedProducts).map(normalizeProductNumbers);
 set((state) => {const savedById = new Map(savedProducts.map(product => [product.id, product]));
 const existingIds = new Set(state.products.map(product => product.id));
 return {products: [
  ...state.products.map(product => savedById.get(product.id) || product),
  ...savedProducts.filter(product => !existingIds.has(product.id)),
 ]};});
 useSettingsStore.getState().scanProductNameTemplates(savedProducts.map(product => product.productName), 'project');} catch (err: any) {_toast?.error?.(err.message ||'合并项目失败'); throw err;}},

 moveProduct: (id: string, toIndex: number) => {set((state) => {const i = state.products.findIndex(p => p.id === id);
 if (i === -1) return state;
 const u = [...state.products]; const [item] = u.splice(i, 1); u.splice(toIndex, 0, item);
 return {products: u};});
 const {products} = get();
 api.post('/products/replace', {products: products.map(serializeProductForStorage)}).catch((err: any) => {_toast?.error?.(err.message ||'保存排序失败');});},

 blankProduct: () => {const now = new Date().toISOString();
 return {id: generateId(), createdAt: now, updatedAt: now,
 productName:'', usd: 0, rmb: 0, feeRate: 0,
 projectCreatedDate:'', establishDate:'', projectStoppedDate:'',
 target:'', client:'', brokerChannel:'', strategy:'',
 custodianBank:'', tradingBroker:'', annualIncome: 0,
 thisYearIncome: 0, performanceIncome: 0, status:'',
 trustManager:'', trustManagerB:'', deadline:'', remarks:'', dynamicFields: {},};},}));
