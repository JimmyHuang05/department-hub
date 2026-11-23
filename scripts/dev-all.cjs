const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const children = [];

function start(label, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[preview] ${label} exited (${signal || code || 0})`);
    shutdown(code || 1);
  });
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach(child => {
    if (!child.killed) child.kill();
  });
  setTimeout(() => process.exit(code), 120).unref();
}

start('backend', ['server/index.cjs']);
start('frontend', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
