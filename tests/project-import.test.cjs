const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadImportInternals() {
  const file = path.join(__dirname, '..', 'src/utils/project-import-core.ts');
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const customRequire = request => {
    if (request === './format') {
      return {
        normalizeRate(value) {
          const rate = Number(value);
          return Math.abs(rate) > 1 ? rate / 100 : rate;
        },
      };
    }
    return require(request);
  };
  new Function('require', 'module', 'exports', compiled)(customRequire, module, module.exports);
  return module.exports.projectImportInternals;
}

function settings() {
  return {
    statusConfigs: [{ id: 'collecting', name: '材料收集', color: '#eee' }],
    customColumns: [],
  };
}

test('project import locates the real header and keeps rows whose project name is blank', () => {
  const { parseProjectSheets } = loadImportInternals();
  const result = parseProjectSheets([
    { name: '数据源', rows: [['进度', '材料收集', '已落地']] },
    {
      name: '服务类信托进度表',
      rows: [
        ['预计合计', '', 100],
        ['未落地合计', '', 50],
        ['已落地合计', '', 50],
        ['委托人', '材料收集', '费率', '(预计)成立时间', '规模(rmb)', '项目', '托管行', '截止时间'],
        ['客户甲', '已过会', 0.023, 46042, 4000, '跨境投资7号', '德意志', new Date(2026, 10, 30)],
        ['客户乙', '材料收集', 2.5, '2026/08/01', 5000, '', '渣打', '2026/11/30'],
      ],
    },
  ], settings());

  assert.equal(result.rows.length, 2);
  assert.equal(result.totalRows, 2);
  assert.equal(result.successRows, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].productName, '跨境投资7号');
  assert.equal(result.rows[0].client, '客户甲');
  assert.equal(result.rows[0].status, '已过会');
  assert.equal(result.rows[0].feeRate, 0.023);
  assert.equal(result.rows[0].establishDate, '2026-01-20');
  assert.equal(result.rows[0].deadline, '2026-11-30');
  assert.equal(result.rows[0].rmb, 4000);
  assert.equal(result.rows[0].custodianBank, '德意志');
  assert.equal(result.rows[1].productName, '');
  assert.equal(result.rows[1].client, '客户乙');
  assert.equal(result.rows[1].rmb, 5000);
});

test('project import rebuilds the mapping when a repeated header changes column order', () => {
  const { parseProjectSheets } = loadImportInternals();
  const result = parseProjectSheets([{
    name: '项目进度',
    rows: [
      ['项目', '规模（USD）', '状态'],
      ['项目甲', 100, '上会中'],
      ['状态', '产品名称', 'USD'],
      ['已落地', '项目乙', 200],
    ],
  }], settings());

  assert.deepEqual(
    result.rows.map(row => [row.productName, row.usd, row.status]),
    [
      ['项目甲', 100, '上会中'],
      ['项目乙', 200, '已落地'],
    ],
  );
});

test('project import leaves absent numeric fields undefined for merge completion', () => {
  const { parseProjectSheets } = loadImportInternals();
  const result = parseProjectSheets([{
    name: '项目进度',
    rows: [
      ['项目', '状态'],
      ['项目甲', '运行中'],
    ],
  }], settings());

  assert.equal(result.rows[0].productName, '项目甲');
  assert.equal(result.rows[0].status, '运行中');
  assert.equal(Object.hasOwn(result.rows[0], 'usd'), false);
  assert.equal(Object.hasOwn(result.rows[0], 'feeRate'), false);
});

test('project import recognizes normalized aliases and custom columns', () => {
  const { parseProjectSheets } = loadImportInternals();
  const customSettings = settings();
  customSettings.customColumns = [
    { id: '1', key: 'custom_col_score', title: '内部评分', type: 'number' },
  ];
  const result = parseProjectSheets([{
    name: 'Sheet1',
    rows: [
      ['产品 名称', '规模（RMB）', '券商／渠道', '基石／锚定', '内部评分'],
      ['项目甲', '1,200', '中金', '锚定', '88.5'],
    ],
  }], customSettings);

  assert.equal(result.rows[0].productName, '项目甲');
  assert.equal(result.rows[0].rmb, 1200);
  assert.equal(result.rows[0].brokerChannel, '中金');
  assert.equal(result.rows[0].strategy, '锚定');
  assert.equal(result.rows[0].dynamicFields.custom_col_score, 88.5);
});

test('project import recognizes reordered business milestone date columns', () => {
  const { parseProjectSheets } = loadImportInternals();
  const result = parseProjectSheets([{
    name: '项目进度',
    rows: [
      ['项目中止时间', '项目', '实际落地时间', '进入推进时间', '项目创建日期', '状态'],
      ['2026/07/20', '项目甲', 46200, '2026年2月3日', '2026-01-05', '项目中止'],
    ],
  }], settings());

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].projectCreatedDate, '2026-01-05');
  assert.equal(Object.hasOwn(result.rows[0], 'progressStartDate'), false);
  assert.equal(result.rows[0].establishDate, '2026-06-27');
  assert.equal(result.rows[0].projectStoppedDate, '2026-07-20');
});
