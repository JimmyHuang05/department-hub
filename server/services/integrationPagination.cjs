const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

class PaginationError extends Error {
  constructor(message, code = 'INVALID_PAGINATION') {
    super(message);
    this.name = 'PaginationError';
    this.code = code;
    this.status = 400;
  }
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function itemPosition(item) {
  return {
    updatedAt: String(item?.updatedAt || item?.revision || ''),
    id: String(item?.id || ''),
  };
}

function encodeCursor(item, scope) {
  const position = itemPosition(item);
  const payload = JSON.stringify({ v: 1, scope, ...position });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(cursor, scope) {
  if (!cursor) return null;
  try {
    const payload = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (payload.v !== 1 || payload.scope !== scope || !payload.id) throw new Error('invalid cursor');
    return { updatedAt: String(payload.updatedAt || ''), id: String(payload.id) };
  } catch {
    throw new PaginationError('分页游标无效或与当前查询条件不匹配', 'INVALID_CURSOR');
  }
}

function paginate(items, options = {}) {
  if (options.offset !== undefined) {
    throw new PaginationError('offset 参数不受支持，请使用 cursor 分页', 'OFFSET_NOT_SUPPORTED');
  }

  const scope = String(options.scope || 'default');
  const limit = clampLimit(options.limit);
  const position = decodeCursor(options.cursor, scope);
  let start = 0;

  if (position) {
    const index = items.findIndex(item => {
      const candidate = itemPosition(item);
      return candidate.id === position.id && candidate.updatedAt === position.updatedAt;
    });
    if (index < 0) throw new PaginationError('分页游标对应的数据已变化，请从第一页重新读取', 'STALE_CURSOR');
    start = index + 1;
  }

  const pageItems = items.slice(start, start + limit);
  const hasMore = start + pageItems.length < items.length;
  const nextCursor = hasMore && pageItems.length
    ? encodeCursor(pageItems[pageItems.length - 1], scope)
    : null;

  return {
    items: pageItems,
    page: {
      total: items.length,
      returned: pageItems.length,
      limit,
      hasMore,
      nextCursor,
    },
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PaginationError,
  clampLimit,
  decodeCursor,
  encodeCursor,
  paginate,
};
