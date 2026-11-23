const path = require('path');

const MAX_AVATAR_BYTES = 1024 * 1024;
const MAX_CLOUD_FILE_BYTES = 100 * 1024 * 1024;
const BLOCKED_CLOUD_EXTENSIONS = new Set([
  '.apk', '.app', '.bat', '.cmd', '.com', '.cpl', '.dll', '.dmg', '.exe',
  '.hta', '.jar', '.js', '.jse', '.lnk', '.mjs', '.msi', '.pif', '.ps1',
  '.reg', '.scr', '.sh', '.sys', '.vbe', '.vbs', '.wsf',
]);

function decodeAvatarDataUri(value) {
  const invalid = message => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };
  const image = String(value || '');
  const match = image.match(/^data:image\/jpeg;base64,([a-zA-Z0-9+/]+={0,2})$/);
  if (!match) invalid('头像必须是 JPEG 图片');
  if (match[1].length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 4) {
    invalid('头像大小不能超过 1MB');
  }

  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length || buffer.length > MAX_AVATAR_BYTES) {
    invalid('头像大小不能超过 1MB');
  }
  const isJpeg = buffer.length >= 4
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9;
  if (!isJpeg) invalid('头像文件内容不是有效的 JPEG 图片');
  return buffer;
}

function validateCloudFileName(fileName) {
  const name = String(fileName || '').trim();
  if (!name || name.length > 255 || /[\u0000-\u001f<>:"/\\|?*]/.test(name) || /^\.+$/.test(name)) {
    return { ok: false, error: '文件名不能为空，且不能包含 \\ / : * ? " < > | 等字符' };
  }
  const extension = path.extname(name).toLowerCase();
  if (extension.length > 16 || (extension && !/^\.[a-z0-9]+$/.test(extension))) {
    return { ok: false, error: '文件扩展名无效' };
  }
  if (BLOCKED_CLOUD_EXTENSIONS.has(extension)) {
    return { ok: false, error: '出于安全原因，不支持上传可执行文件或脚本' };
  }
  return { ok: true, extension };
}

module.exports = {
  BLOCKED_CLOUD_EXTENSIONS,
  MAX_AVATAR_BYTES,
  MAX_CLOUD_FILE_BYTES,
  decodeAvatarDataUri,
  validateCloudFileName,
};
