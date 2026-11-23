export const ERROR_CODES = {
  UNKNOWN: 'IBD-APP-001',
  NETWORK: 'IBD-NET-001',
  TIMEOUT: 'IBD-NET-408',
  AUTH: 'IBD-AUTH-401',
  PERMISSION: 'IBD-AUTH-403',
  CONFLICT: 'IBD-DATA-409',
  VALIDATION: 'IBD-DATA-422',
  UPLOAD: 'IBD-FILE-001',
  QUESTIONNAIRE: 'IBD-QNR-001',
} as const;

export function resolveErrorCode(input: unknown): string {
  const message = input instanceof Error ? input.message : String(input || '');
  const existing = message.match(/\bIBD-[A-Z]{3,5}-(?:\d{3}|\d{3,4})\b/i)?.[0];
  if (existing) return existing.toUpperCase();
  const status = message.match(/(?:HTTP[_\s-]?|请求失败\s*\()?([45]\d{2})\)?/i)?.[1];
  if (status === '401') return ERROR_CODES.AUTH;
  if (status === '403') return ERROR_CODES.PERMISSION;
  if (status === '408') return ERROR_CODES.TIMEOUT;
  if (status === '409') return ERROR_CODES.CONFLICT;
  if (status) return `IBD-HTTP-${status}`;
  if (/登录|令牌|token|session/i.test(message)) return ERROR_CODES.AUTH;
  if (/权限|无权|forbidden/i.test(message)) return ERROR_CODES.PERMISSION;
  if (/网络|连接|network|fetch|timeout|超时/i.test(message)) return ERROR_CODES.NETWORK;
  if (/冲突|已被修改|conflict/i.test(message)) return ERROR_CODES.CONFLICT;
  if (/上传|文件|附件|upload/i.test(message)) return ERROR_CODES.UPLOAD;
  if (/问卷|答卷|questionnaire/i.test(message)) return ERROR_CODES.QUESTIONNAIRE;
  if (/必填|格式|无效|不能为空|validation/i.test(message)) return ERROR_CODES.VALIDATION;
  return ERROR_CODES.UNKNOWN;
}

export function buildServerErrorMessage(
  body: { error?: string; message?: string; errorCode?: string; code?: string; incidentId?: string } | null | undefined,
  status: number,
  fallback = '请求失败',
): string {
  const reason = String(body?.error || body?.message || `${fallback} (${status})`).trim();
  const errorCode = String(body?.errorCode || body?.code || `IBD-HTTP-${status}`).trim();
  const incidentId = String(body?.incidentId || '').trim();
  return [reason, `错误码：${errorCode}`, incidentId ? `事件编号：${incidentId}` : ''].filter(Boolean).join('\n');
}

export function formatErrorForDisplay(input: unknown): string {
  const message = input instanceof Error ? input.message : String(input || '操作失败');
  const code = message.match(/错误码：([^\s]+)/i)?.[1] || resolveErrorCode(message);
  const incidentId = message.match(/事件编号：([A-Z0-9]{16})/i)?.[1];
  const originalReason = message
    .replace(/\n?错误码：[^\s]+/gi, '')
    .replace(/\n?事件编号：[A-Z0-9]{16}/gi, '')
    .trim();
  const friendlyByCode: Array<[RegExp, string, string]> = [
    [/IBD-(?:AUTH|HTTP)-401/i, '登录状态已失效', '请重新登录后再试。'],
    [/IBD-(?:AUTH|HTTP)-403/i, '你没有执行此操作的权限', '如需处理，请联系项目负责人或高级用户。'],
    [/IBD-HTTP-404/i, '没有找到相关内容', '内容可能已被移动或删除，请刷新后重试。'],
    [/IBD-(?:DATA|HTTP)-409/i, '数据已被其他人更新', '请刷新查看最新内容，再重新提交本次修改。'],
    [/IBD-HTTP-413/i, '文件超过允许大小', '请压缩文件或拆分后重新上传。'],
    [/IBD-(?:DATA-422|HTTP-400|HTTP-422)/i, '提交内容需要调整', '请检查必填项和填写格式后重试。'],
    [/IBD-HTTP-423/i, '当前内容暂时无法编辑', '编辑锁可能已失效，请重新打开后再试。'],
    [/IBD-HTTP-429/i, '操作过于频繁', '请稍等片刻后再试。'],
    [/IBD-(?:NET|HTTP-408)/i, '网络连接不稳定', '请检查网络连接，稍后重试。'],
    [/IBD-HTTP-5\d\d/i, '服务暂时不可用', '请稍后重试；若持续出现，请将事件编号提供给高级用户。'],
  ];
  const friendly = friendlyByCode.find(([pattern]) => pattern.test(code));
  if (friendly) {
    const [, title, action] = friendly;
    const showOriginal = originalReason
      && originalReason !== title
      && !/^(请求失败|操作失败|Failed to fetch|NetworkError|HTTP\s*\d+)/i.test(originalReason);
    return [title, action, showOriginal ? `详情：${originalReason}` : '', `错误码：${code}`, incidentId ? `事件编号：${incidentId}` : '']
      .filter(Boolean)
      .join('\n');
  }
  const prefixed = message.match(/^(IBD-[A-Z]{3,5}-\d{3,4}):\s*(.+)$/is);
  if (prefixed) return `${prefixed[2]}\n错误码：${prefixed[1]}`;
  if (/错误码：IBD-|事件编号：[A-Z0-9]{16}/i.test(message)) return message;
  return `${message}\n错误码：${code}`;
}
