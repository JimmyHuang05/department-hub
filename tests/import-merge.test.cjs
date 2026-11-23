const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadMergeModule() {
  const file = path.join(__dirname, '..', 'src/utils/importMerge.ts');
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}

const createMeta = id => ({
  id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('project merge updates non-empty fields, preserves blanks, and adds missing projects', () => {
  const { mergeImportRows, projectImportIdentity } = loadMergeModule();
  const existing = [
    {
      ...createMeta('project-a'),
      productName: '项目A',
      client: '旧客户',
      status: '运行中',
      usd: 100,
      dynamicFields: { score: 80, owner: '甲' },
    },
    { ...createMeta('project-b'), productName: '项目B', status: '储备' },
  ];
  const imported = [
    {
      productName: ' 项目A ',
      client: '新客户',
      status: '',
      usd: 0,
      dynamicFields: { score: 90, owner: '' },
    },
    { productName: '项目C', status: '新增' },
  ];

  const result = mergeImportRows(
    existing,
    imported,
    projectImportIdentity,
    row => ({ ...createMeta(`new-${row.productName}`), ...row }),
    '2026-07-29T00:00:00.000Z',
  );

  assert.equal(result.updated, 1);
  assert.equal(result.added, 1);
  assert.equal(result.records.length, 3);
  assert.equal(result.records[0].id, 'project-a');
  assert.equal(result.records[0].client, '新客户');
  assert.equal(result.records[0].status, '运行中');
  assert.equal(result.records[0].usd, 0);
  assert.deepEqual(result.records[0].dynamicFields, { score: 90, owner: '甲' });
  assert.equal(result.records[2].productName, '项目C');
});

test('worklog merge combines weekly objects and matches by category plus project name', () => {
  const { mergeImportRows, workLogImportIdentity } = loadMergeModule();
  const existing = [{
    ...createMeta('entry-a'),
    category: '正常项目',
    productName: '项目A',
    subCategory: '资产管理',
    weeklyProgress: { 260717: '旧进展', 260724: '保留内容' },
    navScaleHistory: { 260717: '1000万' },
    dynamicFields: {},
  }];
  const imported = [{
    category: '正常项目',
    productName: '项目A',
    subCategory: '',
    weeklyProgress: { 260717: '新进展', 260724: '', 260731: '本周进展' },
    navScaleHistory: { 260731: '1200万' },
  }];

  const result = mergeImportRows(
    existing,
    imported,
    workLogImportIdentity,
    row => ({ ...createMeta('new-entry'), ...row }),
  );

  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
  assert.equal(result.records[0].subCategory, '资产管理');
  assert.deepEqual(result.records[0].weeklyProgress, {
    260717: '新进展',
    260724: '保留内容',
    260731: '本周进展',
  });
  assert.deepEqual(result.records[0].navScaleHistory, {
    260717: '1000万',
    260731: '1200万',
  });
});

test('worklog merge falls back to category and name when Excel has no project id', () => {
  const { mergeImportRows, workLogImportIdentity } = loadMergeModule();
  const existing = [{
    ...createMeta('entry-linked'),
    projectId: 'stable-project-id',
    category: '正常项目',
    productName: '项目A',
    status: '旧状态',
  }];
  const imported = [{
    category: '正常项目',
    productName: '项目A',
    status: '新状态',
  }];

  const result = mergeImportRows(
    existing,
    imported,
    workLogImportIdentity,
    row => ({ ...createMeta('unexpected-new'), ...row }),
  );

  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
  assert.equal(result.records[0].id, 'entry-linked');
  assert.equal(result.records[0].projectId, 'stable-project-id');
  assert.equal(result.records[0].status, '新状态');
});

test('blank project names are added instead of being matched ambiguously', () => {
  const { mergeImportRows, projectImportIdentity } = loadMergeModule();
  const existing = [{ ...createMeta('blank-a'), productName: '', client: '客户甲' }];
  const imported = [{ productName: '', client: '客户乙' }];

  const result = mergeImportRows(
    existing,
    imported,
    projectImportIdentity,
    row => ({ ...createMeta('blank-b'), ...row }),
  );

  assert.equal(result.added, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].client, '客户甲');
  assert.equal(result.records[1].client, '客户乙');
});
