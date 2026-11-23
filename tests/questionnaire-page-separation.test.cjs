const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/components/Layout/Sidebar.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/QuestionnairesCenter.tsx'), 'utf8');
const resultsWorkspace = fs.readFileSync(path.join(root, 'src/components/Questionnaires/QuestionnaireResultsWorkspace.tsx'), 'utf8');

test('questionnaire design and result analysis use separate authenticated pages', () => {
  assert.match(app, /path:'\/questionnaires\/\*'/);
  assert.match(app, /path:'\/questionnaire-results'/);
  assert.match(app, /<QuestionnairesCenter mode="design" \/>/);
  assert.match(app, /<QuestionnairesCenter mode="results" \/>/);
  assert.match(page, /mode\?: 'design' \| 'results'/);
  assert.match(page, /resultsMode \? '问卷分析' : '问卷'/);
});

test('questionnaire analysis navigation follows project progress', () => {
  const projects = sidebar.indexOf("label: '项目进度'");
  const analysis = sidebar.indexOf("label: '问卷分析'");
  assert.ok(projects >= 0 && analysis > projects);
  assert.match(sidebar, /label: '问卷分析', icon: BarChart3, path: '\/questionnaire-results'/);
});

test('questionnaire analysis opens each questionnaire on submission details', () => {
  assert.match(resultsWorkspace, /useState<AnalysisView>\('submissions'\)/);
  assert.match(resultsWorkspace, /useEffect\(\(\) => \{ setView\('submissions'\); \}, \[selectedId\]\)/);
});
