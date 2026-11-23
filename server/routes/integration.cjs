const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { getDb } = require('../db.cjs');
const { authenticateApiKey, logApiAccess, requireApiScope } = require('../services/apiKeys.cjs');
const { integrationIdentifiers, matchesIdentifiers } = require('../services/integrationIdentifiers.cjs');
const { MAX_LIMIT, clampLimit, paginate } = require('../services/integrationPagination.cjs');
const { skillMetadata } = require('../services/skillVersion.cjs');
const { CLOUD_DIR, TOOLS_ROOT_DIR, SKILLS_DIR } = require('../paths.cjs');

const router = express.Router();
const execFileAsync = promisify(execFile);
const MAX_SKILL_CONTENT_CHARS = 300000;
const MAX_REMOTE_SKILL_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CLOUD_CONTENT_CHARS = 500000;
const MAX_CLOUD_TEXT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CONTENT_SEARCH_FILES = 100;
const MAX_CONTENT_SEARCH_CHARS_PER_FILE = 2 * 1024 * 1024;
const MAX_OFFICE_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_OFFICE_EXTRACTED_CHARS = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const MAX_OCR_PAGES = 10;
const MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx', '.yaml', '.yml', '.log']);
const OFFICE_TEXT_EXTENSIONS = new Set(['.docx', '.pptx', '.xlsx', '.xls']);
const IMAGE_OCR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);
const cloudTextCache = new Map();
const pdfTextCache = new Map();
const ocrTextCache = new Map();
const ocrRequestTimes = new Map();
let activeOcrJobs = 0;
const LEGACY_CLOUD_DIRS = [
  path.join(__dirname, '..', '..', 'data', 'uploads'),
  path.join(__dirname, '..', 'uploads'),
  path.join(__dirname, '..', '..', '.uploads'),
];
const LEGACY_HTML_TOOLS_DIR = path.join(__dirname, '..', '..', 'data', 'tools', 'html');
const LEGACY_SKILLS_DIR = path.join(__dirname, '..', '..', 'data', 'tools', 'skills');

router.use(authenticateApiKey);

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesKeyword(keyword, values) {
  if (!keyword) return true;
  return values.some(value => normalize(value).includes(keyword));
}

function parseRows(result, includeCreatedBy = false) {
  return (result[0]?.values || []).map(row => {
    const data = JSON.parse(row[0]);
    delete data.password;
    data.revision = String(data._version || data.updatedAt || row[2] || '');
    delete data._version;
    if (includeCreatedBy) data.createdBy = row[1];
    return data;
  });
}

function applyUserVisibility(db, rows, req) {
  void db;
  void req;
  return rows;
}

function projectSummary(project) {
  return {
    type: 'project',
    id: project.id,
    title: project.productName || '未命名项目',
    summary: [project.status || '未填写状态', project.trustManager || '未分配A角', project.trustManagerB || '', project.client || '未填写客户'].filter(Boolean).join(' · '),
    url: `/projects?projectId=${encodeURIComponent(project.id)}`,
    data: { ...project, identifiers: integrationIdentifiers(project) },
  };
}

function worklogSummary(entry) {
  return {
    type: 'worklog',
    id: entry.id,
    title: entry.productName || '未命名周报',
    summary: [entry.category || '管理周报', entry.status, [entry.personA, entry.personB].filter(Boolean).join(' / ')].filter(Boolean).join(' · '),
    url: `/worklog?entryId=${encodeURIComponent(entry.id)}`,
    data: { ...entry, identifiers: integrationIdentifiers(entry) },
  };
}

async function readProjects(req) {
  const db = await getDb();
  const rows = parseRows(db.exec('SELECT data,created_by FROM products ORDER BY updated_at DESC, id DESC'), true);
  return applyUserVisibility(db, rows, req);
}

async function readWorklogs(req) {
  const db = await getDb();
  const weekKey = String(req.query.weekKey || '').trim();
  let result = weekKey
    ? db.exec('SELECT data,created_by FROM entries WHERE week_key = ? ORDER BY updated_at DESC', [weekKey])
    : db.exec('SELECT data,created_by FROM entries ORDER BY updated_at DESC, id DESC');
  if (weekKey && !(result[0]?.values || []).length) {
    result = db.exec('SELECT data,created_by FROM entry_snapshots WHERE week_key = ? ORDER BY snapshot_at DESC', [weekKey]);
  }
  return applyUserVisibility(db, parseRows(result, true), req);
}

async function readQuestionnaires() {
  const db = await getDb();
  return queryAll(db, 'SELECT id,title,description,status,fields_json,thank_you_message,created_by,created_by_name,created_at,updated_at FROM questionnaires ORDER BY updated_at DESC, id DESC')
    .map(row => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      status: row.status,
      fields: safeQuestionnaireFields(row.fields_json),
      thankYouMessage: row.thank_you_message || '',
      createdBy: row.created_by,
      createdByName: row.created_by_name || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: String(row.updated_at || ''),
    }));
}

function safeQuestionnaireFields(value) {
  try { const fields = JSON.parse(value || '[]'); return Array.isArray(fields) ? fields : []; }
  catch { return []; }
}

function queryAll(db, sql, params = []) {
  const rows = [];
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return rows;
}

function safeFilePath(candidate, allowedRoots) {
  if (!candidate) return '';
  const resolved = path.resolve(candidate);
  const allowed = allowedRoots.some(root => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
  return allowed && fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : '';
}

function resolveCloudFilePath(item) {
  const storedName = path.basename(String(item?.storedName || ''));
  if (!storedName) return '';
  const roots = [CLOUD_DIR, ...LEGACY_CLOUD_DIRS];
  for (const root of roots) {
    const resolved = safeFilePath(path.join(root, storedName), [root]);
    if (resolved) return resolved;
  }
  return '';
}

function cloudFileSummary(item) {
  const extension = path.extname(item.fileName || '').toLowerCase();
  return {
    type: 'file',
    id: item.id,
    name: item.fileName || '',
    size: Number(item.fileSize) || 0,
    mimeType: item.mimeType || 'application/octet-stream',
    remark: item.remark || '',
    projectId: item.projectId || '',
    projectName: item.projectName || '',
    uploadedBy: item.uploadedBy || '',
    uploadedAt: item.uploadedAt || '',
    downloadUrl: `/api/integration/v1/files/${encodeURIComponent(item.id)}/download`,
    contentUrl: `/api/integration/v1/files/${encodeURIComponent(item.id)}/content`,
    contentMode: TEXT_EXTENSIONS.has(extension)
      ? 'text'
      : OFFICE_TEXT_EXTENSIONS.has(extension)
        ? 'extracted-text'
        : extension === '.pdf'
          ? 'pdf-text-or-ocr'
          : IMAGE_OCR_EXTENSIONS.has(extension) ? 'ocr-available' : 'preview-only',
    revision: String(item.updatedAt || item.uploadedAt || ''),
  };
}

async function readCloudFiles() {
  const db = await getDb();
  return queryAll(db, 'SELECT id,data FROM clouddrive_files')
    .map(row => {
      try {
        return { id: row.id, ...JSON.parse(row.data) };
      } catch {
        return null;
      }
    })
    .filter(item => item && !item.deletedAt && resolveCloudFilePath(item))
    .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
}

function resolveContentFilePath(item, version) {
  if (!item || !version) return '';
  const versionNo = Number(version.version_no) || 0;
  const storedName = path.basename(String(version.stored_name || version.file_name || ''));
  if (!versionNo || !storedName) return '';
  const currentRoot = item.type === 'skill' ? SKILLS_DIR : TOOLS_ROOT_DIR;
  const legacyRoot = item.type === 'skill' ? LEGACY_SKILLS_DIR : LEGACY_HTML_TOOLS_DIR;
  const allowedRoots = [currentRoot, legacyRoot];
  const candidates = [
    version.stored_path,
    path.join(currentRoot, item.id, `v${versionNo}`, storedName),
    path.join(legacyRoot, item.id, `v${versionNo}`, storedName),
  ];
  for (const candidate of candidates) {
    const resolved = safeFilePath(candidate, allowedRoots);
    if (resolved) return resolved;
  }
  return '';
}

function versionSummary(version) {
  return {
    id: version.id,
    versionNo: Number(version.version_no) || 0,
    versionLabel: version.version_label || `v${version.version_no}`,
    fileName: version.file_name || '',
    fileSize: Number(version.file_size) || 0,
    mimeType: version.mime_type || 'application/octet-stream',
    checksum: version.checksum || '',
    changelog: version.changelog || '',
    uploadedBy: version.uploaded_by_name || '',
    uploadedAt: version.uploaded_at || '',
  };
}

function selectContentVersion(item, req) {
  const requested = String(req.query.versionId || req.query.version || '').trim();
  if (!requested) return item?.versions.find(candidate => candidate.id === item.raw.current_version_id) || item?.versions[0] || null;
  return item?.versions.find(candidate =>
    candidate.id === requested ||
    String(candidate.version_no) === requested ||
    String(candidate.version_label || '') === requested
  ) || null;
}

function contentSummary(item, versions, includeVersions = false) {
  const current = versions.find(version => version.id === item.current_version_id) || versions[0] || null;
  const resource = item.type === 'skill' ? 'skills' : 'tools';
  return {
    type: item.type === 'skill' ? 'skill' : 'tool',
    id: item.id,
    name: item.name,
    description: item.description || '',
    category: item.category || '',
    updatedAt: item.updated_at || '',
    createdBy: item.created_by_name || '',
    revision: String(item.updated_at || ''),
    currentVersion: current ? versionSummary(current) : null,
    downloadUrl: `/api/integration/v1/${resource}/${encodeURIComponent(item.id)}/download`,
    contentUrl: item.type === 'skill'
      ? `/api/integration/v1/skills/${encodeURIComponent(item.id)}/content`
      : '',
    manifestUrl: item.type === 'skill'
      ? `/api/integration/v1/skills/${encodeURIComponent(item.id)}/manifest`
      : '',
    runUrl: item.type === 'html_tool' && current
      ? `/tools-host/${encodeURIComponent(item.id)}/current/index.html`
      : '',
    versions: includeVersions ? versions.map(versionSummary) : undefined,
  };
}

async function readContentItems(type, includeVersions = false) {
  const db = await getDb();
  const items = queryAll(
    db,
    'SELECT * FROM tool_items WHERE type = ? AND status = ? ORDER BY updated_at DESC',
    [type, 'active'],
  );
  return items.map(item => {
    const versions = queryAll(
      db,
      'SELECT * FROM tool_versions WHERE item_id = ? ORDER BY version_no DESC',
      [item.id],
    );
    return {
      raw: item,
      versions,
      public: contentSummary(item, versions, includeVersions),
    };
  });
}

async function readSkillMarkdown(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') {
    return fs.readFileSync(filePath, 'utf8').slice(0, MAX_SKILL_CONTENT_CHARS);
  }
  if (!['.zip', '.skill'].includes(extension)) return '';
  const archive = await JSZip.loadAsync(fs.readFileSync(filePath));
  const skillEntry = Object.values(archive.files).find(entry =>
    !entry.dir && path.posix.basename(entry.name).toLowerCase() === 'skill.md'
  );
  if (!skillEntry) return '';
  return (await skillEntry.async('string')).slice(0, MAX_SKILL_CONTENT_CHARS);
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:p>|<\/a:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractOfficeText(filePath, extension) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_CLOUD_TEXT_FILE_BYTES) throw Object.assign(new Error('在线提取的 Office 文件不能超过 25MB'), { status: 413 });
  const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  if (cloudTextCache.has(cacheKey)) return cloudTextCache.get(cacheKey);
  let text = '';
  if (extension === '.xlsx' || extension === '.xls') {
    if (extension === '.xlsx') {
      const archive = await JSZip.loadAsync(fs.readFileSync(filePath));
      const expandedBytes = Object.values(archive.files).reduce((sum, entry) => sum + Number(entry._data?.uncompressedSize || 0), 0);
      if (expandedBytes > MAX_OFFICE_EXPANDED_BYTES) throw Object.assign(new Error('Office 文件解压后的内容不能超过 50MB'), { status: 413 });
    }
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    text = workbook.SheetNames.map(sheetName => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName], { blankrows: false });
      return `# ${sheetName}\n${csv}`;
    }).join('\n\n');
  } else {
    const archive = await JSZip.loadAsync(fs.readFileSync(filePath));
    const expandedBytes = Object.values(archive.files).reduce((sum, entry) => sum + Number(entry._data?.uncompressedSize || 0), 0);
    if (expandedBytes > MAX_OFFICE_EXPANDED_BYTES) throw Object.assign(new Error('Office 文件解压后的内容不能超过 50MB'), { status: 413 });
    const entryNames = Object.keys(archive.files)
      .filter(name => extension === '.docx'
        ? /^word\/(document|header\d*|footer\d*)\.xml$/i.test(name)
        : /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const parts = [];
    for (const name of entryNames) {
      const xml = await archive.files[name].async('string');
      const extracted = decodeXmlText(xml);
      if (extracted) parts.push(extension === '.pptx' ? `# ${path.basename(name, '.xml')}\n${extracted}` : extracted);
    }
    text = parts.join('\n\n');
  }
  text = text.slice(0, MAX_OFFICE_EXTRACTED_CHARS);
  if (cloudTextCache.size >= 50) cloudTextCache.delete(cloudTextCache.keys().next().value);
  cloudTextCache.set(cacheKey, text);
  return text;
}

function fileCacheKey(filePath) {
  const stat = fs.statSync(filePath);
  return `${filePath}:${stat.size}:${stat.mtimeMs}`;
}

function joinPageTexts(pageTexts, method) {
  let offset = 0;
  const pages = [];
  const parts = pageTexts.map((rawText, index) => {
    const text = String(rawText || '').trim();
    const part = `# 第 ${index + 1} 页\n${text}`;
    const start = offset;
    offset += part.length + 2;
    pages.push({ page: index + 1, start, end: start + part.length, chars: text.length });
    return part;
  });
  return { text: parts.join('\n\n').slice(0, MAX_OFFICE_EXTRACTED_CHARS), method, pages };
}

async function extractPdfText(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_CLOUD_TEXT_FILE_BYTES) throw Object.assign(new Error('在线读取的 PDF 不能超过 25MB'), { status: 413 });
  const cacheKey = fileCacheKey(filePath);
  if (pdfTextCache.has(cacheKey)) return pdfTextCache.get(cacheKey);
  let totalPages = 0;
  try {
    const info = await execFileAsync('pdfinfo', [filePath], { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
    totalPages = Number(String(info.stdout || '').match(/^Pages:\s+(\d+)/mi)?.[1] || 0);
  } catch {}
  let stdout;
  try {
    const result = await execFileAsync('pdftotext', ['-f', '1', '-l', String(MAX_PDF_PAGES), '-layout', filePath, '-'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    stdout = result.stdout || '';
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('服务器尚未安装 PDF 文本提取组件'), { status: 503 });
    throw Object.assign(new Error('PDF 文本提取失败'), { status: 422 });
  }
  const result = joinPageTexts(String(stdout).split('\f').filter((page, index, pages) => page.trim() || index < pages.length - 1), 'pdf-text');
  result.totalPages = totalPages || result.pages.length;
  result.truncated = totalPages > MAX_PDF_PAGES;
  if (pdfTextCache.size >= 50) pdfTextCache.delete(pdfTextCache.keys().next().value);
  pdfTextCache.set(cacheKey, result);
  return result;
}

async function runCloudOcr(filePath, extension) {
  const stat = fs.statSync(filePath);
  if (stat.size > (extension === '.pdf' ? MAX_CLOUD_TEXT_FILE_BYTES : MAX_OCR_IMAGE_BYTES)) throw Object.assign(new Error('OCR 文件过大'), { status: 413 });
  const cacheKey = `${fileCacheKey(filePath)}:ocr`;
  if (ocrTextCache.has(cacheKey)) return ocrTextCache.get(cacheKey);
  if (activeOcrJobs >= 1) throw Object.assign(new Error('OCR 服务正忙，请稍后重试'), { status: 429 });
  activeOcrJobs += 1;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibd-ocr-'));
  try {
    let images = [filePath];
    if (extension === '.pdf') {
      const prefix = path.join(tempDir, 'page');
      try {
        await execFileAsync('pdftoppm', ['-f', '1', '-l', String(MAX_OCR_PAGES), '-r', '150', '-jpeg', filePath, prefix], { timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
      } catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('服务器尚未安装 PDF OCR 转换组件'), { status: 503 });
        throw Object.assign(new Error('扫描 PDF 转换失败'), { status: 422 });
      }
      images = fs.readdirSync(tempDir).filter(name => /^page-\d+\.jpg$/i.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(name => path.join(tempDir, name));
    }
    const pageTexts = [];
    for (const imagePath of images.slice(0, MAX_OCR_PAGES)) {
      try {
        const result = await execFileAsync('tesseract', [imagePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], { timeout: 90000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
        pageTexts.push(result.stdout || '');
      } catch (error) {
        if (error.code === 'ENOENT') throw Object.assign(new Error('服务器尚未安装 OCR 组件'), { status: 503 });
        throw Object.assign(new Error('OCR 识别失败'), { status: 422 });
      }
    }
    const result = joinPageTexts(pageTexts, 'ocr');
    result.totalPages = pageTexts.length;
    result.truncated = extension === '.pdf' && pageTexts.length >= MAX_OCR_PAGES;
    if (ocrTextCache.size >= 30) ocrTextCache.delete(ocrTextCache.keys().next().value);
    ocrTextCache.set(cacheKey, result);
    return result;
  } finally {
    activeOcrJobs -= 1;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function readCloudContentResult(file, filePath, options = {}) {
  const extension = path.extname(file.fileName || filePath).toLowerCase();
  if (OFFICE_TEXT_EXTENSIONS.has(extension)) return { text: await extractOfficeText(filePath, extension), method: 'office-text', pages: [] };
  if (extension === '.pdf') {
    const native = await extractPdfText(filePath);
    if (native.text.replace(/^# 第 \d+ 页/gm, '').trim()) return native;
    const cachedOcr = ocrTextCache.get(`${fileCacheKey(filePath)}:ocr`);
    if (cachedOcr) return cachedOcr;
    if (!options.allowOcr) return native;
    return runCloudOcr(filePath, extension);
  }
  if (IMAGE_OCR_EXTENSIONS.has(extension)) {
    const cachedOcr = ocrTextCache.get(`${fileCacheKey(filePath)}:ocr`);
    if (cachedOcr) return cachedOcr;
    if (!options.allowOcr) throw Object.assign(new Error('图片内容需要显式启用 OCR'), { status: 415 });
    return runCloudOcr(filePath, extension);
  }
  if (!TEXT_EXTENSIONS.has(extension)) throw Object.assign(new Error('该文件暂不支持内容检索'), { status: 415 });
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_CLOUD_TEXT_FILE_BYTES) throw Object.assign(new Error('在线读取的文本文件不能超过 25MB'), { status: 413 });
  return { text: fs.readFileSync(filePath, 'utf8'), method: 'text', pages: [] };
}

async function readCloudTextContent(file, filePath, options = {}) {
  return (await readCloudContentResult(file, filePath, options)).text;
}

function contentMatchSnippet(text, keyword, radius = 120) {
  const normalizedText = text.toLocaleLowerCase('zh-CN');
  const normalizedKeyword = keyword.toLocaleLowerCase('zh-CN');
  const index = normalizedText.indexOf(normalizedKeyword);
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + keyword.length + radius);
  return {
    start,
    end,
    snippet: `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`,
  };
}

function normalizeRemotePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return '';
  return normalized;
}

async function readSkillManifest(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md') {
    const stat = fs.statSync(filePath);
    return [{ path: 'SKILL.md', size: stat.size, kind: 'text' }];
  }
  if (!['.zip', '.skill'].includes(extension)) return [];
  const archive = await JSZip.loadAsync(fs.readFileSync(filePath));
  return Object.values(archive.files)
    .filter(entry => !entry.dir && normalizeRemotePath(entry.name))
    .slice(0, 300)
    .map(entry => ({
      path: normalizeRemotePath(entry.name),
      size: Number(entry._data?.uncompressedSize || 0),
      kind: TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? 'text' : 'binary',
    }));
}

async function readRemoteSkillFile(filePath, requestedPath) {
  const safePath = normalizeRemotePath(requestedPath);
  if (!safePath) throw Object.assign(new Error('文件路径无效'), { status: 400 });
  const extension = path.extname(filePath).toLowerCase();
  let buffer;
  if (extension === '.md') {
    if (safePath.toLowerCase() !== 'skill.md') throw Object.assign(new Error('文件不存在'), { status: 404 });
    buffer = fs.readFileSync(filePath);
  } else if (['.zip', '.skill'].includes(extension)) {
    const archive = await JSZip.loadAsync(fs.readFileSync(filePath));
    const entry = Object.values(archive.files).find(candidate => !candidate.dir && normalizeRemotePath(candidate.name) === safePath);
    if (!entry) throw Object.assign(new Error('文件不存在'), { status: 404 });
    const declaredSize = Number(entry._data?.uncompressedSize || 0);
    if (declaredSize > MAX_REMOTE_SKILL_FILE_BYTES) throw Object.assign(new Error('远程读取的单个文件不能超过 2MB'), { status: 413 });
    buffer = await entry.async('nodebuffer');
  } else {
    throw Object.assign(new Error('Skill 文件格式不支持远程读取'), { status: 415 });
  }
  if (buffer.length > MAX_REMOTE_SKILL_FILE_BYTES) throw Object.assign(new Error('远程读取的单个文件不能超过 2MB'), { status: 413 });
  const kind = TEXT_EXTENSIONS.has(path.extname(safePath).toLowerCase()) ? 'text' : 'binary';
  return kind === 'text'
    ? { path: safePath, kind, size: buffer.length, content: buffer.toString('utf8') }
    : { path: safePath, kind, size: buffer.length, encoding: 'base64', content: buffer.toString('base64') };
}

function canReadAny(req, res, next) {
  const scopes = req.apiKey?.scopes || [];
  if (scopes.some(scope => [
    'read:projects',
    'read:worklogs',
    'read:clouddrive',
    'read:tools',
    'read:skills',
    'read:questionnaires',
  ].includes(scope))) return next();
  return res.status(403).json({ error: 'API Key 权限不足' });
}

function currentUserPayload(req) {
  return {
    id: req.user.id,
    displayName: req.user.display_name,
    role: req.user.role,
    businessRole: req.user.business_role,
  };
}

function readableResources(scopes = [], includeFields = true) {
  const definitions = [
    { scope: 'read:projects', name: 'projects', description: '投资项目进度数据', fields: ['id', 'productName', 'status', 'trustManager', 'trustManagerB', 'client', 'rmb', 'usd', 'feeRate', 'establishDate', 'target', 'remarks', 'identifiers'] },
    { scope: 'read:worklogs', name: 'worklogs', description: '管理周报和每周项目进展', fields: ['id', 'category', 'productName', 'status', 'clientType', 'personA', 'personB', 'navScale', 'weeklyProgress', 'nextWeekPlan', 'weekKey', 'identifiers'] },
    { scope: 'read:clouddrive', name: 'files', description: '云盘文件、在线内容及下载地址', fields: ['id', 'name', 'size', 'mimeType', 'remark', 'projectId', 'projectName', 'uploadedBy', 'uploadedAt', 'contentUrl', 'downloadUrl'] },
    { scope: 'read:tools', name: 'tools', description: '可在线运行的 HTML 工具及版本信息', fields: ['id', 'name', 'description', 'category', 'currentVersion', 'runUrl', 'downloadUrl'] },
    { scope: 'read:skills', name: 'skills', description: '可远程使用的 Skill、文件清单及按需内容', fields: ['id', 'name', 'description', 'category', 'currentVersion', 'contentUrl', 'manifestUrl', 'downloadUrl'] },
    { scope: 'read:questionnaires', name: 'questionnaires', description: '问卷定义及状态', fields: ['id', 'title', 'description', 'status', 'fields', 'thankYouMessage', 'revision'] },
  ];
  return definitions
    .filter(resource => scopes.includes(resource.scope))
    .map(resource => includeFields
      ? { name: resource.name, description: resource.description, fields: resource.fields }
      : { name: resource.name, description: resource.description });
}

router.get('/me', (req, res) => {
  const payload = {
    user: currentUserPayload(req),
    scopes: req.apiKey.scopes,
  };
  logApiAccess(req, { resultCount: 1 });
  res.json(payload);
});

router.get('/schema', canReadAny, (req, res) => {
  const payload = {
    skill: skillMetadata(req),
    resources: readableResources(req.apiKey.scopes),
    maxLimit: MAX_LIMIT,
    pagination: { type: 'cursor', defaultLimit: 50, maxLimit: MAX_LIMIT },
  };
  logApiAccess(req, { resultCount: payload.resources.length });
  res.json(payload);
});

// Fast first-run discovery: replaces the old sequential /me + /schema round trips.
router.get('/bootstrap', canReadAny, (req, res) => {
  const payload = {
    user: currentUserPayload(req),
    scopes: req.apiKey.scopes,
    skill: skillMetadata(req),
    resources: readableResources(req.apiKey.scopes, false),
    maxLimit: MAX_LIMIT,
    pagination: { type: 'cursor', defaultLimit: 50, maxLimit: MAX_LIMIT },
    agent: {
      enabled: true,
      protocol: 'ibd-agent-change/1.0',
      capabilitiesUrl: '/api/agent/v1/capabilities',
      confirmationRequired: true,
    },
  };
  logApiAccess(req, { resultCount: payload.resources.length });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(payload);
});

router.get('/search', canReadAny, async (req, res) => {
  const keyword = normalize(req.query.q || req.query.keyword);
  const limit = clampLimit(req.query.limit, 20);
  const results = [];

  if (req.apiKey.scopes.includes('read:projects')) {
    const projects = await readProjects(req);
    results.push(...projects
      .filter(project => matchesKeyword(keyword, [
        project.productName,
        project.status,
        project.trustManager,
        project.trustManagerB,
        project.client,
        project.target,
        project.remarks,
        ...Object.values(project.dynamicFields || {}),
      ]))
      .slice(0, limit)
      .map(projectSummary));
  }

  if (req.apiKey.scopes.includes('read:worklogs')) {
    const entries = await readWorklogs(req);
    results.push(...entries
      .filter(entry => matchesKeyword(keyword, [
        entry.productName,
        entry.category,
        entry.subCategory,
        entry.status,
        entry.clientType,
        entry.description,
        entry.personA,
        entry.personB,
        entry.features,
        entry.nextWeekPlan,
        ...Object.values(entry.weeklyProgress || {}),
        ...Object.values(entry.dynamicFields || {}),
      ]))
      .slice(0, limit)
      .map(worklogSummary));
  }

  if (req.apiKey.scopes.includes('read:clouddrive')) {
    const files = await readCloudFiles();
    results.push(...files
      .filter(file => matchesKeyword(keyword, [
        file.fileName,
        file.remark,
        file.projectName,
        file.uploadedBy,
      ]))
      .slice(0, limit)
      .map(cloudFileSummary));
  }

  for (const config of [
    { scope: 'read:tools', type: 'html_tool' },
    { scope: 'read:skills', type: 'skill' },
  ]) {
    if (!req.apiKey.scopes.includes(config.scope)) continue;
    const items = await readContentItems(config.type);
    results.push(...items
      .map(item => item.public)
      .filter(item => matchesKeyword(keyword, [item.name, item.description, item.category]))
      .slice(0, limit));
  }

  const payload = { query: keyword, results: results.slice(0, limit) };
  logApiAccess(req, { resultCount: payload.results.length });
  res.json(payload);
});

router.get('/projects', requireApiScope('read:projects'), async (req, res) => {
  const keyword = normalize(req.query.keyword || req.query.q);
  const status = normalize(req.query.status);
  const manager = normalize(req.query.manager);
  const projectCode = String(req.query.projectCode || '').trim();
  const contractNo = String(req.query.contractNo || '').trim();
  const filtered = (await readProjects(req))
    .filter(project => !status || normalize(project.status).includes(status))
    .filter(project => !manager || normalize(`${project.trustManager || ''} ${project.trustManagerB || ''}`).includes(manager))
    .filter(project => matchesIdentifiers(project, { projectCode, contractNo }))
    .filter(project => {
      const identifiers = integrationIdentifiers(project);
      return matchesKeyword(keyword, [project.productName, project.client, project.target, project.remarks, identifiers.projectCode, identifiers.contractNo, identifiers.channel, ...identifiers.aliases]);
    });
  const result = paginate(filtered, {
    limit: req.query.limit,
    cursor: req.query.cursor,
    offset: req.query.offset,
    scope: JSON.stringify({ resource: 'projects', keyword, status, manager, projectCode, contractNo }),
  });
  const projects = result.items.map(projectSummary);
  logApiAccess(req, { resultCount: projects.length });
  res.json({ projects, page: result.page });
});

router.get('/projects/:id', requireApiScope('read:projects'), async (req, res) => {
  const project = (await readProjects(req)).find(item => item.id === req.params.id);
  if (!project) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '项目不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  res.json({ project });
});

router.get('/worklogs', requireApiScope('read:worklogs'), async (req, res) => {
  const keyword = normalize(req.query.keyword || req.query.q);
  const manager = normalize(req.query.manager);
  const weekKey = normalize(req.query.weekKey);
  const projectId = String(req.query.projectId || '').trim();
  const projectCode = String(req.query.projectCode || '').trim();
  const contractNo = String(req.query.contractNo || '').trim();
  const filtered = (await readWorklogs(req))
    .filter(entry => !manager || normalize(`${entry.personA} ${entry.personB}`).includes(manager))
    .filter(entry => matchesIdentifiers(entry, { projectId, projectCode, contractNo }))
    .filter(entry => {
      const identifiers = integrationIdentifiers(entry);
      return matchesKeyword(keyword, [entry.productName, entry.category, entry.status, entry.clientType, entry.features, entry.nextWeekPlan, identifiers.projectCode, identifiers.contractNo, identifiers.channel, ...identifiers.aliases]);
    });
  const result = paginate(filtered, {
    limit: req.query.limit,
    cursor: req.query.cursor,
    offset: req.query.offset,
    scope: JSON.stringify({ resource: 'worklogs', keyword, manager, weekKey, projectId, projectCode, contractNo }),
  });
  const entries = result.items.map(worklogSummary);
  logApiAccess(req, { resultCount: entries.length });
  res.json({ worklogs: entries, page: result.page });
});

router.get('/worklogs/:id', requireApiScope('read:worklogs'), async (req, res) => {
  const entry = (await readWorklogs(req)).find(item => item.id === req.params.id);
  if (!entry) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '周报不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  res.json({ worklog: entry });
});

router.get('/questionnaires', requireApiScope('read:questionnaires'), async (req, res) => {
  const keyword = normalize(req.query.keyword || req.query.q);
  const status = normalize(req.query.status);
  const filtered = (await readQuestionnaires())
    .filter(item => !status || normalize(item.status) === status)
    .filter(item => matchesKeyword(keyword, [item.title, item.description, item.createdByName]));
  const result = paginate(filtered, {
    limit: req.query.limit,
    cursor: req.query.cursor,
    offset: req.query.offset,
    scope: JSON.stringify({ resource: 'questionnaires', keyword, status }),
  });
  const questionnaires = result.items;
  logApiAccess(req, { resultCount: questionnaires.length });
  res.json({ questionnaires, page: result.page });
});

router.get('/questionnaires/:id', requireApiScope('read:questionnaires'), async (req, res) => {
  const questionnaire = (await readQuestionnaires()).find(item => item.id === req.params.id);
  if (!questionnaire) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '问卷不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  res.json({ questionnaire });
});

router.get('/files', requireApiScope('read:clouddrive'), async (req, res) => {
  const keyword = normalize(req.query.keyword || req.query.q);
  const projectId = String(req.query.projectId || '').trim();
  const limit = clampLimit(req.query.limit, 20);
  const files = (await readCloudFiles())
    .filter(file => !projectId || file.projectId === projectId)
    .filter(file => matchesKeyword(keyword, [file.fileName, file.remark, file.projectName, file.uploadedBy]))
    .slice(0, limit)
    .map(cloudFileSummary);
  logApiAccess(req, { resultCount: files.length });
  res.json({ files });
});

router.get('/files/search-content', requireApiScope('read:clouddrive'), async (req, res) => {
  const keyword = String(req.query.q || req.query.keyword || '').trim().slice(0, 100);
  if (keyword.length < 2) return res.status(400).json({ error: '搜索关键词至少需要 2 个字符' });
  const requestedLimit = Number.parseInt(String(req.query.limit || '10'), 10) || 10;
  const limit = Math.min(Math.max(requestedLimit, 1), 20);
  const candidates = (await readCloudFiles()).slice(0, MAX_CONTENT_SEARCH_FILES);
  const matches = [];
  let searchedFiles = 0;
  let skippedFiles = 0;
  for (const file of candidates) {
    const filePath = resolveCloudFilePath(file);
    if (!filePath) continue;
    try {
      const extracted = await readCloudContentResult(file, filePath, { allowOcr: false });
      const text = extracted.text.slice(0, MAX_CONTENT_SEARCH_CHARS_PER_FILE);
      searchedFiles += 1;
      const match = contentMatchSnippet(text, keyword);
      if (!match) continue;
      const matchedPage = extracted.pages.find(page => match.start >= page.start && match.start <= page.end)?.page || null;
      matches.push({
        ...cloudFileSummary(file),
        match: { ...match, page: matchedPage, method: extracted.method },
        contentUrl: `/api/integration/v1/files/${encodeURIComponent(file.id)}/content?start=${match.start}&maxChars=50000`,
      });
      if (matches.length >= limit) break;
    } catch (error) {
      if ([413, 415].includes(error.status)) skippedFiles += 1;
      else throw error;
    }
  }
  logApiAccess(req, { resultCount: matches.length });
  return res.json({ keyword, matches, searchedFiles, skippedFiles, truncated: candidates.length >= MAX_CONTENT_SEARCH_FILES });
});

router.get('/files/:id', requireApiScope('read:clouddrive'), async (req, res) => {
  const file = (await readCloudFiles()).find(item => item.id === req.params.id);
  if (!file) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '文件不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  return res.json({ file: cloudFileSummary(file) });
});

router.get('/files/:id/download', requireApiScope('read:clouddrive'), async (req, res) => {
  const file = (await readCloudFiles()).find(item => item.id === req.params.id);
  const filePath = resolveCloudFilePath(file);
  if (!file || !filePath) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '文件不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName || path.basename(filePath))}`);
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  return res.sendFile(filePath);
});

router.get('/files/:id/content', requireApiScope('read:clouddrive'), async (req, res) => {
  const file = (await readCloudFiles()).find(item => item.id === req.params.id);
  const filePath = resolveCloudFilePath(file);
  if (!file || !filePath) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '文件不存在' });
  }
  const extension = path.extname(file.fileName || filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension) && !OFFICE_TEXT_EXTENSIONS.has(extension) && extension !== '.pdf' && !IMAGE_OCR_EXTENSIONS.has(extension)) {
    logApiAccess(req, { statusCode: 415 });
    return res.status(415).json({ error: '该文件暂不支持直接读取文本，请使用在线预览', previewSupported: true });
  }
  const start = Math.max(0, Number.parseInt(String(req.query.start || '0'), 10) || 0);
  const requested = Number.parseInt(String(req.query.maxChars || '50000'), 10) || 50000;
  const maxChars = Math.min(Math.max(requested, 1), MAX_CLOUD_CONTENT_CHARS);
  const allowOcr = String(req.query.ocr || '').toLowerCase() === 'true';
  if (allowOcr) {
    const keyId = String(req.apiKey?.id || req.user?.id || 'unknown');
    const lastRun = Number(ocrRequestTimes.get(keyId) || 0);
    if (Date.now() - lastRun < 30000) return res.status(429).json({ error: '同一 API Key 每 30 秒最多发起一次 OCR 请求' });
    ocrRequestTimes.set(keyId, Date.now());
    if (ocrRequestTimes.size > 1000) {
      const cutoff = Date.now() - 60000;
      for (const [id, timestamp] of ocrRequestTimes) if (timestamp < cutoff) ocrRequestTimes.delete(id);
    }
  }
  let extracted;
  try {
    extracted = await readCloudContentResult(file, filePath, { allowOcr });
  } catch (error) {
    logApiAccess(req, { statusCode: error.status || 500 });
    return res.status(error.status || 500).json({ error: error.message || '在线内容提取失败' });
  }
  const text = extracted.text;
  const content = text.slice(start, start + maxChars);
  logApiAccess(req, { resultCount: 1 });
  return res.json({
    id: file.id,
    name: file.fileName,
    mimeType: file.mimeType || 'text/plain',
    extracted: extracted.method !== 'text',
    extractionMethod: extracted.method,
    pages: extracted.pages,
    totalPages: extracted.totalPages || null,
    truncatedPages: Boolean(extracted.truncated),
    start,
    end: start + content.length,
    totalChars: text.length,
    hasMore: start + content.length < text.length,
    content,
  });
});

async function listContent(req, res, type) {
  const keyword = normalize(req.query.keyword || req.query.q);
  const category = normalize(req.query.category);
  const limit = clampLimit(req.query.limit, 20);
  const items = (await readContentItems(type))
    .map(item => item.public)
    .filter(item => !category || normalize(item.category).includes(category))
    .filter(item => matchesKeyword(keyword, [item.name, item.description, item.category]))
    .slice(0, limit);
  logApiAccess(req, { resultCount: items.length });
  res.json({ [type === 'skill' ? 'skills' : 'tools']: items });
}

async function getContent(req, res, type) {
  const item = (await readContentItems(type, true)).find(candidate => candidate.raw.id === req.params.id);
  if (!item) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: type === 'skill' ? 'Skill 不存在' : '工具不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  return res.json({ [type === 'skill' ? 'skill' : 'tool']: item.public });
}

async function downloadContent(req, res, type) {
  const item = (await readContentItems(type, true)).find(candidate => candidate.raw.id === req.params.id);
  const version = item?.versions.find(candidate => candidate.id === item.raw.current_version_id) || item?.versions[0];
  const filePath = resolveContentFilePath(item?.raw, version);
  if (!item || !version || !filePath) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: type === 'skill' ? 'Skill 文件不存在' : '工具文件不存在' });
  }
  logApiAccess(req, { resultCount: 1 });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(version.file_name || path.basename(filePath))}`);
  res.setHeader('Content-Type', version.mime_type || 'application/octet-stream');
  return res.sendFile(filePath);
}

router.get('/tools', requireApiScope('read:tools'), (req, res) => listContent(req, res, 'html_tool'));
router.get('/tools/:id', requireApiScope('read:tools'), (req, res) => getContent(req, res, 'html_tool'));
router.get('/tools/:id/download', requireApiScope('read:tools'), (req, res) => downloadContent(req, res, 'html_tool'));

router.get('/skills', requireApiScope('read:skills'), (req, res) => listContent(req, res, 'skill'));
router.get('/skills/:id', requireApiScope('read:skills'), (req, res) => getContent(req, res, 'skill'));
router.get('/skills/:id/download', requireApiScope('read:skills'), (req, res) => downloadContent(req, res, 'skill'));
router.get('/skills/:id/content', requireApiScope('read:skills'), async (req, res) => {
  const item = (await readContentItems('skill', true)).find(candidate => candidate.raw.id === req.params.id);
  const version = item ? selectContentVersion(item, req) : null;
  const filePath = resolveContentFilePath(item?.raw, version);
  if (!item || !version || !filePath) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: 'Skill 文件不存在' });
  }
  const content = await readSkillMarkdown(filePath);
  if (!content) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: '未找到 SKILL.md' });
  }
  logApiAccess(req, { resultCount: 1 });
  return res.json({
    id: item.raw.id,
    name: item.raw.name,
    version: versionSummary(version),
    content,
  });
});

router.get('/skills/:id/manifest', requireApiScope('read:skills'), async (req, res) => {
  const item = (await readContentItems('skill', true)).find(candidate => candidate.raw.id === req.params.id);
  const version = item ? selectContentVersion(item, req) : null;
  const filePath = resolveContentFilePath(item?.raw, version);
  if (!item || !version || !filePath) {
    logApiAccess(req, { statusCode: 404 });
    return res.status(404).json({ error: 'Skill 文件不存在' });
  }
  const files = await readSkillManifest(filePath);
  logApiAccess(req, { resultCount: files.length });
  return res.json({
    id: item.raw.id,
    name: item.raw.name,
    version: versionSummary(version),
    entrypoint: files.find(file => path.posix.basename(file.path).toLowerCase() === 'skill.md')?.path || '',
    files,
    fileContentUrl: `/api/integration/v1/skills/${encodeURIComponent(item.raw.id)}/file?versionId=${encodeURIComponent(version.id)}&path={path}`,
  });
});

router.get('/skills/:id/file', requireApiScope('read:skills'), async (req, res) => {
  try {
    const item = (await readContentItems('skill', true)).find(candidate => candidate.raw.id === req.params.id);
    const version = item ? selectContentVersion(item, req) : null;
    const filePath = resolveContentFilePath(item?.raw, version);
    if (!item || !version || !filePath) {
      logApiAccess(req, { statusCode: 404 });
      return res.status(404).json({ error: 'Skill 文件不存在' });
    }
    const file = await readRemoteSkillFile(filePath, req.query.path);
    logApiAccess(req, { resultCount: 1 });
    return res.json({ id: item.raw.id, version: versionSummary(version), file });
  } catch (error) {
    logApiAccess(req, { statusCode: error.status || 500 });
    return res.status(error.status || 500).json({ error: error.message || '读取 Skill 文件失败' });
  }
});

module.exports = router;
