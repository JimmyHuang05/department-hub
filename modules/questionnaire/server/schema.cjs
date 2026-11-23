const fs = require('fs');
const { getDbSync, saveDbImmediate } = require('../../../server/db.cjs');
const { QUESTIONNAIRE_UPLOAD_DIR } = require('./runtimePaths.cjs');

let initialized = false;
function initialize() {
  if (initialized) return true;
  const db = getDbSync();
  if (!db) return false;
  fs.mkdirSync(QUESTIONNAIRE_UPLOAD_DIR, { recursive: true });
  db.run(`CREATE TABLE IF NOT EXISTS questionnaires (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',public_token TEXT UNIQUE NOT NULL,fields_json TEXT NOT NULL DEFAULT '[]',thank_you_message TEXT DEFAULT '',created_by TEXT NOT NULL,created_by_name TEXT DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS questionnaire_submissions (id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,answers_json TEXT NOT NULL,submitted_at TEXT NOT NULL,submitter_ip TEXT DEFAULT '',user_agent TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'new',updated_at TEXT,idempotency_key TEXT,FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id))`);
  const submissionColumns = new Set((db.exec('PRAGMA table_info(questionnaire_submissions)')[0]?.values || []).map(row => row[1]));
  if (!submissionColumns.has('source_user_id')) db.run("ALTER TABLE questionnaire_submissions ADD COLUMN source_user_id TEXT DEFAULT ''");
  if (!submissionColumns.has('source_user_name')) db.run("ALTER TABLE questionnaire_submissions ADD COLUMN source_user_name TEXT DEFAULT ''");
  if (!submissionColumns.has('source_note')) db.run("ALTER TABLE questionnaire_submissions ADD COLUMN source_note TEXT DEFAULT ''");
  db.run(`CREATE TABLE IF NOT EXISTS questionnaire_attachments (id TEXT PRIMARY KEY,submission_id TEXT NOT NULL,questionnaire_id TEXT NOT NULL,field_id TEXT NOT NULL,file_name TEXT NOT NULL,stored_name TEXT NOT NULL,file_size INTEGER DEFAULT 0,mime_type TEXT DEFAULT '',created_at TEXT NOT NULL,FOREIGN KEY (submission_id) REFERENCES questionnaire_submissions(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS questionnaire_idempotency (idempotency_key TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,submission_id TEXT NOT NULL,created_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS questionnaire_drafts (questionnaire_id TEXT NOT NULL,client_key TEXT NOT NULL,answers_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY (questionnaire_id,client_key))`);
  db.run(`CREATE TABLE IF NOT EXISTS questionnaire_versions (id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,version_no INTEGER NOT NULL,fields_json TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT DEFAULT '',reason TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS questionnaire_share_history (id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT DEFAULT '',note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,last_used_at TEXT NOT NULL,use_count INTEGER NOT NULL DEFAULT 1,UNIQUE(questionnaire_id,user_id,note))`);
  for (const statement of [
    'CREATE INDEX IF NOT EXISTS idx_questionnaires_status ON questionnaires(status, updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_questionnaires_token ON questionnaires(public_token)',
    'CREATE INDEX IF NOT EXISTS idx_questionnaire_submissions_questionnaire ON questionnaire_submissions(questionnaire_id, submitted_at)',
    'CREATE INDEX IF NOT EXISTS idx_q_attachments_submission ON questionnaire_attachments(submission_id)',
    'CREATE INDEX IF NOT EXISTS idx_q_versions_q ON questionnaire_versions(questionnaire_id, version_no)',
    'CREATE INDEX IF NOT EXISTS idx_q_share_history_owner ON questionnaire_share_history(questionnaire_id, user_id, last_used_at)',
  ]) db.run(statement);
  saveDbImmediate();
  initialized = true;
  return true;
}
module.exports = { initialize };
