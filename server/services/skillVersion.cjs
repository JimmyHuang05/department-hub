const SKILL_VERSION = '20260821-180000';
const SKILL_UPDATED_AT = '2026-08-21T18:00:00+08:00';
const SKILL_PATH = '/skill.md';
const publicOrigin = String(process.env.IBD_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const SKILL_PUBLIC_URL = publicOrigin ? `${publicOrigin}${SKILL_PATH}` : SKILL_PATH;

function skillMetadata() {
  return {
    version: SKILL_VERSION,
    updatedAt: SKILL_UPDATED_AT,
    url: SKILL_PUBLIC_URL,
    checkOnEveryRequest: true,
  };
}

function skillVersionHeaders(req, res, next) {
  const clientVersion = String(req.get('X-IBD-Skill-Version') || '').trim();
  const metadata = skillMetadata();
  res.setHeader('X-IBD-Skill-Version', SKILL_VERSION);
  res.setHeader('X-IBD-Skill-Updated-At', SKILL_UPDATED_AT);
  res.setHeader('X-IBD-Skill-URL', metadata.url);
  res.setHeader('X-IBD-Skill-Update', clientVersion === SKILL_VERSION ? 'current' : 'required');
  next();
}

module.exports = {
  SKILL_PATH,
  SKILL_PUBLIC_URL,
  SKILL_UPDATED_AT,
  SKILL_VERSION,
  skillMetadata,
  skillVersionHeaders,
};
