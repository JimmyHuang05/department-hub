const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadDuplicateDetection() {
  const file = path.join(__dirname, '..', 'src', 'utils', 'duplicateDetection.ts');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', output)(loaded, loaded.exports, require);
  return loaded.exports;
}

const detection = loadDuplicateDetection();

function product(id, overrides = {}) {
  return {
    id,
    createdAt: '',
    updatedAt: '',
    productName: '跨境投资112号',
    usd: 0,
    rmb: 23000,
    feeRate: 0.025,
    establishDate: '2026-08-01',
    target: '佰维存储',
    client: '机构客户A',
    brokerChannel: '',
    strategy: '基石',
    custodianBank: '德意志',
    tradingBroker: '',
    annualIncome: 552,
    thisYearIncome: 100,
    performanceIncome: 172.63,
    status: '材料收集',
    trustManager: '周文杰',
    deadline: '',
    remarks: '',
    dynamicFields: {},
    ...overrides,
  };
}

test('same name with different business fields is not a duplicate', () => {
  const left = product('left');
  const right = product('right', { client: '机构客户B', rmb: 5000, target: '拓斯达' });
  const result = detection.findExactDuplicateGroups([left, right], detection.PRODUCT_COMPARE_FIELDS);
  assert.equal(result.groups.length, 0);
  assert.equal(result.duplicateIds.size, 0);
});

test('all matching business fields are detected as duplicate records', () => {
  const left = product('left', { dynamicFields: { region: '上海', level: 2 } });
  const right = product('right', {
    productName: '  跨境投资112号  ',
    dynamicFields: { level: 2, region: '上海' },
  });
  const result = detection.findExactDuplicateGroups([left, right], detection.PRODUCT_COMPARE_FIELDS);
  assert.deepEqual(result.groups, [['left', 'right']]);
});

test('different worklog weeks are not duplicate records', () => {
  const fields = detection.WORKLOG_COMPARE_FIELDS;
  const base = Object.fromEntries(fields.map(field => [field, '']));
  const left = { id: 'left', productName: '同名周报', ...base, weekKey: '260710' };
  const right = { id: 'right', productName: '同名周报', ...base, weekKey: '260717' };
  const result = detection.findExactDuplicateGroups([left, right], fields);
  assert.equal(result.groups.length, 0);
});
