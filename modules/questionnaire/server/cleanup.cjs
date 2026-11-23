// 问卷附件孤儿文件清理服务
const fs = require('fs');
const path = require('path');
const { getDbSync, saveDbImmediate } = require('../../../server/db.cjs');
const { QUESTIONNAIRE_UPLOAD_DIR } = require('./runtimePaths.cjs');

// 孤儿文件保留时间（小时）：提交后 24 小时内即使无引用也保留，防止并发写入期间误删
const ORPHAN_RETENTION_HOURS = 24;
// 草稿保留天数：超过该天数的服务端草稿自动清理
const DRAFT_RETENTION_DAYS = 30;

function listAttachments(db) {
  const result = db.exec('SELECT stored_name FROM questionnaire_attachments');
  const names = new Set();
  for (const row of result[0]?.values || []) names.add(String(row[0] || ''));
  return names;
}

async function cleanupOrphanQuestionnaireAttachments() {
  const db = getDbSync();
  const dir = QUESTIONNAIRE_UPLOAD_DIR;
  if (!dir || !fs.existsSync(dir)) {
    return { skipped: true, deletedFiles: 0, deletedDrafts: 0, message: '问卷上传目录不存在' };
  }

  const referenced = listAttachments(db);
  const now = Date.now();
  let deletedFiles = 0;
  const files = fs.readdirSync(dir);

  for (const name of files) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { continue; }
    if (!stat.isFile()) continue;
    // 有引用的文件跳过
    if (referenced.has(name)) continue;
    // 保留 24 小时内产生的文件（可能尚未落库或并发写入）
    if (now - stat.mtimeMs < ORPHAN_RETENTION_HOURS * 3600 * 1000) continue;
    try { fs.unlinkSync(full); deletedFiles += 1; } catch (_) { /* 单个失败忽略 */ }
  }

  // 清理超期草稿
  let deletedDrafts = 0;
  try {
    const cutoff = new Date(Date.now() - DRAFT_RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    const result = db.exec('SELECT questionnaire_id, client_key FROM questionnaire_drafts WHERE updated_at < ?', [cutoff]);
    const staleDrafts = result[0]?.values || [];
    for (const row of staleDrafts) {
      db.run('DELETE FROM questionnaire_drafts WHERE questionnaire_id=? AND client_key=?', [row[0], row[1]]);
      deletedDrafts += 1;
    }
    if (deletedDrafts > 0) saveDbImmediate();
  } catch (_) { /* 草稿表不存在时忽略 */ }

  return {
    skipped: false,
    deletedFiles,
    deletedDrafts,
    orphanRetentionHours: ORPHAN_RETENTION_HOURS,
    message: `已清理 ${deletedFiles} 个孤儿附件文件${deletedDrafts ? `，${deletedDrafts} 条过期草稿` : ''}`,
  };
}

module.exports = { cleanupOrphanQuestionnaireAttachments, listAttachments };
