const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const questionnaire = fs.readFileSync(path.join(root, 'src/pages/QuestionnairesCenter.tsx'), 'utf8');
const skills = fs.readFileSync(path.join(root, 'src/pages/SkillsCenter.tsx'), 'utf8');

test('questionnaire adopts the existing skill toolbar height without changing the skill toolbar', () => {
  const existingSkillToolbar = /<div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-4">/;

  assert.match(skills, existingSkillToolbar);
  assert.match(questionnaire, existingSkillToolbar);
  assert.doesNotMatch(skills, /app-content-toolbar flex shrink-0 flex-wrap items-center gap-2 px-5 py-4/);
  assert.doesNotMatch(questionnaire, /app-content-toolbar flex shrink-0 flex-wrap items-center gap-2 px-5 py-4/);
});

test('new questionnaire button matches the existing upload skill button width contract', () => {
  const sharedButtonClasses = 'hidden h-10 items-center justify-center gap-2 bg-slate-950 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 lg:inline-flex';

  assert.match(skills, new RegExp(`className="${sharedButtonClasses}"[\\s\\S]*?<Upload size=\\{17\\} \\/>上传技能`));
  assert.match(questionnaire, new RegExp(`className="${sharedButtonClasses}"[\\s\\S]*?<Plus size=\\{17\\} \\/>新建问卷`));
});
