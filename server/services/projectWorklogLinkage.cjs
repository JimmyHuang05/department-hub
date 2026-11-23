const CLASSIFICATION_FIELDS = ['projectCategory', 'activePassive', 'collectiveSingle'];

function parse(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function categoryLinkage(value) {
  const normalized = String(value || '').replace(/\s+/g, '').replace(/[（(]/g, '（').replace(/[）)]/g, '）').trim();
  if (normalized === '资产管理') return { activePassive: '主动', collectiveSingle: '集合' };
  if (normalized === '资产服务（主动管理）') return { activePassive: '主动', collectiveSingle: '单一' };
  if (normalized === '资产服务（事务管理）') return { activePassive: '被动', collectiveSingle: '单一' };
  return null;
}

function normalizeProductClassification(product, previous) {
  const next = { ...product };
  if (String(next.projectCategory || '') !== String(previous?.projectCategory || '')) {
    Object.assign(next, categoryLinkage(next.projectCategory) || {});
  }
  return next;
}

function syncProductToEntries(db, product, timestamp) {
  if (!product?.id) return 0;
  let changed = 0;
  const rows = db.exec('SELECT id,data FROM entries');
  for (const row of rows[0]?.values || []) {
    const entry = parse(row[1]);
    if (entry.projectId !== product.id) continue;
    const next = {
      ...entry,
      subCategory: String(product.projectCategory || ''),
      activePassive: String(product.activePassive || ''),
      collectiveSingle: String(product.collectiveSingle || ''),
      updatedAt: timestamp,
    };
    if (entry.subCategory === next.subCategory && entry.activePassive === next.activePassive && entry.collectiveSingle === next.collectiveSingle) continue;
    db.run('UPDATE entries SET data=?,updated_at=? WHERE id=?', [JSON.stringify(next), timestamp, row[0]]);
    changed += 1;
  }
  return changed;
}

function syncEntryToProduct(db, entry, timestamp) {
  if (!entry?.projectId) return null;
  const result = db.exec('SELECT data FROM products WHERE id=?', [entry.projectId]);
  const raw = result[0]?.values?.[0]?.[0];
  if (!raw) return null;
  const product = parse(raw);
  const next = {
    ...product,
    projectCategory: String(entry.subCategory || ''),
    activePassive: String(entry.activePassive || ''),
    collectiveSingle: String(entry.collectiveSingle || ''),
    updatedAt: timestamp,
    _version: Number(product._version || 1) + 1,
  };
  if (CLASSIFICATION_FIELDS.every(field => String(product[field] || '') === String(next[field] || ''))) return product;
  db.run('UPDATE products SET data=?,updated_at=? WHERE id=?', [JSON.stringify(next), timestamp, entry.projectId]);
  return next;
}

module.exports = { categoryLinkage, normalizeProductClassification, syncProductToEntries, syncEntryToProduct };
