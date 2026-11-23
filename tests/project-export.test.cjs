const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadProjectExport() {
  const file = path.join(__dirname, '..', 'src/utils/projectProgressExport.ts');
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
    if (request === './fileSave') return { saveBlobAsFile() {} };
    return require(request);
  };
  new Function('require', 'module', 'exports', compiled)(customRequire, module, module.exports);
  return module.exports;
}

test('project export places the three business milestone dates in the rightmost columns', async () => {
  const { buildProjectProgressWorkbook } = loadProjectExport();
  const workbook = await buildProjectProgressWorkbook({
    exchangeRate: 7,
    products: [{
      id: 'p1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      productName: '项目甲',
      usd: 100,
      rmb: 700,
      feeRate: 0.02,
      projectCreatedDate: '2026-01-02',
      progressStartDate: '2026-02-03',
      establishDate: '2026-03-04',
      projectStoppedDate: '2026-04-05',
      target: '',
      client: '',
      brokerChannel: '',
      strategy: '',
      custodianBank: '',
      tradingBroker: '',
      annualIncome: 0,
      thisYearIncome: 0,
      performanceIncome: 0,
      status: '项目中止',
      trustManager: '',
      deadline: '2026-12-31',
      remarks: '',
      dynamicFields: {},
    }],
  });
  const sheet = workbook.worksheets[0];

  assert.deepEqual(
    ['R4', 'S4', 'T4'].map(address => sheet.getCell(address).value),
    ['项目创建日', '成立/落地日', '项目中止日'],
  );
  assert.equal(sheet.getCell('Q4').value, '截止时间');
  assert.equal(sheet.getCell('S5').value.toISOString().slice(0, 10), '2026-03-04');
  assert.match(sheet.getCell('L5').value.formula, /S5.*Q5/);
  assert.equal(sheet.getCell('N5').value, '项目中止');
});
