const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadImportInternals() {
  const file = path.join(__dirname, '..', 'src/utils/worklog-import-utils.ts');
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
    if (request === './week') {
      return {
        getWeekKeyForDate(date) {
          return [
            String(date.getFullYear()).slice(-2),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
          ].join('');
        },
      };
    }
    if (request === './fieldMaps') {
      return {
        WORKLOG_HEADER_MAP: {
          产品名称: 'productName',
          正常项目: 'subCategory',
          项目分类: 'subCategory',
          类别: 'subCategory',
          状态: 'status',
          客户名称: 'clientType',
          项目经理A: 'personA',
          项目经理B: 'personB',
          '规模（万）': 'navScale',
          '目标规模（万）': 'productTerm',
          净值: 'nav',
          较上周: 'changePercent',
          一周回顾: 'dynamicFields.weeklyReview',
          后续计划: 'nextWeekPlan',
          该产品销售渠道: 'channelSales',
          销售渠道: 'channelSales',
          渠道对接人: 'dynamicFields.channelContact',
          当周申赎情况: 'dynamicFields.subscriptionRedemption',
          下一步工作计划: 'dynamicFields.nextSalesPlan',
        },
      };
    }
    return require(request);
  };
  new Function('require', 'module', 'exports', compiled)(customRequire, module, module.exports);
  return module.exports.workLogImportInternals;
}

test('worklog import resolves the three sheets independently of workbook order', () => {
  const { resolveSheetNames } = loadImportInternals();
  assert.deepEqual(resolveSheetNames([' 问题项目 ', '正常项目', '直销产品情况']), {
    问题项目: ' 问题项目 ',
    正常项目: '正常项目',
    直销产品情况: '直销产品情况',
  });
});

test('Excel date serials keep the intended calendar day', () => {
  const { excelSerialToISODate } = loadImportInternals();
  assert.equal(excelSerialToISODate(46227), '2026-07-24');
  assert.equal(excelSerialToISODate(25569), '1970-01-01');
});

test('worklog import maps reordered columns by labels and inherits the latest blank progress', () => {
  const { buildColumnMap, mapRowToEntry } = loadImportInternals();
  const headers = ['状态', '上周进展（260717）', '产品名称', '客户名称', '上周进展（260710）', '上周进展（260703）'];
  const values = ['推进中', '', '跨境投资1号', '客户甲', '', '已提交方案'];
  const entry = mapRowToEntry(values, buildColumnMap(headers), '正常项目');

  assert.equal(entry.productName, '跨境投资1号');
  assert.equal(entry.status, '推进中');
  assert.equal(entry.clientType, '客户甲');
  assert.equal(entry.weeklyProgress['260703'], '已提交方案');
  assert.equal(entry.weeklyProgress['260717'], '已提交方案');
  assert.equal(entry.weekKey, '260717');
});

test('worklog import recognizes project manager aliases used by the problem-project sheet', () => {
  const { buildColumnMap, mapRowToEntry } = loadImportInternals();
  const headers = ['项目名称', '项目经理B', '项目经理A', '状态'];
  const values = ['问题项目甲', '经理乙', '经理甲', '处理中'];
  const entry = mapRowToEntry(values, buildColumnMap(headers), '问题项目');

  assert.equal(entry.personA, '经理甲');
  assert.equal(entry.personB, '经理乙');
});

test('normal-project import treats the source first column as project classification', () => {
  const { buildColumnMap, mapRowToEntry } = loadImportInternals();
  const headers = ['正常项目', '状态', '产品名称'];
  const values = ['资产管理', '运行中', '正常项目甲'];
  const entry = mapRowToEntry(values, buildColumnMap(headers), '正常项目');

  assert.equal(entry.category, '正常项目');
  assert.equal(entry.subCategory, '资产管理');
});

test('historical worklog fallback includes project classification', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/WorkLogList.tsx'), 'utf8');
  const fieldList = source.match(/const HISTORICAL_MANAGEMENT_FIELDS[\s\S]*?\];/)?.[0] || '';

  assert.match(fieldList, /'subCategory'/);
});

test('direct-sales import combines status, operation and sales sections by their labels', () => {
  const { parseDirectSalesRows } = loadImportInternals();
  const result = parseDirectSalesRows([
    ['直销产品情况'],
    ['1、固收系列'],
    ['较上周', '产品名称', '净值', '规模（万）', '目标规模（万）'],
    [-0.0185, '直销产品甲', 1.0301, 588, 1000],
    [],
    ['一周回顾', '本周保持原有持仓'],
    ['后续计划', '继续关注市场机会'],
    [],
    ['下一步工作计划', '当周申赎情况', '渠道对接人', '该产品销售渠道'],
    ['持续营销', '净申购100万', '渠道经理甲', '财富'],
  ], '260731');

  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].productName, '直销产品甲');
  assert.equal(result.rows[0].nav, 1.0301);
  assert.equal(result.rows[0].changePercent, -0.0185);
  assert.equal(result.rows[0].navScale, '588');
  assert.equal(result.rows[0].dynamicFields.weeklyReview, '本周保持原有持仓');
  assert.equal(result.rows[0].nextWeekPlan, '继续关注市场机会');
  assert.equal(result.rows[0].channelSales, '财富');
  assert.equal(result.rows[0].dynamicFields.channelContact, '渠道经理甲');
  assert.equal(result.rows[0].dynamicFields.subscriptionRedemption, '净申购100万');
  assert.equal(result.rows[0].dynamicFields.nextSalesPlan, '持续营销');
  assert.equal(result.rows[0].weeklyProgress['260731'], '本周保持原有持仓');
  assert.equal(result.rows.some(row => row.productName === '财富'), false);
});

test('worklog import aligns duplicated problem-project week headers by the normal-project columns', () => {
  const { alignProgressColumnMap, buildColumnMap } = loadImportInternals();
  const headers = [
    '项目名称',
    '上周进展（260724）',
    '上周进展（260724）',
    '上周进展',
  ];
  const aligned = alignProgressColumnMap(
    headers,
    buildColumnMap(headers),
    new Map([
      [1, '260710'],
      [2, '260717'],
      [3, '260724'],
    ]),
  );

  assert.deepEqual(aligned.map(info => info.progressKey || ''), [
    '',
    '260710',
    '260717',
    '260724',
  ]);
});

test('all worklog categories receive every imported week and copy the latest week into the current week', () => {
  const { completeImportedWeekCoverage } = loadImportInternals();
  const rows = completeImportedWeekCoverage([
    {
      category: '正常项目',
      productName: '正常项目甲',
      navScale: '规模100',
      weeklyProgress: { 260717: '第29周', 260724: '第30周' },
      navScaleHistory: {},
    },
    {
      category: '问题项目',
      productName: '问题项目甲',
      weeklyProgress: { 260717: '问题处理' },
      navScaleHistory: {},
    },
    {
      category: '直销产品情况',
      productName: '直销产品甲',
      weeklyProgress: {},
      navScaleHistory: {},
      dynamicFields: { weeklyReview: '最新回顾' },
    },
  ], ['260717', '260724'], '260731');

  assert.equal(rows.every(row => row.weekKey === '260731'), true);
  assert.equal(rows[0].weeklyProgress['260731'], '第30周');
  assert.equal(rows[1].weeklyProgress['260724'], '问题处理');
  assert.equal(rows[1].weeklyProgress['260731'], '问题处理');
  assert.equal(Object.hasOwn(rows[2].weeklyProgress, '260717'), true);
  assert.equal(Object.hasOwn(rows[2].weeklyProgress, '260724'), true);
  assert.equal(Object.hasOwn(rows[2].weeklyProgress, '260731'), true);
  assert.equal(rows[2].dynamicFields.weeklyReview, '最新回顾');
});
