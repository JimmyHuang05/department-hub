const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { DATA_ROOT, DB_PATH } = require('./paths.cjs');
const {
  INITIAL_ADMIN_PASSWORD_PATH,
  removeInitialAdminPasswordFile,
  resolveInitialAdminPassword,
} = require('./services/securityConfig.cjs');

// 统一数据库路径：项目根目录/data/data.db
const DATA_DIR = DATA_ROOT;

let db = null;

// 防抖保存：2 秒内的多次写操作合并为一次磁盘写入
let saveTimer = null;
let firstPendingSaveAt = 0;
const SAVE_DEBOUNCE_MS = 2000;
const SAVE_MAX_WAIT_MS = 10000;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // 确保 data 目录存在
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    business_role TEXT DEFAULT 'intern',
    status TEXT DEFAULT 'active',
    email TEXT DEFAULT '',
    birthday TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )`);

  // 兼容旧数据库：添加 status 列（如果不存在）
  try {
    db.run("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
  } catch (e) { /* 列已存在，忽略 */ }

  try {
    db.run("ALTER TABLE users ADD COLUMN business_role TEXT DEFAULT 'intern'");
  } catch (e) { /* ignore existing column */ }

  try {
    db.run("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
  } catch (e) { /* ignore existing column */ }

  try {
    db.run("ALTER TABLE users ADD COLUMN birthday TEXT DEFAULT ''");
  } catch (e) { /* ignore existing column */ }

  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    week_key TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS entry_snapshots (
    id TEXT PRIMARY KEY,
    week_key TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_by TEXT NOT NULL,
    snapshot_at TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS weekly_report_runs (
    id TEXT PRIMARY KEY,
    week_key TEXT NOT NULL,
    template_version TEXT NOT NULL,
    source_payload TEXT NOT NULL,
    manual_notes TEXT NOT NULL,
    validation_result TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_name TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    generated_by_name TEXT DEFAULT '',
    generated_at TEXT NOT NULL,
    FOREIGN KEY (generated_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS weekly_report_drafts (
    week_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    manual_notes TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (week_key, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_by TEXT NOT NULL,
    assigned_to TEXT DEFAULT '',
    project_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    due_at TEXT,
    updated_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS task_recipients (
    task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, user_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    mention_data TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    deleted_by TEXT DEFAULT '',
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  try {
    db.run("ALTER TABLE task_comments ADD COLUMN mention_data TEXT NOT NULL DEFAULT '[]'");
  } catch (e) { /* ignore existing column */ }

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'manual',
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL DEFAULT '',
    component_type TEXT NOT NULL DEFAULT 'none',
    component_data TEXT NOT NULL DEFAULT '{}',
    action_url TEXT NOT NULL DEFAULT '',
    expires_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notification_recipients (
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    read_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (notification_id, user_id),
    FOREIGN KEY (notification_id) REFERENCES notifications(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notification_votes (
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    voted_at TEXT NOT NULL,
    PRIMARY KEY (notification_id, user_id),
    FOREIGN KEY (notification_id) REFERENCES notifications(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notification_archives (
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    PRIMARY KEY (notification_id, user_id),
    FOREIGN KEY (notification_id) REFERENCES notifications(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    theme TEXT,
    ui_state TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // 兼容旧数据库：用户级界面偏好（如“只看我的”）
  try {
    db.run("ALTER TABLE user_preferences ADD COLUMN ui_state TEXT");
  } catch (e) {
    // 列已存在，忽略
  }

  db.run(`CREATE TABLE IF NOT EXISTS todo_snoozes (
    user_id TEXT NOT NULL,
    week_key TEXT NOT NULL,
    item_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, week_key, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS manager_todo_snapshots (
    week_key TEXT NOT NULL,
    manager_name TEXT NOT NULL,
    item_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (week_key, manager_name, item_id)
  )`);

  // 兼容旧数据库：添加 week_key 列（如果不存在）
  try {
    db.run("ALTER TABLE entries ADD COLUMN week_key TEXT");
  } catch (e) {
    // 列已存在，忽略
  }

  // 编辑历史表
  db.run(`CREATE TABLE IF NOT EXISTS edit_history (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    edited_by TEXT NOT NULL,
    edited_at TEXT NOT NULL
  )`);

  // 表格事务历史：保存整批字段修改，支持刷新后的撤销/重做。
  db.run(`CREATE TABLE IF NOT EXISTS product_transactions (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    changes TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied',
    updated_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS product_cell_formats (
    product_id TEXT NOT NULL,
    field TEXT NOT NULL,
    format TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(product_id, field)
  )`);

  // Token 黑名单表（用于多设备登出控制）
  try {
    db.run(`CREATE TABLE IF NOT EXISTS token_blacklist (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
  } catch (e) { /* 忽略 */ }

  // 登录会话表：限制同账号同类型设备只能保留一个活跃会话
  try {
    db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_type TEXT NOT NULL,
      device_name TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      revoked_reason TEXT,
      replaced_by_session_id TEXT
    )`);
  } catch (e) { /* 忽略 */ }

  // 审计日志表
  try {
    db.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT DEFAULT '',
      action TEXT NOT NULL,
      target_type TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      snapshot_json TEXT DEFAULT '',
      undone_at TEXT DEFAULT '',
      undone_by TEXT DEFAULT ''
    )`);
  } catch (e) { /* 忽略 */ }

  // 云盘文件表
  try {
    try { db.run("ALTER TABLE audit_log ADD COLUMN snapshot_json TEXT DEFAULT ''"); } catch (e) { /* exists */ }
    try { db.run("ALTER TABLE audit_log ADD COLUMN undone_at TEXT DEFAULT ''"); } catch (e) { /* exists */ }
    try { db.run("ALTER TABLE audit_log ADD COLUMN undone_by TEXT DEFAULT ''"); } catch (e) { /* exists */ }
    db.run(`CREATE TABLE IF NOT EXISTS clouddrive_files (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    )`);
  } catch (e) { /* 忽略 */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS file_share_links (
      token_hash TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      version_id TEXT DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
  } catch (e) { /* ignore */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      job_key TEXT UNIQUE NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      schedule_json TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      next_run_at TEXT,
      last_run_at TEXT,
      last_status TEXT DEFAULT 'never',
      last_error TEXT DEFAULT '',
      running INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT DEFAULT '',
      updated_at TEXT NOT NULL
    )`);
  } catch (e) { /* ignore */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      id TEXT PRIMARY KEY,
      job_key TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      scheduled_at TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT DEFAULT '',
      triggered_by TEXT DEFAULT ''
    )`);
  } catch (e) { /* ignore */ }

  // 工具中心：工具与 Skill 主记录
  try {
    db.run(`CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      encrypted_key TEXT DEFAULT '',
      scopes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
  } catch (e) { /* ignore */ }

  try {
    db.run("ALTER TABLE api_keys ADD COLUMN encrypted_key TEXT DEFAULT ''");
  } catch (e) { /* ignore */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS api_access_logs (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      query TEXT,
      status_code INTEGER,
      result_count INTEGER,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    )`);
  } catch (e) { /* ignore */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS agent_changes (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      api_key_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT DEFAULT '',
      target_revision TEXT DEFAULT '',
      payload_json TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      confirmation_token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'prepared',
      expires_at TEXT NOT NULL,
      prepared_at TEXT NOT NULL,
      committed_at TEXT,
      result_json TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT ''
    )`);
  } catch (e) { /* ignore */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS agent_uploads (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT DEFAULT '',
      checksum TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'staged',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    )`);
  } catch (e) { /* ignore */ }

  try {
    db.run(`CREATE TABLE IF NOT EXISTS tool_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      visibility TEXT NOT NULL DEFAULT 'internal',
      current_version_id TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      view_count INTEGER DEFAULT 0
    )`);
  } catch (e) { /* 忽略 */ }

  // 工具中心：每次上传保留为一个版本
  try {
    db.run(`CREATE TABLE IF NOT EXISTS tool_versions (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      version_label TEXT DEFAULT '',
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      checksum TEXT DEFAULT '',
      changelog TEXT DEFAULT '',
      uploaded_by TEXT NOT NULL,
      uploaded_by_name TEXT DEFAULT '',
      uploaded_at TEXT NOT NULL
    )`);
  } catch (e) { /* 忽略 */ }

  // 添加索引提升查询性能
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_products_created_by ON products(created_by)',
    'CREATE INDEX IF NOT EXISTS idx_entries_updated_at ON entries(updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_entries_created_by ON entries(created_by)',
    'CREATE INDEX IF NOT EXISTS idx_entries_week_key ON entries(week_key)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assigned_to, status)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)',
    'CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at)',
    'CREATE INDEX IF NOT EXISTS idx_task_comments_task_time ON task_comments(task_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_notification_recipients_user ON notification_recipients(user_id, archived_at, read_at, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_notification_votes_notification ON notification_votes(notification_id, option_index)',
    'CREATE INDEX IF NOT EXISTS idx_entry_snapshots_week_key ON entry_snapshots(week_key)',
    'CREATE INDEX IF NOT EXISTS idx_entry_snapshots_entry_id ON entry_snapshots(entry_id)',
    'CREATE INDEX IF NOT EXISTS idx_weekly_report_runs_week ON weekly_report_runs(week_key, generated_at)',
    'CREATE INDEX IF NOT EXISTS idx_weekly_report_runs_user ON weekly_report_runs(generated_by, generated_at)',
    'CREATE INDEX IF NOT EXISTS idx_weekly_report_drafts_user ON weekly_report_drafts(user_id, updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_history_record ON edit_history(record_id, record_type)',
    'CREATE INDEX IF NOT EXISTS idx_history_time ON edit_history(edited_at)',
    'CREATE INDEX IF NOT EXISTS idx_product_transactions_user_time ON product_transactions(created_by, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_product_cell_formats_product ON product_cell_formats(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_type ON user_sessions(user_id, device_type, status)',
    'CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_id)',
    'CREATE INDEX IF NOT EXISTS idx_todo_snoozes_user_week ON todo_snoozes(user_id, week_key)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    'CREATE INDEX IF NOT EXISTS idx_api_access_logs_user_time ON api_access_logs(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_tool_items_type ON tool_items(type)',
    'CREATE INDEX IF NOT EXISTS idx_tool_items_status ON tool_items(status)',
    'CREATE INDEX IF NOT EXISTS idx_tool_items_created_by ON tool_items(created_by)',
    'CREATE INDEX IF NOT EXISTS idx_tool_versions_item ON tool_versions(item_id, version_no)',
    'CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs(enabled, next_run_at)',
    'CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_key_time ON scheduled_job_runs(job_key, started_at)',
  ];
  for (const idx of indexes) {
    try { db.run(idx); } catch (e) { /* 兼容旧数据库 */ }
  }

  // 迁移已有数据：从 data JSON 中提取 week_key
  try {
    const legacyEntries = db.exec('SELECT id, data FROM entries WHERE week_key IS NULL OR week_key = \'\'');
    if (legacyEntries.length > 0 && legacyEntries[0].values.length > 0) {
      for (const row of legacyEntries[0].values) {
        const id = row[0];
        const data = JSON.parse(row[1]);
        if (data.weekKey) {
          db.run('UPDATE entries SET week_key = ? WHERE id = ?', [data.weekKey, id]);
        }
      }
      if (legacyEntries[0].values.length > 0) {
        console.log(`迁移完成: 已更新 ${legacyEntries[0].values.length} 条记录的 week_key`);
      }
    }
  } catch (e) {
    // 首次创建表时忽略
  }

  // 项目阶段合并：已落地统一迁移为已成立，并移除废弃的“已落地/终止”配置。
  // 迁移是幂等的，便于旧数据库、备份恢复和多次启动安全执行。
  try {
    const productRows = db.exec('SELECT id, data FROM products');
    let migratedProducts = 0;
    for (const row of productRows[0]?.values || []) {
      const product = JSON.parse(row[1]);
      if (product.status !== '已落地' && product.status !== '终止') continue;
      product.status = product.status === '已落地' ? '已成立' : '项目中止';
      db.run('UPDATE products SET data = ? WHERE id = ?', [JSON.stringify(product), row[0]]);
      migratedProducts += 1;
    }

    const settingRows = db.exec('SELECT id, data FROM settings');
    let migratedSettings = 0;
    for (const row of settingRows[0]?.values || []) {
      const setting = JSON.parse(row[1]);
      if (!Array.isArray(setting.statusConfigs)) continue;
      const established = setting.statusConfigs.find(status => status?.name === '已成立');
      const nextStatuses = setting.statusConfigs.filter(status => status?.name !== '已落地' && status?.name !== '终止');
      const removedIds = new Set(
        setting.statusConfigs
          .filter(status => status?.name === '已落地' || status?.name === '终止')
          .map(status => status.id),
      );
      const changed = nextStatuses.length !== setting.statusConfigs.length;
      if (!changed) continue;
      setting.statusConfigs = nextStatuses;
      if (Array.isArray(setting.projectNumberOccupiedStatusIds)) {
        setting.projectNumberOccupiedStatusIds = setting.projectNumberOccupiedStatusIds.filter(id => !removedIds.has(id));
      }
      db.run('UPDATE settings SET data = ? WHERE id = ?', [JSON.stringify(setting), row[0]]);
      migratedSettings += 1;
    }
    if (migratedProducts || migratedSettings) {
      console.log(`项目阶段迁移完成: ${migratedProducts} 个项目，${migratedSettings} 份设置`);
    }
  } catch (e) {
    console.error('项目阶段迁移失败:', e.message);
    throw e;
  }

  // 管理周报阶段统一为四个业务阶段；旧值按含义归并，迁移可重复执行。
  try {
    const normalizeManagementStage = value => {
      const status = String(value || '').trim();
      if (status === '推进中' || status === '已过会' || status === '运行中' || status === '终止清算') return status;
      if (/终止|中止|清算|结束|归档|历史/.test(status)) return '终止清算';
      if (/成立|落地|运行/.test(status)) return '运行中';
      if (/上会|过会/.test(status)) return '已过会';
      return '推进中';
    };
    let migratedEntries = 0;
    const entryRows = db.exec('SELECT id,data FROM entries');
    for (const row of entryRows[0]?.values || []) {
      const entry = JSON.parse(row[1]);
      const nextStatus = normalizeManagementStage(entry.status);
      if (entry.status === nextStatus) continue;
      entry.status = nextStatus;
      db.run('UPDATE entries SET data=? WHERE id=?', [JSON.stringify(entry), row[0]]);
      migratedEntries += 1;
    }
    if (migratedEntries) console.log(`管理周报阶段迁移完成: ${migratedEntries} 条记录`);

    // 旧项目没有分类字段时，从最近更新的关联周报补齐一次；已有项目值绝不覆盖。
    let backfilledProducts = 0;
    const linkedRows = db.exec('SELECT data FROM entries ORDER BY updated_at DESC');
    const filledProjectIds = new Set();
    for (const row of linkedRows[0]?.values || []) {
      const entry = JSON.parse(row[0]);
      if (!entry.projectId || filledProjectIds.has(entry.projectId)) continue;
      const productResult = db.exec('SELECT data FROM products WHERE id=?', [entry.projectId]);
      const productRaw = productResult[0]?.values?.[0]?.[0];
      if (!productRaw) continue;
      const product = JSON.parse(productRaw);
      if (product.projectCategory || product.activePassive || product.collectiveSingle) {
        filledProjectIds.add(entry.projectId);
        continue;
      }
      if (!entry.subCategory && !entry.activePassive && !entry.collectiveSingle) continue;
      product.projectCategory = String(entry.subCategory || '');
      product.activePassive = String(entry.activePassive || '');
      product.collectiveSingle = String(entry.collectiveSingle || '');
      db.run('UPDATE products SET data=? WHERE id=?', [JSON.stringify(product), entry.projectId]);
      filledProjectIds.add(entry.projectId);
      backfilledProducts += 1;
    }
    if (backfilledProducts) console.log(`项目分类回填完成: ${backfilledProducts} 个项目`);
  } catch (e) {
    console.error('管理周报阶段迁移失败:', e.message);
    throw e;
  }


  // 初始化完成
  console.log('数据库初始化完成');

  // 种子数据：如果没有 admin 用户则创建
  const adminCount = db.exec("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'");
  const activeAdminExists = Boolean(adminCount[0]?.values?.[0]?.[0]);
  const bootstrapAdmin = db.exec("SELECT password FROM users WHERE id = 'IBD-00001'");
  const bootstrapPasswordHash = bootstrapAdmin[0]?.values?.[0]?.[0] || '';
  const configuredTestPassword = String(process.env.IBD_TEST_PASSWORD || '');
  const testPasswordEnabled = process.env.NODE_ENV !== 'production' && configuredTestPassword.length >= 6;
  const configuredLocalAdminPassword = String(process.env.IBD_LOCAL_ADMIN_PASSWORD || '');
  const localAdminPasswordEnabled = process.env.NODE_ENV !== 'production' && configuredLocalAdminPassword.length >= 6;
  const usesKnownDefaultPassword = Boolean(
    !testPasswordEnabled
    && !localAdminPasswordEnabled
    && bootstrapPasswordHash
    && bcrypt.compareSync('123456', bootstrapPasswordHash)
  );
  if (!activeAdminExists || usesKnownDefaultPassword) {
    const initial = testPasswordEnabled
      ? { password: configuredTestPassword, generated: false }
      : resolveInitialAdminPassword();
    const hashed = bcrypt.hashSync(initial.password, 12);
    const now = new Date().toISOString();
    if (bootstrapPasswordHash) {
      db.run(
        "UPDATE users SET password = ?, role = 'admin', status = 'active' WHERE id = 'IBD-00001'",
        [hashed]
      );
    } else {
      db.run(
        'INSERT INTO users (id, display_name, password, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['IBD-00001', '管理员', hashed, 'admin', 'active', now]
      );
    }
    if (initial.generated) {
      console.warn(`管理员初始密码已保存至：${INITIAL_ADMIN_PASSWORD_PATH}`);
    } else {
      removeInitialAdminPasswordFile();
      console.warn('管理员密码已使用 IBD_BOOTSTRAP_ADMIN_PASSWORD 安全初始化。');
    }
  }

  // 本地开发可只固定管理员密码，不影响其他用户；生产环境始终忽略该配置。
  if (localAdminPasswordEnabled && bootstrapPasswordHash) {
    db.run(
      "UPDATE users SET password = ?, role = 'admin', status = 'active' WHERE id = 'IBD-00001'",
      [bcrypt.hashSync(configuredLocalAdminPassword, 10)]
    );
    removeInitialAdminPasswordFile();
    console.warn('本地管理员密码已使用 IBD_LOCAL_ADMIN_PASSWORD。');
  }

  // 首次启动时保存到文件
  if (testPasswordEnabled) {
    db.run('UPDATE users SET password = ?', [bcrypt.hashSync(configuredTestPassword, 10)]);
    removeInitialAdminPasswordFile();
    console.warn('测试环境账号密码已统一为 IBD_TEST_PASSWORD。');
  }

  saveDb();

  return db;
}

// 防抖保存：高频写操作延迟合并
function saveDb() {
  const now = Date.now();
  if (!firstPendingSaveAt) firstPendingSaveAt = now;
  if (saveTimer) clearTimeout(saveTimer);
  const remainingUntilForcedSave = Math.max(0, SAVE_MAX_WAIT_MS - (now - firstPendingSaveAt));
  const delay = Math.min(SAVE_DEBOUNCE_MS, remainingUntilForcedSave);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    firstPendingSaveAt = 0;
    writeDb();
  }, delay);
}

// 立即写入磁盘（用于关闭/退出/全量替换等关键操作）
function saveDbImmediate() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  firstPendingSaveAt = 0;
  writeDb();
}

function writeDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const tempPath = `${DB_PATH}.${process.pid}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tempPath, 'w', 0o600);
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, DB_PATH);
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tempPath); } catch (_) {}
    throw error;
  }
}

function closeDb() {
  if (db) {
    saveDbImmediate();
    db.close();
    db = null;
  }
}

function getDbSync() {
  return db;
}

async function validateDatabaseBuffer(buffer) {
  const SQL = await initSqlJs();
  const candidate = new SQL.Database(buffer);
  try {
    const integrity = candidate.exec('PRAGMA integrity_check');
    if (integrity[0]?.values?.[0]?.[0] !== 'ok') throw new Error('备份文件完整性检查未通过');
    const requiredTables = ['users', 'products', 'entries'];
    const tables = candidate.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const names = new Set((tables[0]?.values || []).map(row => row[0]));
    if (requiredTables.some(name => !names.has(name))) throw new Error('备份缺少必要的数据表');
    return true;
  } finally {
    candidate.close();
  }
}

async function replaceDatabaseFromBuffer(buffer) {
  await validateDatabaseBuffer(buffer);
  const SQL = await initSqlJs();
  const replacement = new SQL.Database(buffer);
  const tempPath = `${DB_PATH}.${process.pid}.restore.tmp`;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  firstPendingSaveAt = 0;
  try {
    fs.writeFileSync(tempPath, Buffer.from(replacement.export()), { mode: 0o600 });
    fs.renameSync(tempPath, DB_PATH);
    if (db) db.close();
    db = replacement;
    return true;
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    replacement.close();
    throw error;
  }
}

module.exports = { getDb, getDbSync, saveDb, saveDbImmediate, closeDb, replaceDatabaseFromBuffer, validateDatabaseBuffer };
