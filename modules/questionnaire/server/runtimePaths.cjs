const path = require('path');
const { DATA_ASSETS_DIR } = require('../../../server/paths.cjs');

const QUESTIONNAIRE_UPLOAD_DIR = path.join(DATA_ASSETS_DIR, 'questionnaires');
module.exports = { QUESTIONNAIRE_UPLOAD_DIR };
