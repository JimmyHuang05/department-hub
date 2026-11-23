const bcrypt = require('bcryptjs');

const PUBLIC_DEMO_ID = 'gco-demo';
const PUBLIC_DEMO_NAME = '演示访客';
let credentials = null;

function initializePublicDemo(db) {
  const password = process.env.IBD_PUBLIC_DEMO_PASSWORD;
  if (!password) return;
  if (!db.exec("SELECT 1 FROM settings WHERE id='demo-dataset'").length) {
    throw new Error('Public demo sign-in requires a synthetic dataset');
  }
  const user = db.exec('SELECT password,display_name,role,business_role FROM users WHERE id=?', [PUBLIC_DEMO_ID])[0]?.values[0];
  if (user && (user[1] !== PUBLIC_DEMO_NAME || user[2] !== 'user' || user[3] !== 'trust_manager')) {
    throw new Error('The public demo account is reserved for read-only access');
  }
  const timestamp = new Date().toISOString();
  if (!user) {
    db.run(`INSERT INTO users (id,display_name,password,role,business_role,status,birthday,created_at)
      VALUES (?,?,?,'user','trust_manager','active','1990-06-15',?)`, [
      PUBLIC_DEMO_ID, PUBLIC_DEMO_NAME, bcrypt.hashSync(password, 10), timestamp,
    ]);
  } else if (!bcrypt.compareSync(password, user[0])) {
    db.run('UPDATE users SET password=? WHERE id=?', [bcrypt.hashSync(password, 10), PUBLIC_DEMO_ID]);
  }
  db.run('INSERT OR IGNORE INTO user_preferences (user_id,ui_state,updated_at) VALUES (?,?,?)', [
    PUBLIC_DEMO_ID, JSON.stringify({ worklogOnlyMine: false, projectOnlyMine: false }), timestamp,
  ]);
  credentials = { identifier: PUBLIC_DEMO_ID, password };
}

function getPublicDemoCredentials() {
  return credentials;
}

function publicDemoAllowsRequest(req) {
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '').toLowerCase();
  if (path === '/api/api-keys/mine') return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  return req.method === 'POST' && ['/api/auth/logout', '/api/weekly-reports/preview'].includes(path);
}

module.exports = { PUBLIC_DEMO_ID, initializePublicDemo, getPublicDemoCredentials, publicDemoAllowsRequest };
