const express = require('express');
const { skillMetadata, SKILL_VERSION } = require('../services/skillVersion.cjs');
const router = express.Router();

const CONTENT_API_PATHS = {
  '/files': {
    get: {
      summary: '查询云盘文件',
      description: '需要 read:clouddrive 权限。',
      parameters: [
        { name: 'keyword', in: 'query', schema: { type: 'string' } },
        { name: 'projectId', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 50 } },
      ],
      responses: { 200: { description: 'OK' } },
    },
  },
  '/files/{id}': {
    get: {
      summary: '查询云盘文件详情',
      description: '需要 read:clouddrive 权限。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
    },
  },
  '/files/search-content': {
    get: {
      summary: '搜索云盘文件内容',
      description: '需要 read:clouddrive 权限。在云端搜索文本及 Office 文档，返回命中片段和按需读取地址。',
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 100 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20 } },
      ],
      responses: { 200: { description: 'Content matches' }, 400: { description: 'Invalid keyword' } },
    },
  },
  '/files/{id}/download': {
    get: {
      summary: '下载云盘文件',
      description: '需要 read:clouddrive 权限，返回原始文件。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Binary file' }, 404: { description: 'Not found' } },
    },
  },
  '/files/{id}/content': {
    get: {
      summary: '分段读取云盘文本文件',
      description: '需要 read:clouddrive 权限。可分段读取文本、Office 和 PDF；扫描 PDF 或图片需显式设置 ocr=true。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'start', in: 'query', schema: { type: 'integer', minimum: 0 } },
        { name: 'maxChars', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500000 } },
        { name: 'ocr', in: 'query', schema: { type: 'boolean', default: false }, description: '显式启用本地中英文 OCR，最多识别 10 页。' },
      ],
      responses: { 200: { description: 'Text content chunk' }, 415: { description: 'Unsupported content type' } },
    },
  },
  '/tools': {
    get: {
      summary: '查询可用工具',
      description: '需要 read:tools 权限。',
      responses: { 200: { description: 'OK' } },
    },
  },
  '/tools/{id}': {
    get: {
      summary: '查询工具详情和版本',
      description: '需要 read:tools 权限。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
    },
  },
  '/tools/{id}/download': {
    get: {
      summary: '下载工具文件',
      description: '需要 read:tools 权限，返回当前版本文件。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Binary file' }, 404: { description: 'Not found' } },
    },
  },
  '/skills': {
    get: {
      summary: '查询可用 Skill',
      description: '需要 read:skills 权限。',
      responses: { 200: { description: 'OK' } },
    },
  },
  '/skills/{id}': {
    get: {
      summary: '查询 Skill 详情和版本',
      description: '需要 read:skills 权限。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
    },
  },
  '/skills/{id}/content': {
    get: {
      summary: '读取 Skill 的 SKILL.md',
      description: '需要 read:skills 权限，可供本地 AI 客户端直接加载。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'SKILL.md content' }, 404: { description: 'Not found' } },
    },
  },
  '/skills/{id}/manifest': {
    get: {
      summary: '读取远程 Skill 文件清单',
      description: '需要 read:skills 权限。Agent 应先读取清单，再按需读取引用文件，无需下载安装包。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Remote Skill manifest' }, 404: { description: 'Not found' } },
    },
  },
  '/skills/{id}/file': {
    get: {
      summary: '按路径读取远程 Skill 文件',
      description: '需要 read:skills 权限。文本直接返回，二进制以 Base64 返回，单文件上限 2MB。',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'versionId', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'path', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: { 200: { description: 'Remote file content' }, 404: { description: 'Not found' }, 413: { description: 'File too large' } },
    },
  },
  '/skills/{id}/download': {
    get: {
      summary: '下载 Skill 安装包',
      description: '需要 read:skills 权限，返回当前版本文件。',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Binary file' }, 404: { description: 'Not found' } },
    },
  },
};

router.get('/openapi.json', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'GCO Link Integration API',
      version: '1.0.0',
      description: '只读数据接口，供外部 AI 平台按用户 API Key 查询项目和周报数据。',
      'x-ibd-skill-version': SKILL_VERSION,
      'x-ibd-skill': skillMetadata(req),
    },
    servers: [{ url: `${baseUrl}/api/integration/v1` }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      ...CONTENT_API_PATHS,
      '/me': {
        get: {
          summary: '查看当前 API Key 归属用户',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/bootstrap': {
        get: {
          summary: '首次连接快速初始化',
          description: '一次返回当前用户、权限、Skill 版本和可用资源，替代顺序调用 /me 与 /schema。',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/schema': {
        get: {
          summary: '查看可查询资源和字段说明',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/search': {
        get: {
          summary: '跨项目和周报搜索',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: '关键词' },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 50 }, description: '返回条数' },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/projects': {
        get: {
          summary: '查询项目列表',
          parameters: [
            { name: 'keyword', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'manager', in: 'query', schema: { type: 'string' } },
            { name: 'projectCode', in: 'query', schema: { type: 'string' }, description: 'Exact project-code match.' },
            { name: 'contractNo', in: 'query', schema: { type: 'string' }, description: 'Exact contract-number match.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Use page.nextCursor to read the next page.' },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/projects/{id}': {
        get: {
          summary: '查询项目详情',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
        },
      },
      '/worklogs': {
        get: {
          summary: '查询管理周报',
          parameters: [
            { name: 'keyword', in: 'query', schema: { type: 'string' } },
            { name: 'weekKey', in: 'query', schema: { type: 'string' } },
            { name: 'manager', in: 'query', schema: { type: 'string' } },
            { name: 'projectId', in: 'query', schema: { type: 'string' }, description: 'Exact linked-project match.' },
            { name: 'projectCode', in: 'query', schema: { type: 'string' }, description: 'Exact project-code match.' },
            { name: 'contractNo', in: 'query', schema: { type: 'string' }, description: 'Exact contract-number match.' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Use page.nextCursor to read the next page.' },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/worklogs/{id}': {
        get: {
          summary: '查询周报详情',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
        },
      },
      '/questionnaires': {
        get: {
          summary: '查询问卷列表',
          parameters: [
            { name: 'keyword', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Use page.nextCursor to read the next page.' },
          ],
          responses: { 200: { description: 'OK' }, 400: { description: 'Invalid or stale cursor' } },
        },
      },
    },
  });
});

module.exports = router;
