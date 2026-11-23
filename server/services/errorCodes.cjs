const MODULE_CODES = [
  ['/api/auth', 'AUTH'], ['/api/products', 'PRJ'], ['/api/entries', 'WRK'],
  ['/api/weekly-reports', 'RPT'], ['/api/questionnaires', 'QNR'], ['/api/clouddrive', 'CLD'],
  ['/api/tools', 'TLS'], ['/api/tasks', 'TSK'], ['/api/settings', 'SET'],
  ['/api/error-events', 'EVT'],
  ['/api/backups', 'BAK'], ['/api/audit', 'AUD'], ['/api/scheduled-jobs', 'JOB'],
  ['/api/sheet-editor', 'SHT'],
];

function moduleCode(pathname = '') {
  return MODULE_CODES.find(([prefix]) => pathname.startsWith(prefix))?.[1] || 'SYS';
}

function createErrorCode(req, status = 500) {
  return `IBD-${moduleCode(req?.originalUrl || req?.path || '')}-${Number(status) || 500}`;
}

module.exports = { createErrorCode, moduleCode };
