const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const profileSource = fs.readFileSync(
  path.resolve(__dirname, '../src/pages/Profile.tsx'),
  'utf8',
);

test('个人资料内容区不显示外层灰色边框', () => {
  assert.doesNotMatch(
    profileSource,
    /profile-workspace[^\n]*border border-slate-200/,
  );
});

test('个人资料页移除顶部编辑按钮并保留内容区编辑入口', () => {
  assert.doesNotMatch(profileSource, />编辑个人资料<\/button>/);
  assert.match(profileSource, />编辑<\/button>/);
});
