const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('sidebar expansion is a persisted per-user preference and defaults open', () => {
  const store = read('src/store/uiPreferenceStore.ts');
  const sidebar = read('src/components/Layout/Sidebar.tsx');
  const profile = read('src/pages/Profile.tsx');
  const server = read('server/routes/preferences.cjs');

  assert.match(store, /sidebarExpanded: boolean/);
  assert.match(store, /sidebarExpanded: true/);
  assert.match(store, /typeof value\?\.sidebarExpanded === 'boolean'/);
  assert.match(server, /sidebarExpanded: true/);
  assert.match(server, /typeof source\.sidebarExpanded === 'boolean'/);
  assert.match(sidebar, /useState\(true\)/);
  assert.match(sidebar, /preferredSidebarExpanded/);
  assert.match(sidebar, /updateUiPreferences\(\{ sidebarExpanded: false \}/);
  assert.match(sidebar, /updateUiPreferences\(\{ sidebarExpanded: true \}/);
  assert.match(profile, /updateBooleanPreference\('sidebarExpanded'/);
  assert.match(profile, /默认展开侧栏/);
});
