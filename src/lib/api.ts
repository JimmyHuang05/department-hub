import { buildServerErrorMessage } from '../utils/errorCodes';

const API_BASE ='/api';

function getToken(): string | null {return localStorage.getItem('auth_token');}

const recentMutationIds = new Map<string, number>();
function createMutationId() {
 const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
 recentMutationIds.set(id, Date.now());
 if (recentMutationIds.size > 200) {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, createdAt] of recentMutationIds) if (createdAt < cutoff) recentMutationIds.delete(key);
 }
 return id;
}
export function isOwnMutation(id: string) {return recentMutationIds.has(id);}

export class ApiError extends Error {status: number;
 code?: string;
 data?: any;
 constructor(message: string, status: number, code?: string, data?: any) {super(message);
 this.status = status;
 this.code = code;
 this.data = data;
 this.name ='ApiError';}}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {const token = getToken();
 const headers: Record<string, string> = {'Content-Type':'application/json',
 ...(options.headers as Record<string, string> || {}),};

 if (token) {headers['Authorization'] =`Bearer ${token}`;}
 if (options.method && options.method !== 'GET' && !headers['X-Mutation-ID']) headers['X-Mutation-ID'] = createMutationId();

 const res = await fetch(`${API_BASE}${path}`, {...options,
 headers,});

 if (res.status === 401) {const body = await res.json().catch(() => ({}));
 if (body.code === 'SESSION_REVOKED') {
 window.dispatchEvent(new CustomEvent('ibd:forced-logout', {detail: body.logoutInfo || {message: body.error}}));
 throw new ApiError(body.error || '你的账号已在另一台设备登录', 401, body.code, body);
 }
 // token 过期或无效，清除登录状态
 localStorage.removeItem('auth_token');
 localStorage.removeItem('auth_user');
 window.location.href ='/login';
 throw new ApiError(body.error || '登录已过期', 401, body.code, body);}

 if (!res.ok) {const body = await res.json().catch(() => ({}));
 const displayErrorCode = body.errorCode || body.code || `IBD-HTTP-${res.status}`;
 const businessErrorCode = body.code || displayErrorCode;
 throw new ApiError(buildServerErrorMessage(body, res.status), res.status, businessErrorCode, body);}

 return res.json();}

// 便捷方法
export const api = {get: <T>(path: string) => request<T>(path),
 post: <T>(path: string, body: any) => request<T>(path, {method:'POST', body: JSON.stringify(body)}),
 put: <T>(path: string, body: any) => request<T>(path, {method:'PUT', body: JSON.stringify(body)}),
 delete: <T>(path: string) => request<T>(path, {method:'DELETE'}),};
