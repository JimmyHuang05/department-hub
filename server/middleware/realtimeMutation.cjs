const { publishDataChange, enabled, recordPublishError } = require('../services/realtimeEvents.cjs');

const RESOURCE_RULES = [
  [/^\/api\/products(?:\/|$)/, 'project'],
  [/^\/api\/(?:entries|weekly-reports)(?:\/|$)/, 'worklog'],
  [/^\/api\/tasks(?:\/|$)/, 'task'],
  [/^\/api\/notifications(?:\/|$)/, 'message'],
  [/^\/api\/questionnaires(?:\/|$)/, 'questionnaire'],
  [/^\/api\/clouddrive(?:\/|$)/, 'cloud-file'],
  [/^\/api\/tools(?:\/|$)/, 'tool'],
  [/^\/api\/(?:settings|preferences|scheduled-jobs)(?:\/|$)/, 'settings'],
  [/^\/api\/(?:auth\/(?:users|register|register-self)|users)(?:\/|$)/, 'user'],
  [/^\/api\/upload\/avatar(?:\/|$)/, 'user'],
];

const NON_MUTATING_ACTIONS = /\/(?:download|export|preview|search|query|validate|history|versions?|run-records?)(?:\/|$)/i;

function classifyMutation(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return null;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (NON_MUTATING_ACTIONS.test(path)) return null;
  const match = RESOURCE_RULES.find(([pattern]) => pattern.test(path));
  if (!match) return null;
  let resource = match[1];
  if (resource === 'questionnaire' && /\/submissions?(?:\/|$)/i.test(path)) resource = 'submission';
  if (resource === 'tool' && /\/skills?(?:\/|$)/i.test(path)) resource = 'skill';
  const action = req.method === 'POST' ? (/\/comments?(?:\/|$)/i.test(path) ? 'replied' : 'created')
    : req.method === 'DELETE' ? 'deleted' : 'updated';
  const segments = path.split('/').filter(Boolean);
  const apiIndex = segments.indexOf('api');
  const entityId = req.params?.id || segments[apiIndex + 2] || req.body?.id || '*';
  return { resource, action, entityId: String(entityId || '*') };
}

function realtimeMutationMiddleware(req, res, next) {
  if (!enabled('REALTIME_DATA_SYNC_ENABLED')) return next();
  const mutation = classifyMutation(req);
  if (!mutation) return next();
  let published = false;
  res.on('finish', () => {
    if (published || res.statusCode < 200 || res.statusCode >= 300) return;
    published = true;
    try {
      const actorId = String(req.user?.id || '');
      const privateResource = String(req.originalUrl || '').startsWith('/api/preferences');
      publishDataChange({
        ...mutation,
        actor: { id: actorId, name: req.user?.display_name || req.user?.displayName || '' },
        audience: privateResource && actorId ? { type: 'users', ids: [actorId] } : { type: 'all' },
        mutationId: req.get('X-Mutation-ID') || '',
        changedFields: req.body && typeof req.body === 'object' ? Object.keys(req.body).filter(key => !/password|token|secret/i.test(key)) : [],
      });
    } catch (error) {
      // Realtime is best-effort: a broadcast failure must never fail a committed API mutation.
      console.error('[realtime] publish failed:', error.message);
      recordPublishError();
    }
  });
  next();
}

module.exports = { realtimeMutationMiddleware, classifyMutation };
