import { create } from 'zustand';
import { AuthState, User } from '../types';
import { ApiError, api } from '../lib/api';
import { _toast } from './toastRef';
import { getDevicePayload } from '../utils/device';
import { normalizeLoginIdentifier } from '../utils/accountIdentifier';

const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

export const useAuthStore = create<AuthState>((set) => {
  const savedToken = localStorage.getItem(AUTH_TOKEN_KEY);
  const savedUser = localStorage.getItem(AUTH_USER_KEY);

  return {
    user: savedUser ? JSON.parse(savedUser) as User : null,
    isAuthenticated: !!savedToken,
    forcedLogoutInfo: null,
    loginConflict: null,

    login: async (identifier: string, password: string, force = false): Promise<boolean> => {
      try {
        const res = await api.post<{ token: string; user: User }>('/auth/login', {
          username: normalizeLoginIdentifier(identifier),
          password,
          force,
          ...getDevicePayload(),
        });
        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(res.user));
        set({ user: res.user, isAuthenticated: true, loginConflict: null, forcedLogoutInfo: null });
        return true;
      } catch (err: any) {
        if (err instanceof ApiError && err.code === 'DEVICE_LIMIT_REACHED') {
          set({ loginConflict: err.data?.conflict || null });
          throw err;
        }
        _toast?.error?.(err.message || '登录失败');
        return false;
      }
    },

    logout: async () => {
      try {
        await api.post('/auth/logout', {});
      } catch {
        // 即使请求失败也清除本地状态
      }
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      set({ user: null, isAuthenticated: false, loginConflict: null });
    },

    forceLogout: (info) => {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
      set({
        user: null,
        isAuthenticated: false,
        loginConflict: null,
        forcedLogoutInfo: {
          message: info?.message || '你的账号已在另一台设备登录，本设备已下线。',
          deviceType: info?.deviceType || '',
          deviceName: info?.deviceName || '',
          loginAt: info?.loginAt || new Date().toISOString(),
        },
      });
    },

    clearForcedLogout: () => {
      set({ forcedLogoutInfo: null });
    },

    clearLoginConflict: () => {
      set({ loginConflict: null });
    },

    refreshUser: async () => {
      try {
        const res = await api.get<{ user: User }>('/auth/me');
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(res.user));
        set({ user: res.user });
      } catch {
        // 静默失败，不影响当前会话
      }
    },
  };
});
