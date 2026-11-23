const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_LIMIT,
  PaginationError,
  paginate,
} = require('../server/services/integrationPagination.cjs');
const {
  integrationIdentifiers,
  matchesIdentifiers,
} = require('../server/services/integrationIdentifiers.cjs');

function records(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `record-${String(count - index).padStart(3, '0')}`,
    updatedAt: new Date(Date.UTC(2026, 7, 21, 12, 0, count - index)).toISOString(),
  }));
}

test('cursor pagination reads every record exactly once', () => {
  const source = records(137);
  const seen = [];
  let cursor;

  do {
    const result = paginate(source, { limit: 50, cursor, scope: 'worklogs:{}' });
    seen.push(...result.items.map(item => item.id));
    cursor = result.page.nextCursor;
    if (!result.page.hasMore) break;
  } while (cursor);

  assert.equal(seen.length, source.length);
  assert.equal(new Set(seen).size, source.length);
  assert.deepEqual(seen, source.map(item => item.id));
});

test('page metadata reports totals, actual limit and final-page state', () => {
  const source = records(51);
  const first = paginate(source, { limit: 50, scope: 'projects:{}' });
  assert.deepEqual(first.page, {
    total: 51,
    returned: 50,
    limit: 50,
    hasMore: true,
    nextCursor: first.page.nextCursor,
  });
  assert.ok(first.page.nextCursor);

  const last = paginate(source, {
    limit: 50,
    cursor: first.page.nextCursor,
    scope: 'projects:{}',
  });
  assert.equal(last.page.returned, 1);
  assert.equal(last.page.hasMore, false);
  assert.equal(last.page.nextCursor, null);
});

test('limit is capped and offset is rejected instead of silently ignored', () => {
  const capped = paginate(records(150), { limit: 1000, scope: 'worklogs:{}' });
  assert.equal(capped.items.length, MAX_LIMIT);
  assert.equal(capped.page.limit, MAX_LIMIT);

  assert.throws(
    () => paginate(records(10), { offset: 10, scope: 'worklogs:{}' }),
    error => error instanceof PaginationError && error.code === 'OFFSET_NOT_SUPPORTED',
  );
});

test('cursor cannot be reused with different filters', () => {
  const source = records(60);
  const first = paginate(source, { limit: 10, scope: 'worklogs:{"q":"cash"}' });
  assert.throws(
    () => paginate(source, {
      limit: 10,
      cursor: first.page.nextCursor,
      scope: 'worklogs:{"q":"bond"}',
    }),
    error => error instanceof PaginationError && error.code === 'INVALID_CURSOR',
  );
});

test('stale cursor asks the caller to restart pagination', () => {
  const source = records(60);
  const first = paginate(source, { limit: 10, scope: 'questionnaires:{}' });
  const withoutBoundary = source.filter(item => item.id !== source[9].id);
  assert.throws(
    () => paginate(withoutBoundary, {
      cursor: first.page.nextCursor,
      scope: 'questionnaires:{}',
    }),
    error => error instanceof PaginationError && error.code === 'STALE_CURSOR',
  );
});

test('integration routes retain legacy collection keys and add page metadata', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/routes/integration.cjs'), 'utf8');
  assert.match(source, /res\.json\(\{ projects, page: result\.page \}\)/);
  assert.match(source, /res\.json\(\{ worklogs: entries, page: result\.page \}\)/);
  assert.match(source, /res\.json\(\{ questionnaires, page: result\.page \}\)/);
  assert.match(source, /pagination: \{ type: 'cursor', defaultLimit: 50, maxLimit: MAX_LIMIT \}/);
});

test('skill requires agents to finish pagination before reporting absence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public/skill.md'), 'utf8');
  assert.match(source, /page\.hasMore/);
  assert.match(source, /不得仅根据第一页结果判断项目或周报不存在/);
  assert.match(source, /必须完成全量分页/);
});

test('integration identifiers expose project code, aliases and channel', () => {
  const identifiers = integrationIdentifiers({
    projectId: 'project-1',
    productName: '联衡信托美元现金管理3号QDII集合资金信托计划-1202303299_9999(Z)-000000',
    channelSales: '东方证券代销',
    dynamicFields: {
      projectCode: 'HB2653',
      aliases: '环球甄选3号美元现金管理4期QDII；美元现金4期',
    },
  });
  assert.deepEqual(identifiers, {
    projectId: 'project-1',
    projectCode: 'HB2653',
    contractNo: '1202303299_9999(Z)',
    aliases: ['环球甄选3号美元现金管理4期QDII', '美元现金4期'],
    channel: '东方证券代销',
  });
});

test('structured identifiers match exactly and normalize casing and spaces', () => {
  const item = {
    projectId: 'Project-1',
    productName: '产品-1202303299_9999(Z)-000000',
    dynamicFields: { projectCode: 'HB2653' },
  };
  assert.equal(matchesIdentifiers(item, {
    projectId: 'project-1',
    projectCode: ' hb2653 ',
    contractNo: '1202303299_9999(z)',
  }), true);
  assert.equal(matchesIdentifiers(item, { projectCode: 'HB2613' }), false);
});
