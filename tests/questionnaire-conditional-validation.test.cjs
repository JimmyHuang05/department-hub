const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFields, validateAnswers, getVisibleFieldIds } = require('../modules/questionnaire/server/router.cjs')._test;

const fields = [
  { id: 'type', label: '项目类型', type: 'single_choice', required: true, hidden: false, options: ['港股IPO', '境外组合投资'] },
  { id: 'assets', label: '投资品种', type: 'multiple_choice', required: true, hidden: false, options: ['股票', '票据'], visibility: { fieldId: 'type', operator: 'equals', value: '境外组合投资' } },
  { id: 'criteria', label: '标的筛选标准', type: 'long_text', required: true, hidden: false, options: [], visibility: { fieldId: 'assets', operator: 'not_equals', value: '票据' } },
];

test('does not require a descendant when its controlling field is hidden', () => {
  const result = validateAnswers(fields, { type: '港股IPO' });
  assert.equal(result.error, undefined);
  assert.equal(result.answers.criteria, '');
});

test('requires the descendant when its visible controlling answer matches', () => {
  const result = validateAnswers(fields, { type: '境外组合投资', assets: ['股票'] });
  assert.equal(result.error, '请填写“标的筛选标准”');
});

test('does not require the descendant when票据 is selected', () => {
  const result = validateAnswers(fields, { type: '境外组合投资', assets: ['票据'] });
  assert.equal(result.error, undefined);
});

test('statistics visibility excludes descendants of a hidden controlling field', () => {
  const ipoVisible = getVisibleFieldIds(fields, { type: '港股IPO', assets: [], criteria: '' });
  assert.equal(ipoVisible.has('assets'), false);
  assert.equal(ipoVisible.has('criteria'), false);

  const portfolioVisible = getVisibleFieldIds(fields, { type: '境外组合投资', assets: ['股票'], criteria: '成长性' });
  assert.equal(portfolioVisible.has('assets'), true);
  assert.equal(portfolioVisible.has('criteria'), true);
});

test('rejects a condition that references a removed choice option', () => {
  const invalid = fields.map(field => field.id === 'criteria'
    ? { ...field, visibility: { fieldId: 'assets', operator: 'equals', value: '已删除选项' } }
    : field);
  assert.equal(normalizeFields(invalid), null);
});
