const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('worklog status is rendered as the second line below the project name', () => {
  const cards = fs.readFileSync(path.join(root, 'src/components/WorkLogCards.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

  assert.match(cards, /mobile-native-card__heading[\s\S]*<h3>[\s\S]*mobile-native-card__subtitle/);
  assert.doesNotMatch(cards, /app-status-badge mobile-worklog-status/);
  assert.match(cards, /text-\[var\(--status-color\)\]/);
  assert.match(css, /\.mobile-native-card__subtitle/);
});

test('worklog project names use one line for 3-4 columns and two lines for 5-6 columns', () => {
  const cards = fs.readFileSync(path.join(root, 'src/components/WorkLogCards.tsx'), 'utf8');
  assert.match(cards, /cardColumns >= 5 \? 'line-clamp-2' : 'truncate'/);
  assert.match(cards, /cardColumns=\{cardColumns\}/);
  assert.match(cards, /title=\{entry\.productName \|\| '未命名记录'\}/);
});
