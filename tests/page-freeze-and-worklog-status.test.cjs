const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('authenticated pages stay mounted with frozen route locations', () => {
 const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
 const guard = fs.readFileSync(path.join(root, 'src/components/Layout/ProtectedRoute.tsx'), 'utf8');
 assert.match(app, /function CachedAuthenticatedPages/);
 assert.match(app, /frozenLocations/);
 assert.match(app, /<Routes location=\{frozenLocation\}>/);
 assert.match(app, /hidden=\{!active\}/);
 assert.match(app, /scrollPositions/);
 assert.doesNotMatch(guard, /key=\{location\.pathname\}/);
});

test('worklog status uses configured dropdowns in detail and sheet modes', () => {
 const page = fs.readFileSync(path.join(root, 'src/pages/WorkLogList.tsx'), 'utf8');
 const sheet = fs.readFileSync(path.join(root, 'src/components/WorkLogExcelView.tsx'), 'utf8');
 assert.match(page, /workLogStatusOptions/);
 assert.match(page, /<InlineDetailSelect fieldKey="status"/);
 assert.doesNotMatch(page, /<EditableDetailField fieldKey="status"/);
 assert.match(sheet, /key: 'status'.*type: 'select'/);
 assert.match(sheet, /statusOptions=\{statusOptions\}/);
});
