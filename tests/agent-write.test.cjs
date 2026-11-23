const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const agentSource = fs.readFileSync(path.join(root, 'server/routes/agent.cjs'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'server/db.cjs'), 'utf8');
const skillSource = fs.readFileSync(path.join(root, 'public/skill.md'), 'utf8');

test('agent writes use the current API key and a mandatory prepare-confirm-commit flow', () => {
  assert.match(agentSource, /router\.use\(authenticateApiKey\)/);
  assert.match(agentSource, /router\.post\('\/changes\/prepare'/);
  assert.match(agentSource, /router\.post\('\/changes\/commit'/);
  assert.match(agentSource, /req\.body\?\.decision !== 'confirm'/);
  assert.match(agentSource, /confirmationToken/);
  assert.match(agentSource, /confirmation_token_hash/);
  assert.match(agentSource, /payload_hash/);
  assert.match(agentSource, /target_revision/);
  assert.doesNotMatch(agentSource, /router\.(put|patch|delete)\(/);
});

test('agent gateway supports only the approved resource actions', () => {
  for (const expected of [
    "project: ['update']",
    "worklog: ['update']",
    "clouddrive: ['upload', 'create_folder', 'trash']",
    "tool: ['create', 'publish_version', 'update_metadata']",
    "skill: ['create', 'publish_version', 'update_metadata']",
    "questionnaire: ['create', 'update']",
  ]) assert.ok(agentSource.includes(expected), expected);
  assert.doesNotMatch(agentSource, /project:\s*\[[^\]]*delete/);
  assert.doesNotMatch(agentSource, /worklog:\s*\[[^\]]*delete/);
  assert.doesNotMatch(agentSource, /permanent_delete/);
});

test('agent mutations are persisted, expiring and idempotent', () => {
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS agent_changes/);
  assert.match(dbSource, /request_id TEXT NOT NULL UNIQUE/);
  assert.match(dbSource, /CREATE TABLE IF NOT EXISTS agent_uploads/);
  assert.match(agentSource, /CHANGE_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(agentSource, /if \(change\.status === 'committed'\) return res\.json/);
});

test('published Agent instructions require a native three-option confirmation', () => {
  assert.match(skillSource, /原生选项弹窗/);
  assert.match(skillSource, /确认修改/);
  assert.match(skillSource, /返回修改/);
  assert.match(skillSource, /取消/);
  assert.match(skillSource, /禁止自动选择“确认修改”/);
});

test('server mounts the Agent gateway behind skill-version headers', () => {
  assert.match(indexSource, /app\.use\('\/api\/agent', skillVersionHeaders\)/);
  assert.match(indexSource, /app\.use\('\/api\/agent\/v1', require\('\.\/routes\/agent\.cjs'\)\)/);
});
