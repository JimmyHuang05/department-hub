const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { requireRole, requireBusinessRole } = require('../server/middleware/auth.cjs');
const { ALL_SCOPES } = require('../server/services/apiKeys.cjs');

function runMiddleware(middleware, user) {
  return new Promise(resolve => {
    const result = { status: 200, body: null, next: false };
    const req = { user };
    const res = {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; resolve(result); },
    };
    middleware(req, res, () => { result.next = true; resolve(result); });
  });
}

test('admin-only middleware rejects ordinary users', async () => {
  const result = await runMiddleware(requireRole('admin'), { id: 'u1', role: 'user' });
  assert.equal(result.status, 403);
  assert.equal(result.next, false);
});

test('admin-only middleware accepts administrators', async () => {
  const result = await runMiddleware(requireRole('admin'), { id: 'a1', role: 'admin' });
  assert.equal(result.next, true);
});

test('developer-only middleware rejects advanced users and accepts developers', async () => {
  const advancedUser = await runMiddleware(requireBusinessRole('developer'), { id: 'a1', role: 'admin', business_role: 'admin' });
  assert.equal(advancedUser.status, 403);
  assert.equal(advancedUser.next, false);

  const developer = await runMiddleware(requireBusinessRole('developer'), { id: 'd1', role: 'user', business_role: 'developer' });
  assert.equal(developer.next, true);
});

test('backend service pages are split between advanced users and developers', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/Layout/Sidebar.tsx'), 'utf8');
  const search = fs.readFileSync(path.join(root, 'src/utils/globalSearch.ts'), 'utf8');
  const audit = fs.readFileSync(path.join(root, 'server/routes/audit.cjs'), 'utf8');
  const events = fs.readFileSync(path.join(root, 'server/routes/error-events.cjs'), 'utf8');
  const scheduledJobs = fs.readFileSync(path.join(root, 'server/routes/scheduled-jobs.cjs'), 'utf8');

  assert.match(sidebar, /isAdvancedUser \? \[[\s\S]*user-management[\s\S]*scheduled-jobs/);
  assert.match(sidebar, /isDeveloper \? \[[\s\S]*backups[\s\S]*audit-log[\s\S]*event-log/);
  assert.match(app, /key:'users'[\s\S]*admin:true/);
  assert.match(app, /key:'scheduled-jobs'[\s\S]*admin:true/);
  assert.match(app, /key:'audit'[\s\S]*developer:true/);
  assert.match(app, /key:'error-events'[\s\S]*developer:true/);
  assert.match(app, /key:'backups'[\s\S]*developer:true/);
  assert.match(search, /business_role === 'developer' \? developerPages/);
  assert.match(audit, /requireBusinessRole\('developer'\)/);
  assert.match(events, /requireBusinessRole\('developer'\)/);
  assert.match(scheduledJobs, /requireRole\('admin'\)/);
});

test('business record queries are shared by all authenticated users', () => {
  const root = path.join(__dirname, '..');
  for (const relative of ['server/routes/products.cjs', 'server/routes/entries.cjs']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /buildIsolationFilter|getDataIsolation/);
  }
});

test('destructive bulk routes remain admin-only', () => {
  const root = path.join(__dirname, '..');
  const productSource = fs.readFileSync(path.join(root, 'server/routes/products.cjs'), 'utf8');
  const entrySource = fs.readFileSync(path.join(root, 'server/routes/entries.cjs'), 'utf8');
  assert.match(productSource, /router\.post\('\/batch-delete', authMiddleware, requireRole\('user', 'admin'\)/);
  assert.match(productSource, /canDeleteProduct\(req\.user, productRow\)/);
  assert.match(entrySource, /router\.post\('\/batch-delete', authMiddleware, requireRole\('admin'\)/);
  for (const source of [productSource, entrySource]) {
    assert.match(source, /router\.post\('\/replace', authMiddleware, requireRole\('admin'\)/);
  }
});

test('all authenticated users can list tasks while edits are limited to task members', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/routes/tasks.cjs'), 'utf8');
  assert.match(source, /router\.post\('\/', authMiddleware, requireRole\('user', 'admin'\)/);
  assert.match(source, /if \(req\.query\.mine === 'true'\)/);
  assert.match(source, /function canEditTask\(userId, task\)/);
  assert.match(source, /task\.createdById === userId/);
  assert.match(source, /task\.assignedToId === userId/);
  assert.match(source, /normalizeRecipientIds\(task\.recipientIds\)\.includes\(userId\)/);
  assert.match(source, /if \(!canEditTask\(req\.user\.id, old\)\) return res\.status\(403\)/);
  const updateRoute = source.slice(source.indexOf("router.put('/:id'"), source.indexOf("router.delete('/:id'"));
  assert.doesNotMatch(updateRoute, /created_by !== req\.user\.id|无权修改|只有创建人/);
});

test('remote product collaboration updates do not write back to the API', () => {
  const root = path.join(__dirname, '..');
  const pageSource = fs.readFileSync(path.join(root, 'src/pages/ProjectList.tsx'), 'utf8');
  const subscription = pageSource.slice(
    pageSource.indexOf('// 订阅远程编辑'),
    pageSource.indexOf('}, [products, applyRemoteProductUpdate]);')
  );
  assert.match(subscription, /applyRemoteProductUpdate\(latest\.recordId/);
  assert.doesNotMatch(subscription, /updateProduct\(latest\.recordId/);
});

test('product writes are serialized per record', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/store/projectStore.ts'), 'utf8');
  assert.match(source, /productUpdateQueues = new Map<string, Promise<void>>/);
  assert.match(source, /enqueueProductUpdate\(id, async \(\) =>/);
});

test('worklog writes are serialized per record', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/store/workLogStore.ts'), 'utf8');
  assert.match(source, /entryUpdateQueues = new Map<string, Promise<void>>/);
  assert.match(source, /enqueueEntryUpdate\(id, async \(\) =>/);
});

test('project detail text fields save only when editing ends', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/ProjectList.tsx'), 'utf8');
  assert.match(source, /onChange=\{event => changeDraft\(event\.target\.value\)\}/);
  assert.match(source, /if \(draftDirtyRef\.current\) commitValue\(latestDraftRef\.current\)/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => commitValue\(nextValue\)/);
});

test('worklog detail text fields save only when editing ends', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/WorkLogList.tsx'), 'utf8');
  assert.match(source, /onChange=\{event => changeDraft\(event\.target\.value\)\}/);
  assert.match(source, /if \(!draftDirtyRef\.current\) return;/);
  assert.match(source, /flushDraft\(\);\s*onEditingStop\?\.\(\);/);
});

test('project and worklog names use local drafts instead of saving each keystroke', () => {
  const projectSource = fs.readFileSync(path.join(__dirname, '..', 'src/pages/ProjectList.tsx'), 'utf8');
  const worklogSource = fs.readFileSync(path.join(__dirname, '..', 'src/pages/WorkLogList.tsx'), 'utf8');
  assert.match(projectSource, /function ProjectNameField[\s\S]*const \[draftValue, setDraftValue\] = useState\(value\)/);
  assert.match(worklogSource, /function WorkLogProductNameField[\s\S]*const \[draftValue, setDraftValue\] = useState\(value\)/);
});

test('project cards show CNY and USD amounts on one compact line', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/components/ProductCards.tsx'), 'utf8');
  assert.match(source, /currency: 'CNY'/);
  assert.match(source, /currency: 'USD'/);
  assert.match(source, /index > 0 && <span className="mx-1 shrink-0 text-slate-300">\/<\/span>/);
  assert.match(source, /\{amount\.value\} \{amount\.currency\}/);
  assert.doesNotMatch(source, /label: '人民币'/);
  assert.doesNotMatch(source, /label: '美元'/);
});

test('project and worklog ownership filters use persisted UI preferences', () => {
  const root = path.join(__dirname, '..');
  const project = fs.readFileSync(path.join(root, 'src/pages/ProjectList.tsx'), 'utf8');
  const worklog = fs.readFileSync(path.join(root, 'src/pages/WorkLogList.tsx'), 'utf8');
  const preferences = fs.readFileSync(path.join(root, 'src/store/uiPreferenceStore.ts'), 'utf8');
  assert.match(project, /preferences\.projectOnlyMine/);
  assert.match(worklog, /preferences\.worklogOnlyMine/);
  assert.match(preferences, /worklogOnlyMine: true/);
  assert.match(preferences, /projectOnlyMine: false/);
});

test('authentication does not use a hard-coded fallback secret', () => {
  const root = path.join(__dirname, '..');
  const authSource = fs.readFileSync(path.join(root, 'server/middleware/auth.cjs'), 'utf8');
  const dbSource = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');
  assert.match(authSource, /loadJwtSecret\(\)/);
  assert.doesNotMatch(authSource, /dev-default-jwt-secret-key-2024/);
  assert.doesNotMatch(dbSource, /hashSync\('123456'/);
});

test('server restarts do not invalidate otherwise active login sessions', () => {
  const root = path.join(__dirname, '..');
  const authSource = fs.readFileSync(path.join(root, 'server/middleware/auth.cjs'), 'utf8');
  assert.doesNotMatch(authSource, /AUTH_SESSION_EPOCH_SECONDS/);
  assert.doesNotMatch(authSource, /系统已更新，请重新登录/);
  assert.match(authSource, /jwt\.verify\(tokenStr, JWT_SECRET\)/);
  assert.match(authSource, /isSessionActive\(decoded\.sid\)/);
});

test('the app declares Chinese content and opts out of Chrome page translation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(source, /<html lang="zh-CN" translate="no" class="notranslate">/);
  assert.match(source, /<meta name="google" content="notranslate"/);
  assert.match(source, /id="root" translate="no" class="notranslate"/);
});

test('container health check uses the public health endpoint', () => {
  const root = path.join(__dirname, '..');
  const serverSource = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');
  const composeSource = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
  assert.match(serverSource, /app\.get\('\/healthz'/);
  assert.match(composeSource, /localhost:3000\/healthz/);
});

test('only administrators can approve or return worklogs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/routes/entries.cjs'), 'utf8');
  assert.match(source, /\['return', 'approve'\]\.includes\(action\) && req\.user\.role !== 'admin'/);
});

test('administrators can maintain member email addresses for notifications', () => {
  const root = path.join(__dirname, '..');
  const authSource = fs.readFileSync(path.join(root, 'server/routes/auth.cjs'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'src/pages/UserManagement.tsx'), 'utf8');
  const userUpdateRoute = authSource.slice(
    authSource.indexOf("router.put('/users/:id'"),
    authSource.indexOf("router.delete('/users/:id'"),
  );

  assert.match(userUpdateRoute, /const \{ display_name, email, birthday, role, business_role, status \} = req\.body/);
  assert.match(userUpdateRoute, /validateEmail\(email\)/);
  assert.match(userUpdateRoute, /LOWER\(email\) = \? AND id != \?/);
  assert.match(userUpdateRoute, /updates\.push\('email = \?'\)/);
  assert.match(pageSource, /<FieldLabel>邮箱<\/FieldLabel>/);
  assert.match(pageSource, /email,\s*birthday: editForm\.birthday/);
  assert.match(pageSource, /填写成员邮箱，用于任务通知/);
  assert.match(pageSource, /auto-rows-max content-start/);
  assert.match(pageSource, /data-user-card=\{user\.id\}/);
  assert.match(pageSource, /auto-rows-max content-start/);
  assert.match(pageSource, /mt-auto flex flex-wrap items-center gap-2 pt-4/);
});

test('business backup routes are developer-only and restore only the validated business package', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/routes/backups.cjs'), 'utf8');
  assert.match(source, /router\.use\(authMiddleware, requireBusinessRole\('developer'\)\)/);
  const applyRoute = source.slice(source.indexOf("router.post('/:name/apply'"));
  assert.ok(applyRoute.indexOf('validateBusinessBackup') < applyRoute.indexOf('applyBusinessBackupFile'));
  assert.doesNotMatch(applyRoute, /replaceDatabaseFromBuffer|validateDatabaseBuffer/);
});

test('overwrite imports replace each module atomically and clear worklog snapshots', () => {
  const productSource = fs.readFileSync(path.join(__dirname, '..', 'server/routes/products.cjs'), 'utf8');
  const entrySource = fs.readFileSync(path.join(__dirname, '..', 'server/routes/entries.cjs'), 'utf8');
  const productReplace = productSource.slice(productSource.indexOf("router.post('/replace'"));
  const entryReplace = entrySource.slice(entrySource.indexOf("router.post('/replace'"));

  for (const source of [productReplace, entryReplace]) {
    assert.match(source, /db\.run\('BEGIN'\)/);
    assert.match(source, /db\.run\('COMMIT'\)/);
    assert.match(source, /db\.run\('ROLLBACK'\)/);
  }
  assert.ok(productReplace.indexOf("DELETE FROM products") < productReplace.indexOf("INSERT INTO products"));
  assert.ok(entryReplace.indexOf("DELETE FROM entries") < entryReplace.indexOf("INSERT INTO entries"));
  assert.match(entryReplace, /DELETE FROM entry_snapshots/);
});

test('all three toolkit pages expose drag-and-drop upload zones', () => {
  const root = path.join(__dirname, '..');
  for (const relative of ['src/pages/CloudDrive.tsx', 'src/pages/ToolsCenter.tsx', 'src/pages/SkillsCenter.tsx']) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /<FileDropZone/);
    assert.match(source, /onFiles=/);
  }
});

test('cloud drive PDF previews use a blob URL instead of navigating to the attachment endpoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/CloudDrive.tsx'), 'utf8');
  assert.match(source, /if \(kind === 'office'\)/);
  assert.doesNotMatch(source, /if \(kind === 'pdf' \|\| kind === 'office'\)/);
  assert.match(source, /new Blob\(\[responseBlob\], \{ type: 'application\/pdf' \}\)/);
  assert.match(source, /objectUrl = URL\.createObjectURL\(blob\)/);
});

test('integration API exposes cloud files, tools and skills through read-only scopes', () => {
  assert.deepEqual(ALL_SCOPES, [
    'read:projects',
    'read:worklogs',
    'read:clouddrive',
    'read:tools',
    'read:skills',
    'read:questionnaires',
  ]);

  const root = path.join(__dirname, '..');
  const routeSource = fs.readFileSync(path.join(root, 'server/routes/integration.cjs'), 'utf8');
  const openApiSource = fs.readFileSync(path.join(root, 'server/routes/integration-openapi.cjs'), 'utf8');
  const skillSource = fs.readFileSync(path.join(root, 'public/skill.md'), 'utf8');
  const skillVersionSource = fs.readFileSync(path.join(root, 'server/services/skillVersion.cjs'), 'utf8');

  for (const [route, scope] of [
    ['/files', 'read:clouddrive'],
    ['/tools', 'read:tools'],
    ['/skills', 'read:skills'],
  ]) {
    assert.match(routeSource, new RegExp(`router\\.get\\('${route.replace('/', '\\/')}'\\s*,\\s*requireApiScope\\('${scope}'\\)`));
  }
  assert.match(routeSource, /router\.get\('\/files\/:id\/download', requireApiScope\('read:clouddrive'\)/);
  assert.match(routeSource, /router\.get\('\/tools\/:id\/download', requireApiScope\('read:tools'\)/);
  assert.match(routeSource, /router\.get\('\/skills\/:id\/content', requireApiScope\('read:skills'\)/);
  assert.match(routeSource, /router\.get\('\/skills\/:id\/download', requireApiScope\('read:skills'\)/);
  assert.doesNotMatch(routeSource, /getDataIsolation/);
  assert.match(openApiSource, /'\/skills\/\{id\}\/content'/);
  assert.match(skillSource, /GET \/files\/\{id\}\/content/);
  assert.match(skillSource, /仅在用户明确要求离线文件时使用 `\/download`/);
  assert.match(skillSource, /GET \/skills\/\{id\}\/content/);
  assert.match(skillVersionSource, /SKILL_VERSION = '\d{8}-\d{6}'/);
  assert.match(skillVersionSource, /X-IBD-Skill-Update/);
  assert.match(skillVersionSource, /process\.env\.IBD_PUBLIC_URL/);
  assert.match(skillVersionSource, /SKILL_PATH = '\/skill\.md'/);
  assert.match(skillSource, /所有请求使用用户当前的同一把 API Key/);
  assert.match(skillSource, /不得在回复、日志、截图或公开内容中显示 API Key/);
  assert.match(skillSource, /GET \/bootstrap/);
  assert.match(skillSource, /GET \/bootstrap/);
  assert.match(skillSource, /不得在回复、日志、截图或公开内容中显示 API Key/);
  assert.match(routeSource, /skill: skillMetadata\(req\)/);
  assert.match(routeSource, /router\.get\('\/bootstrap', canReadAny/);
  assert.match(routeSource, /readableResources\(req\.apiKey\.scopes, false\)/);
});

test('weekly todo snoozes are scoped to the authenticated user and week', () => {
  const root = path.join(__dirname, '..');
  const routeSource = fs.readFileSync(path.join(root, 'server/routes/preferences.cjs'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
  assert.match(routeSource, /WHERE user_id=\? AND week_key=\?/);
  assert.match(routeSource, /\[req\.user\.id, weekKey\]/);
  assert.match(routeSource, /INSERT OR REPLACE INTO todo_snoozes/);
  assert.match(dashboardSource, /本周无改动/);
  assert.match(dashboardSource, /filter\(item => !snoozedTodoIds\.has\(item\.id\)\)/);
});

test('weekly todos belong only to the account named as A, B or direct-sales contact', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/Dashboard.tsx'), 'utf8');
  assert.match(source, /isDirectSalesWorkLog\(entry\)[\s\S]*dynamicFields\?\.channelContact/);
  assert.match(source, /: \[entry\.personA, entry\.personB\]/);
  assert.match(source, /filter\(entry => isAssignedToAccount\(entry, managerName\)\)/);
  assert.match(source, /if \(gaps\.length === 0 && wasUpdatedInWeek\(entry\.updatedAt, weekKey\)\) return null/);
  assert.match(source, /待确认：本周情况/);
  assert.doesNotMatch(source, /visibleTodoItems\.slice\(0,\s*8\)/);
  assert.doesNotMatch(source, /directlyAssignedProducts/);
  assert.doesNotMatch(source, /isProductAssignedToManager/);
});

test('dashboard can pin every weekly todo in the sidebar until the query is cleared', () => {
  const root = path.join(__dirname, '..');
  const dashboardSource = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(root, 'src/components/Layout/Sidebar.tsx'), 'utf8');
  const eventSource = fs.readFileSync(path.join(root, 'src/utils/weeklyTodoSearch.ts'), 'utf8');
  assert.match(dashboardSource, /openWeeklyTodoSearch\(stats\.todoItems\.map/);
  assert.match(dashboardSource, /<ArrowLeft size=\{18\}/);
  assert.match(eventSource, /WEEKLY_TODO_SEARCH_QUERY = '本周待办'/);
  assert.match(eventSource, /window\.sessionStorage\.setItem/);
  assert.match(eventSource, /window\.sessionStorage\.removeItem/);
  assert.match(sidebarSource, /readWeeklyTodoSearch\(\)/);
  assert.match(sidebarSource, /if \(isWeeklyTodoSearch\) return weeklyTodoResults/);
  assert.match(sidebarSource, /if \(!isWeeklyTodoSearch\)[\s\S]*closeSearch\(\)/);
  assert.match(sidebarSource, /weeklyTodoResults !== null && !value\.trim\(\)/);
});
