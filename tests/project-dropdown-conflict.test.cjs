const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'store', 'projectStore.ts'), 'utf8');

test('spreadsheet writes are serialized per affected project', () => {
  assert.match(source, /function enqueueProductBatch/);
  assert.match(source, /productUpdateQueues\.set\(id, queueMarker\)/);
  assert.match(source, /enqueueProductBatch\(effectiveChanges\.map\(change => change\.id\)/);
});

test('version conflicts retry only when edited fields are unchanged', () => {
  assert.match(source, /Boolean\(err\.data\?\.conflict\)/);
  assert.match(source, /const beforeValues/);
  assert.match(source, /const sameTargets = effectiveChanges\.every/);
  assert.match(source, /await save\(makePayload\(false\)\)/);
  assert.match(source, /已保留服务器上的最新内容/);
});
