const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const JSZip = require('jszip');
const {
  buildWeeklyReportModel,
  loadInitialNotes,
  loadReportSource,
  normalizeNotes,
  renderWeeklySummary,
} = require('../server/services/weeklySummary.cjs');

function rows(values) {
  return values.length > 0 ? [{ values: values.map(value => [JSON.stringify(value)]) }] : [];
}

function sampleEntry(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    category: '正常项目',
    subCategory: '资产服务（主动管理）',
    productName: '测试项目',
    status: '运行中',
    clientType: '测试客户',
    navScale: '1000万',
    establishDate: '2026-07-01',
    channelSales: '测试渠道',
    nextWeekPlan: '继续推进',
    personA: '经理甲',
    personB: '经理乙',
    weeklyProgress: { 260724: '上周进展', 260731: '本周进展' },
    navScaleHistory: { 260724: '900万', 260731: '1000万' },
    dynamicFields: {},
    ...overrides,
  };
}

test('weekly summary model separates report sections and uses the selected week', () => {
  const entries = [
    sampleEntry(),
    sampleEntry({
      category: '问题项目',
      subCategory: '',
      productName: '问题项目甲',
      description: '待处理事项',
      dynamicFields: { progressExpectation: '达到预期' },
    }),
    sampleEntry({
      category: '直销产品情况',
      subCategory: '1、固收系列',
      productName: '固收产品甲',
      nav: 1.02,
      changePercent: 0.1,
      dynamicFields: { weeklyReview: '运行平稳', holdingsOver10: '无' },
    }),
  ];
  const products = [{
    productName: '跨境投资测试号',
    status: '上会中',
    usd: 100,
    rmb: 700,
    feeRate: 0.02,
    establishDate: '2026-08-01',
    target: '测试标的',
    client: '测试委托人',
  }];
  const model = buildWeeklyReportModel({
    weekKey: '260731',
    entries,
    products,
    settings: { exchangeRate: 7 },
    notes: { highlights: ['重点工作'], qdQuota: '10亿，50%' },
  });

  assert.equal(model.reportDate, '2026-07-31');
  assert.equal(model.counts.problemProjects, 1);
  assert.equal(model.counts.pipelineProjects, 1);
  assert.equal(model.counts.fixedIncomeProducts, 1);
  assert.equal(model.counts.serviceProjects, 1);
  assert.equal(model.problemProjects[0][7], '本周进展');
  assert.equal(model.serviceProjects[0][4], '1000万');
});

test('service project classification is shown only on the first row of a consecutive group', () => {
  const model = buildWeeklyReportModel({
    weekKey: '260731',
    entries: [
      sampleEntry({ productName: 'service-one' }),
      sampleEntry({ productName: 'service-two' }),
    ],
    products: [],
    settings: {},
    notes: {},
  });

  assert.notEqual(model.serviceProjects[0][0], '');
  assert.equal(model.serviceProjects[1][0], '');
});

test('weekly summary highlights preserve a dynamic number of items', () => {
  const notes = normalizeNotes({ highlights: ['一项', '二项', '三项', '四项', '五项'], serviceRules: ['一条规则'] });
  assert.deepEqual(notes.highlights, ['一项', '二项', '三项', '四项', '五项']);
  assert.equal(notes.serviceRules.length, 4);
  assert.equal(notes.serviceRules[0], '一条规则');
});

test('a new weekly summary inherits the exact previous week draft for the same user', () => {
  const db = {
    exec(sql, params) {
      if (sql.includes('FROM weekly_report_runs') && params[0] === '260821') return [];
      if (sql.includes('FROM weekly_report_drafts') && params[0] === '260814' && params[1] === 'u1') {
        return [{ values: [[JSON.stringify({ highlights: ['沿用事项'], qdQuota: '20%' }), 3, '2026-08-14T00:00:00.000Z']] }];
      }
      throw new Error(`Unexpected SQL: ${sql} / ${params}`);
    },
  };
  const result = loadInitialNotes(db, '260821', 'u1');
  assert.equal(result.inheritedFromWeekKey, '260814');
  assert.deepEqual(result.notes.highlights, ['沿用事项']);
  assert.equal(result.notes.qdQuota, '20%');
});

test('weekly summary source merges partial snapshots with current week entries', () => {
  const snapshot = sampleEntry({ id: 'shared', productName: '快照版本' });
  const currentShared = sampleEntry({ id: 'shared', productName: '当前版本' });
  const currentOnly = sampleEntry({ id: 'current-only', productName: '未生成快照的项目' });
  const db = {
    exec(sql) {
      if (sql.includes('FROM entry_snapshots')) return rows([snapshot]);
      if (sql.includes('FROM entries')) return rows([currentShared, currentOnly]);
      if (sql.includes('FROM products')) return [];
      if (sql.includes('FROM settings')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const source = loadReportSource(db, '260814');
  assert.equal(source.entries.length, 2);
  assert.equal(source.entries.find(entry => entry.id === 'shared').productName, '快照版本');
  assert.equal(source.entries.find(entry => entry.id === 'current-only').productName, '未生成快照的项目');
});

test('DOCX rendering is deterministic, keeps rows intact, and shows table headings once', async () => {
  const model = buildWeeklyReportModel({
    weekKey: '260731',
    entries: [sampleEntry({ productName: 'service-one' }), sampleEntry({ productName: 'service-two' })],
    products: [],
    settings: {},
    notes: { highlights: ['重点工作1', '重点工作2', '重点工作3', '重点工作4', '重点工作5'], qdQuota: '10亿，50%' },
  });
  const first = await renderWeeklySummary(model);
  const second = await renderWeeklySummary(model);
  assert.deepEqual(first, second);

  const zip = await JSZip.loadAsync(first);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /日期：2026-07-31/);
  assert.match(xml, /重点工作5/);
  assert.match(xml, /上周进展（260731）/);
  assert.doesNotMatch(xml, /<w:tblHeader\/>/);
  assert.match(xml, /<w:cantSplit\/>/);
  assert.match(xml, /<w:vMerge w:val="restart"\/>/);
  assert.match(xml, /<w:vMerge\/>/);
  assert.doesNotMatch(xml, /\{\{[A-Z0-9_]+\}\}/);
});
