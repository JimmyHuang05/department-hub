const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('normal worklog cards allow every available display field', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src/pages/WorkLogList.tsx'), 'utf8');
  const clientStore = fs.readFileSync(path.join(__dirname, '..', 'src/store/uiPreferenceStore.ts'), 'utf8');
  const preferencesRoute = fs.readFileSync(path.join(__dirname, '..', 'server/routes/preferences.cjs'), 'utf8');

  assert.match(page, /scope: 'normal'.*limit: WORKLOG_NORMAL_CARD_FIELD_OPTIONS\.length, unlimited: true/);
  assert.match(clientStore, /worklogNormalCardFields: normalizeWorklogCardFields\([^\n]+WORKLOG_NORMAL_CARD_FIELD_KEYS\.size/);
  assert.match(preferencesRoute, /worklogNormalCardFields: normalizeWorklogCardFields\([^\n]+WORKLOG_CARD_FIELD_KEYS\.worklogNormalCardFields\.size/);
});
