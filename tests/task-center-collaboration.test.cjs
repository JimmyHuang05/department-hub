const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'server/routes/tasks.cjs'), 'utf8');
const db = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/Tasks.tsx'), 'utf8');
const notifications = fs.readFileSync(path.join(root, 'server/services/notifications.cjs'), 'utf8');
const messages = fs.readFileSync(path.join(root, 'src/pages/Messages.tsx'), 'utf8');

test('task center defaults to an all-member list and retains optional personal filters', () => {
  assert.match(page, /const query = new URLSearchParams\(\);/);
  assert.doesNotMatch(page, /new URLSearchParams\(\{ mine: 'true' \}\)/);
  assert.match(page, /all: '所有任务', created: '我创建的', collaborated: '我协作的'/);
  assert.match(route, /if \(req\.query\.mine === 'true'\)/);
});

test('tasks support ownership, business regions, remarks and backward-compatible defaults', () => {
  assert.match(route, /validOwnershipTypes = new Set\(\['self_developed', 'business_center'\]\)/);
  assert.match(route, /validBusinessRegions = new Set\(\['east', 'central', 'west', 'north', 'south'\]\)/);
  assert.match(route, /ownershipType: 'self_developed', businessRegion: ''/);
  assert.match(route, /remark: String\(task\.remark \|\| ''\)/);
  assert.match(page, /华东/);
  assert.match(page, /创建备注/);
});

test('task comments are independently stored, timestamped and visible to authenticated users', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS task_comments/);
  assert.match(db, /idx_task_comments_task_time/);
  assert.match(route, /router\.get\('\/:id\/comments', authMiddleware/);
  assert.match(route, /router\.post\('\/:id\/comments', authMiddleware, requireRole\('user', 'admin'\)/);
  assert.match(route, /只能删除自己的留言/);
  assert.match(route, /if \(comment\.user_id !== req\.user\.id\) return res\.status\(403\)/);
  assert.doesNotMatch(route, /req\.user\.role !== 'admin' && comment\.user_id !== req\.user\.id/);
  assert.match(route, /deleted_at/);
  assert.match(page, /所有成员均可留言，内容将记录提交人员及时间/);
  assert.match(page, /formatDateTime\(comment\.createdAt\)/);
  assert.match(page, /<UserProfileAvatar userId=\{comment\.userId\}/);
  assert.match(page, /comment\.userId === user\?\.id/);
  assert.match(page, /mt-0\.5 text-\[11px\] tabular-nums/);
});

test('task detail switches within the page instead of covering the global header with a modal', () => {
  assert.match(page, /title=\{isMobileViewport \? '协作' : isMessages \? '消息' : '任务'\}/);
  assert.doesNotMatch(page, /返回任务中心/);
  assert.match(page, /关闭任务详情/);
  assert.match(page, /\{selectedTask\.title\}/);
  assert.match(page, /selectedTask && !editingTask && <div className=\{`min-h-0 flex-1 flex-col overflow-hidden bg-white/);
  assert.match(page, /lg:grid-cols-\[minmax\(320px,1fr\)_minmax\(0,2fr\)\]/);
  assert.doesNotMatch(page, /<AppModal[\s\S]*?open=\{Boolean\(selectedTask\)\}/);
});

test('task information can be edited only by the owner, creator or collaborators', () => {
  assert.match(route, /function canEditTask\(userId, task\)/);
  assert.match(route, /if \(!canEditTask\(req\.user\.id, old\)\) return res\.status\(403\)/);
  assert.match(page, /const canEditSelectedTask = Boolean/);
  assert.match(page, /selectedTask\.createdById === user\.id/);
  assert.match(page, /selectedTask\.assignedToId === user\.id/);
  assert.match(page, /selectedTask\.recipientIds\?\.includes\(user\.id\)/);
  assert.match(page, /selectedTask && editingTask && <div className=\{`flex min-h-0 flex-1 flex-col overflow-hidden/);
  assert.match(page, /id="edit-task-form" onSubmit=\{saveTaskEdits\}/);
  assert.match(page, /编辑任务信息/);
});

test('new reminders and tasks use the shared centered modal', () => {
  assert.match(page, /<AppModal[\s\S]*?open=\{creating\}/);
  assert.match(page, /title=\{`新建\$\{itemLabel\}`\}/);
  assert.match(page, /form="create-task-form"/);
  assert.match(page, /form="create-task-form"/);
});

test('reminder creation uses a focused notification form with optional components', () => {
  assert.match(page, /提醒标题/);
  assert.match(page, /提醒内容/);
  assert.match(page, /要通知的人/);
  assert.match(page, /组件（选填）/);
  assert.match(page, /截止时间（选填）/);
  assert.match(page, /\{ value: 'poll', label: '投票' \}/);
  assert.match(page, /reminderComponent:/);
  assert.match(page, /请至少选择一位通知人员/);
});

test('messages and tasks are separated by persisted item type while legacy records migrate to tasks', () => {
  assert.match(route, /const validItemTypes = new Set\(\['task', 'reminder'\]\)/);
  assert.match(route, /itemType: validItemTypes\.has\(task\.itemType\) \? task\.itemType : 'task'/);
  assert.match(route, /tasks\.filter\(task => task\.itemType === requestedType\)/);
  assert.match(page, /query\.set\('type', isMessages \? 'reminder' : 'task'\)/);
  assert.match(page, /itemType: isMessages \? 'reminder' : 'task'/);
});

test('task editing uses the same page content workflow instead of a modal', () => {
  assert.doesNotMatch(page, /open=\{editingTask && Boolean\(selectedTask\)\}/);
  assert.match(page, /selectedTask && editingTask && <div className=\{`flex min-h-0 flex-1 flex-col overflow-hidden bg-white/);
  assert.match(page, /selectedTask && !editingTask && <div className=\{`min-h-0 flex-1 flex-col overflow-hidden bg-white/);
  assert.match(page, /api\.put<\{ task: TaskItem \}>\(`\/tasks\/\$\{selectedTask\.id\}`/);
});

test('task center uses the shared dropdown component everywhere', () => {
  assert.doesNotMatch(page, /<select\b/);
  assert.match(page, /function TaskFormSelect/);
  assert.match(page, /<AppSelect value=\{scope\}/);
  assert.match(page, /<TaskFormSelect name="componentType"/);
  assert.match(page, /function TaskStatusSelect[\s\S]*<AppSelect/);
});

test('task detail metadata controls stay on one row and its scrollbar takes no space', () => {
  assert.match(page, /className="flex flex-nowrap items-center gap-1\.5"/);
  assert.match(page, /task-detail-scrollbar-hidden/);
  assert.match(page, /compact \? 'min-w-0 flex-1' : topic \? 'w-\[92px\]' : 'w-28'/);
  assert.match(page, /topic \? `task-topic-status-trigger !h-7 !min-h-7 !border-0/);
});

test('tasks without a due date are displayed as none', () => {
  assert.match(page, /task\.dueAt \|\| '无'/);
  assert.match(page, /selectedTask\.dueAt \|\| '无'/);
});

test('task comment input can be resized upward from its top-right handle', () => {
  assert.match(page, /const \[commentInputHeight, setCommentInputHeight\] = useState<number \| null>\(null\)/);
  assert.match(page, /startHeight \+ startY - moveEvent\.clientY/);
  assert.match(page, /Math\.min\(320, Math\.max\(40/);
  assert.match(page, /aria-label="拖拽调整留言输入框高度"/);
  assert.match(page, /absolute right-1\.5 top-1/);
});

test('completed task titles remain readable without a strikethrough', () => {
  assert.doesNotMatch(page, /text-slate-500 line-through/);
  assert.match(page, /done \? 'text-slate-600' : 'text-slate-900 group-hover:text-primary-700'/);
});

test('task detail begins with assignee information and keeps priority out of the header controls', () => {
  assert.doesNotMatch(page, /h-9 w-16 shrink-0 items-center justify-center/);
  const assigneeIndex = page.indexOf("['负责人', selectedTask.assignedToName");
  assert.ok(assigneeIndex >= 0);
});

test('task mode presents tasks as forum topics without changing message mode', () => {
  assert.match(page, /主题回复/);
  assert.doesNotMatch(page, /主题讨论/);
  assert.match(page, /#\{index \+ 1\}/);
  assert.match(page, /回复这个主题…/);
  assert.match(page, /isMessages \? '任务动态' : '主题互动'/);
  assert.match(page, /\{isMessages && <section className="mt-5 border-t border-slate-200">/);
  assert.match(page, /text-\[15px\] leading-7/);
  assert.match(page, /lg:grid-cols-\[minmax\(320px,1fr\)_minmax\(0,2fr\)\]/);
  assert.match(page, /grid-cols-\[40px_minmax\(0,1fr\)\]/);
  assert.match(page, /flex min-h-10 flex-col justify-between/);
  assert.match(page, /task-list-title truncate whitespace-nowrap/);
  assert.match(page, /task-list-meta flex min-w-0 flex-nowrap/);
  assert.match(page, /whitespace-pre-wrap break-words text-sm leading-6/);
  assert.match(page, /whitespace-normal break-words/);
  assert.match(page, /xl:grid-cols-\[1fr_1fr_1fr_1fr_1\.3fr\]/);
});

test('task topic list gives the first card the same spacing as card gaps', () => {
  assert.match(page, /isMessages \? 'pt-3' : 'pt-1\.5'/);
  assert.match(page, /isMessages \? 'space-y-1\.5' : 'space-y-0'/);
});

test('task due dates become overdue only after 23:59 Shanghai time', () => {
  assert.match(page, /T23:59:59\.999\+08:00/);
  assert.match(page, /taskDueEndTime\(task\.dueAt\) < Date\.now\(\)/);
});

test('task topic cards show creator without a combined assignee label', () => {
  assert.doesNotMatch(page, />负责人 \/ 创建人</);
  assert.match(page, />创建人<\/dt><dd[^>]*>\{task\.createdByName \|\| '—'\}/);
});

test('task replies support member mentions with validated targeted notifications', () => {
  assert.match(db, /mention_data TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(route, /requestedMentionIds = normalizeRecipientIds\(req\.body\?\.mentionIds\)/);
  assert.match(route, /filter\(person => content\.includes\(`@\$\{person\.name\}`\)\)/);
  assert.match(route, /createTaskMentionNotification\(db, task, actor, comment, comment\.mentionIds\)/);
  assert.match(notifications, /type: 'task_mention'/);
  assert.match(notifications, /commentId=\$\{encodeURIComponent\(comment\.id\)\}/);
  assert.match(notifications, /excludeRecipientIds/);
  assert.match(messages, /task_mention: '回复中提及你'/);
});

test('task reply composer opens an accessible mention picker and deep-links to the reply', () => {
  assert.match(page, /updateMentionState\(value, caret\)/);
  assert.match(page, /role="listbox" aria-label="选择要提及的成员"/);
  assert.match(page, /mentionCandidates\[mentionActiveIndex\]/);
  assert.match(page, /输入 @ 提及成员/);
  assert.match(page, /mentionIds: commentMentionIds/);
  assert.match(page, /id=\{`task-comment-\$\{comment\.id\}`\}/);
  assert.match(page, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
  assert.match(page, /renderCommentContent\(comment\.content, comment\.mentionNames\)/);
});

test('message selection follows the active theme without a colored side rail', () => {
  assert.match(messages, /selected\?\.id === item\.id \? 'app-selected-border task-directory-item-active' : ''/);
  assert.doesNotMatch(messages, /shadow-\[inset_3px_0_0_/);
  assert.doesNotMatch(messages, /#2454d7/);
  assert.match(messages, /border-primary-100 bg-primary-50 text-primary-700/);
});
