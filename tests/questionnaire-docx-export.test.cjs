const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { answerText, buildQuestionnaireSubmissionDocx, safeDocxFilename } = require('../modules/questionnaire/server/docxExport.cjs');

test('single questionnaire submission exports a valid readable docx package', async () => {
  const buffer = await buildQuestionnaireSubmissionDocx({
    title: '客户需求调查问卷',
    fields: [
      { id: 'section', label: '基本信息', type: 'section_break', description: '请核对以下内容' },
      { id: 'name', label: '客户姓名', type: 'short_text', required: true },
      { id: 'needs', label: '业务需求', type: 'long_text' },
      { id: 'file', label: '相关附件', type: 'attachment' },
    ],
    answers: { name: '张三', needs: '第一行\n第二行', file: { fileName: '需求说明.pdf', fileSize: 2048 } },
    submittedAt: '2026-08-26T02:30:00.000Z', status: 'viewed', sourceUserName: '李经理', submissionId: 'response_123',
  });
  assert.ok(buffer.length > 1000);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /客户需求调查问卷/);
  assert.match(documentXml, /客户姓名/);
  assert.match(documentXml, /张三/);
  assert.match(documentXml, /需求说明\.pdf（2\.0 KB）/);
  assert.match(documentXml, /已查看/);
  assert.ok(zip.file('word/styles.xml'));
});

test('questionnaire docx export safely formats empty values and filenames', () => {
  assert.equal(answerText([]), '未填写');
  assert.equal(answerText(0), '0');
  assert.equal(safeDocxFilename('客户/需求:*问卷', '2026-08-26T00:00:00Z'), '客户_需求__问卷_答卷_2026-08-26.docx');
});
