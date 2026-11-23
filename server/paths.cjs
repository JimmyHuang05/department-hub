const path = require('path');

const APP_ROOT = path.join(__dirname, '..');

function resolveFromEnv(name, fallback) {
  const value = process.env[name];
  return value ? path.resolve(value) : fallback;
}

const DATA_ROOT = resolveFromEnv('IBD_DATA_DIR', path.join(APP_ROOT, 'data'));
const DATA_ASSETS_DIR = resolveFromEnv('IBD_ASSETS_DIR', path.join(DATA_ROOT, 'assets'));
const DB_PATH = resolveFromEnv('IBD_DB_PATH', path.join(DATA_ROOT, 'data.db'));
const AVATAR_DIR = resolveFromEnv('IBD_AVATAR_DIR', path.join(DATA_ROOT, 'avatars'));
const CLOUD_DIR = resolveFromEnv('IBD_UPLOAD_DIR', path.join(DATA_ASSETS_DIR, 'cloud-drive'));
const CLOUD_PREVIEW_DIR = resolveFromEnv('IBD_PREVIEW_DIR', path.join(CLOUD_DIR, '.previews'));
const SHEET_EDITOR_ROOT = resolveFromEnv('IBD_SHEET_EDITOR_DIR', path.join(DATA_ASSETS_DIR, 'sheet-editor'));
const SHEET_EDITOR_DB_PATH = resolveFromEnv('IBD_SHEET_EDITOR_DB_PATH', path.join(DATA_ROOT, 'sheet-editor.db'));
const TOOLS_ROOT_DIR = resolveFromEnv('IBD_TOOLS_DIR', path.join(DATA_ASSETS_DIR, 'tools'));
const HTML_TOOLS_DIR = TOOLS_ROOT_DIR;
const SKILLS_DIR = resolveFromEnv('IBD_SKILLS_DIR', path.join(DATA_ASSETS_DIR, 'skills'));
const WEEKLY_REPORT_DIR = resolveFromEnv('IBD_WEEKLY_REPORT_DIR', path.join(DATA_ASSETS_DIR, 'weekly-reports'));
const TASK_ATTACHMENTS_DIR = resolveFromEnv('IBD_TASK_ATTACHMENTS_DIR', path.join(DATA_ASSETS_DIR, 'task-attachments'));
const REPORT_SAVE_PATH = resolveFromEnv('IBD_REPORT_SAVE_PATH', path.join(DATA_ROOT, 'report_save.json'));
const REPORT_SOURCE_PATH = resolveFromEnv('IBD_REPORT_SOURCE_PATH', path.join(APP_ROOT, 'temp_check.xlsx'));
const THEME_CARDS_PATH = resolveFromEnv('IBD_THEME_CARDS_PATH', path.join(DATA_ROOT, 'theme_cards.json'));

module.exports = {
  APP_ROOT,
  DATA_ROOT,
  DATA_ASSETS_DIR,
  DB_PATH,
  AVATAR_DIR,
  CLOUD_DIR,
  CLOUD_PREVIEW_DIR,
  SHEET_EDITOR_ROOT,
  SHEET_EDITOR_DB_PATH,
  TOOLS_ROOT_DIR,
  HTML_TOOLS_DIR,
  SKILLS_DIR,
  WEEKLY_REPORT_DIR,
  TASK_ATTACHMENTS_DIR,
  REPORT_SAVE_PATH,
  REPORT_SOURCE_PATH,
  THEME_CARDS_PATH,
};
