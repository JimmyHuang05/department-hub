const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('remote skills expose a manifest and safe per-file reads', () => {
  const source = read('server/routes/integration.cjs');
  assert.match(source, /skills\/:id\/manifest/);
  assert.match(source, /skills\/:id\/file/);
  assert.match(source, /normalizeRemotePath/);
  assert.match(source, /MAX_REMOTE_SKILL_FILE_BYTES/);
  assert.match(source, /split\('\/'\)\.includes\('\.\.'\)/);
});

test('cloud files support bounded text chunks without downloading', () => {
  const source = read('server/routes/integration.cjs');
  assert.match(source, /files\/:id\/content/);
  assert.match(source, /maxChars/);
  assert.match(source, /MAX_CLOUD_CONTENT_CHARS/);
  assert.match(source, /hasMore/);
  assert.match(source, /extractOfficeText/);
  assert.match(source, /OFFICE_TEXT_EXTENSIONS/);
});

test('cloud content search returns snippets without bulk downloads', () => {
  const source = read('server/routes/integration.cjs');
  assert.match(source, /files\/search-content/);
  assert.match(source, /MAX_CONTENT_SEARCH_FILES/);
  assert.match(source, /MAX_CONTENT_SEARCH_CHARS_PER_FILE/);
  assert.match(source, /contentMatchSnippet/);
  assert.match(source, /searchedFiles/);
});

test('PDF extraction and OCR are bounded and local', () => {
  const source = read('server/routes/integration.cjs');
  assert.match(source, /execFileAsync\('pdftotext'/);
  assert.match(source, /execFileAsync\('pdftoppm'/);
  assert.match(source, /execFileAsync\('tesseract'/);
  assert.match(source, /MAX_PDF_PAGES = 30/);
  assert.match(source, /MAX_OCR_PAGES = 10/);
  assert.match(source, /activeOcrJobs >= 1/);
  assert.match(source, /每 30 秒最多发起一次 OCR 请求/);
  assert.match(source, /fs\.rmSync\(tempDir/);
});

test('tool summaries expose an online run URL', () => {
  const source = read('server/routes/integration.cjs');
  assert.match(source, /runUrl:/);
  assert.match(source, /tools-host/);
});

test('published Agent instructions prefer cloud usage', () => {
  const skill = read('public/skill.md');
  assert.match(skill, /云端优先使用/);
  assert.match(skill, /不得为了读取或使用内容而下载完整文件/);
  assert.match(skill, /GET \/skills\/\{id\}\/manifest/);
  assert.match(skill, /版本 ID/);
  assert.match(skill, /files\/search-content/);
  assert.match(skill, /ocr=true/);
});
