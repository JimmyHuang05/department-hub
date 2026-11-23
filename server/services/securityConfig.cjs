const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_ROOT } = require('../paths.cjs');

const JWT_SECRET_PATH = path.join(DATA_ROOT, '.jwt-secret');
const INITIAL_ADMIN_PASSWORD_PATH = path.join(DATA_ROOT, 'initial-admin-password.txt');
const KNOWN_WEAK_SECRETS = new Set([
  'dev-default-jwt-secret-key-2024',
  'change-this-to-a-random-secret',
  'your-super-secret-key-change-me-to-a-random-string',
  'glb-worklog-secret-2026-qwertyuiop',
]);

function isStrongSecret(value) {
  const secret = String(value || '').trim();
  return secret.length >= 32 && !KNOWN_WEAK_SECRETS.has(secret);
}

function writePrivateFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

function loadJwtSecret() {
  const configured = String(process.env.JWT_SECRET || '').trim();
  if (isStrongSecret(configured)) return configured;
  if (configured) {
    console.warn('JWT_SECRET 使用了已知弱值，已忽略并改用本机随机密钥。');
  }

  try {
    const stored = fs.readFileSync(JWT_SECRET_PATH, 'utf8').trim();
    if (isStrongSecret(stored)) return stored;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generated = crypto.randomBytes(48).toString('base64url');
  writePrivateFile(JWT_SECRET_PATH, `${generated}\n`);
  console.warn(`已生成持久化 JWT 密钥：${JWT_SECRET_PATH}`);
  return generated;
}

function resolveInitialAdminPassword() {
  const configured = String(process.env.IBD_BOOTSTRAP_ADMIN_PASSWORD || '');
  if (configured) {
    if (configured.length < 12 || configured === '123456') {
      throw new Error('IBD_BOOTSTRAP_ADMIN_PASSWORD 至少需要 12 个字符，且不能使用默认密码。');
    }
    return { password: configured, generated: false };
  }

  const password = crypto.randomBytes(18).toString('base64url');
  writePrivateFile(
    INITIAL_ADMIN_PASSWORD_PATH,
    [
      '全球资本运营部内部系统首次管理员账号',
      'UID: IBD-00001',
      `初始密码: ${password}`,
      '',
      '请登录后立即修改密码。修改成功后，本文件会自动删除。',
      '',
    ].join('\n'),
  );
  return { password, generated: true };
}

function removeInitialAdminPasswordFile() {
  try { fs.unlinkSync(INITIAL_ADMIN_PASSWORD_PATH); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  INITIAL_ADMIN_PASSWORD_PATH,
  loadJwtSecret,
  removeInitialAdminPasswordFile,
  resolveInitialAdminPassword,
};
