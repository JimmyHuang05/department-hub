const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const modal = fs.readFileSync(path.join(root, 'src/components/Layout/AppModal.tsx'), 'utf8');
const worklogs = fs.readFileSync(path.join(root, 'src/pages/WorkLogList.tsx'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'src/pages/ProjectList.tsx'), 'utf8');
const mobileStyles = fs.readFileSync(path.join(root, 'src/styles/mobile-system.css'), 'utf8');

test('shared modals support dimmed and transparent backdrop variants', () => {
  assert.match(modal, /type ModalBackdrop = 'dim' \| 'none'/);
  assert.match(modal, /backdropVisible = backdrop \? backdrop === 'dim' : overlay/);
  assert.match(worklogs, /title="新增管理周报"[\s\S]*?scopeId="worklog-content-scope"[\s\S]*?backdrop="none"/);
  assert.match(projects, /title="新增项目"[\s\S]*?scopeId="projects-content-scope"[\s\S]*?backdrop="none"/);
  assert.doesNotMatch(worklogs, /title="新增管理周报"[\s\S]*?pageMode/);
  assert.doesNotMatch(projects, /title="新增项目"[\s\S]*?pageMode/);
});

test('project table toolbar starts with a multi-select stage menu', () => {
  const select = fs.readFileSync(path.join(root, 'src/components/Form/AppSelect.tsx'), 'utf8');
  assert.match(select, /selectedValues\?: string\[\]/);
  assert.match(select, /if \(isMultiple\)[\s\S]*?onToggle\?\.\(nextValue\)[\s\S]*?return/);
  assert.match(projects, /effectiveDisplayMode === 'fs' \? filteredProducts : stageFilteredProducts/);
  assert.match(projects, /leadingContent=\{effectiveDisplayMode === 'table'[\s\S]*?selectedValues=\{activeProjectStageIds\}[\s\S]*?onToggle=\{toggleProjectStage\}[\s\S]*?ariaLabel="筛选项目阶段"[\s\S]*?ref=\{setProjectTableToolbarHost\}/);
});

test('project and worklog table format toolbars collapse before overlapping page actions', () => {
  const worklogs = fs.readFileSync(path.join(root, 'src/pages/WorkLogList.tsx'), 'utf8');
  const projectExcel = fs.readFileSync(path.join(root, 'src/components/ProjectExcelView.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(projects, /project-format-toolbar-host[\s\S]*?ref=\{setProjectTableToolbarHost\}|ref=\{setProjectTableToolbarHost\}[\s\S]*?project-format-toolbar-host/);
  assert.match(worklogs, /ref=\{setWorkLogTableToolbarHost\}[\s\S]*?project-format-toolbar-host/);
  assert.match(projectExcel, /data-toolbar-collapse="medium"/);
  assert.match(projectExcel, /data-toolbar-collapse="compact"/);
  assert.match(styles, /\.project-format-toolbar-host\s*\{[\s\S]*?container-type:\s*inline-size;/);
  assert.doesNotMatch(styles, /\.project-format-toolbar-host\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(styles, /@container \(max-width: 680px\)[\s\S]*?data-toolbar-collapse='medium'/);
  assert.match(styles, /@container \(max-width: 480px\)[\s\S]*?data-toolbar-collapse='compact'/);
});

test('tool updates use the shared dimmed modal while questionnaire editing has no backdrop', () => {
  const tools = fs.readFileSync(path.join(root, 'src/pages/ToolsCenter.tsx'), 'utf8');
  const questionnaireEditor = fs.readFileSync(path.join(root, 'src/components/Questionnaires/QuestionnaireVisualEditor.tsx'), 'utf8');
  assert.match(tools, /<AppModal[\s\S]*?open=\{uploadOpen\}[\s\S]*?backdrop="dim"[\s\S]*?id="tool-upload-form"/);
  assert.match(questionnaireEditor, /<AppModal[^>]*backdrop="none"/);
});

test('project and worklog create modals close without the full-panel shrink animation', () => {
  const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(modal, /exitAnimation\?: boolean/);
  assert.match(modal, /usePresence\(open, exitAnimation \? 220 : 0\)/);
  assert.match(worklogs, /title="新增管理周报"[\s\S]*?exitAnimation=\{false\}/);
  assert.match(projects, /title="新增项目"[\s\S]*?exitAnimation=\{false\}/);
  assert.match(styles, /\.app-modal-panel\.app-modal-panel-no-exit[\s\S]*?transform: translate\(0\) scale\(1\) !important;[\s\S]*?transition: none !important;/);
});

test('mobile portaled modals reserve space above the persistent bottom navigation', () => {
  assert.match(modal, /createPortal\([\s\S]*?document\.body/);
  assert.match(mobileStyles, /html\.app-mobile-detail-open \.app-modal-panel,[\s\S]*?padding-bottom: calc\(var\(--m-nav-h\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(mobileStyles, /html\.app-mobile-detail-open #root \.app-modal-panel/);
});
