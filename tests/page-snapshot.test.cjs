const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const moduleSource = read('src/utils/pageSnapshot.ts');
const tasks = read('src/pages/Tasks.tsx');
const worklog = read('src/pages/WorkLogList.tsx');
const projects = read('src/pages/ProjectList.tsx');
const cloud = read('src/utils/cloudDriveEditorState.ts');
const app = read('src/App.tsx');

test('page snapshots use session storage and are isolated by account and page', () => {
  assert.match(moduleSource, /window\.sessionStorage/);
  assert.doesNotMatch(moduleSource, /localStorage/);
  assert.match(moduleSource, /userId.*pageKey|pageKey.*userId/);
});

test('task center restores field-level state, drafts, selected detail and independent scroll areas', () => {
  for (const field of ['filter', 'scope', 'search', 'selectedTaskId', 'commentDrafts', 'createDraft', 'selectedRecipientIds', 'listScrollTop', 'detailInfoScrollTop', 'commentsScrollTop']) {
    assert.match(tasks, new RegExp(field));
  }
  assert.match(tasks, /readPageSnapshot<TaskPageSnapshot>/);
  assert.match(tasks, /writePageSnapshot\(snapshotKey/);
});

test('worklog, projects, cloud drive and app scroll use the shared snapshot module', () => {
  assert.match(worklog, /readPageSnapshot<WorkLogPageMemory>/);
  assert.match(projects, /readPageSnapshot<ProjectPageSnapshot>/);
  assert.match(cloud, /readPageSnapshot<CloudDriveEditorState>/);
  assert.match(app, /patchPageSnapshot/);
});

test('cloud drive no longer persists return state in local storage', () => {
  assert.doesNotMatch(cloud, /localStorage/);
  assert.match(cloud, /writePageSnapshot/);
});
