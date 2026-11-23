const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('shared downloads use hashed random tokens and remain public download routes', () => {
  const service = fs.readFileSync(path.join(root, 'server/services/fileShares.cjs'), 'utf8');
  const tools = fs.readFileSync(path.join(root, 'server/routes/tools.cjs'), 'utf8');
  const cloud = fs.readFileSync(path.join(root, 'server/routes/clouddrive.cjs'), 'utf8');

  assert.match(service, /randomBytes\(24\)/);
  assert.match(service, /createHash\('sha256'\)/);
  assert.doesNotMatch(service, /INSERT INTO file_share_links[^\n]*token[, )]/);
  assert.match(tools, /router\.post\('\/:id\/share', authMiddleware/);
  assert.match(cloud, /router\.post\('\/:id\/share', authMiddleware/);
  assert.match(tools, /router\.get\('\/shared\/:token', \(req, res\)/);
  assert.match(cloud, /router\.get\('\/shared\/:token', \(req, res\)/);
  assert.match(tools, /item\.status !== 'active'/);
  assert.match(cloud, /!candidate\.deletedAt/);
});
