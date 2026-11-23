const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadCopyUtils() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/utils/questionnaireCopy.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
  return module.exports;
}

test('questionnaire copy regenerates field ids and remaps visibility dependencies', () => {
  const { cloneQuestionnaireFields } = loadCopyUtils();
  let next = 0;
  const source = [
    { id: 'old-a', label: '是否合作', type: 'single_choice', required: true, options: ['是', '否'] },
    { id: 'old-b', label: '合作说明', type: 'long_text', required: false, options: [], visibility: { fieldId: 'old-a', operator: 'equals', value: '是' } },
  ];
  const copy = cloneQuestionnaireFields(source, () => `new-${++next}`);
  assert.deepEqual(copy.map(item => item.id), ['new-1', 'new-2']);
  assert.equal(copy[1].visibility.fieldId, 'new-1');
  assert.notEqual(copy[0].options, source[0].options);
  assert.deepEqual(source.map(item => item.id), ['old-a', 'old-b']);
});

test('questionnaire copy gets an explicit draft title', () => {
  const { questionnaireCopyTitle } = loadCopyUtils();
  assert.equal(questionnaireCopyTitle('客户需求调查'), '客户需求调查（副本）');
});

test('questionnaire edit updates the source and save-as creates a separate questionnaire', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src/pages/QuestionnairesCenter.tsx'), 'utf8');
  assert.match(page, /setCopyingFrom\(item\)/);
  assert.match(page, /api\.put\(`\/questionnaires\/\$\{copyingFrom\.id\}`/);
  assert.match(page, /await api\.post\('\/questionnaires'/);
  assert.match(page, /copyingFrom \? '问卷已更新'/);
  assert.match(page, /已另存为/);
});
