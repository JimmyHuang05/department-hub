import { create } from 'zustand';
import { api } from '../lib/api';
import {
  applyThemeTokens,
  buildThemePreference,
  DEFAULT_THEME_PREFERENCE,
  deriveThemeTokens,
  type ThemeSeed,
  type ThemeTokens,
  type UserThemePreference,
} from '../theme/presets';

const THEME_CACHE_KEY = 'ibd-theme-preference';

interface ThemeStore {
  preference: UserThemePreference;
  tokens: ThemeTokens;
  loading: boolean;
  error: string | null;
  applyPreference: (preference: UserThemePreference) => void;
  loadTheme: () => Promise<void>;
  saveTheme: (seed: ThemeSeed, presetId?: string) => Promise<void>;
  resetTheme: () => Promise<void>;
}

function normalizePreference(value: UserThemePreference | null | undefined) {
  if (!value?.seed) return DEFAULT_THEME_PREFERENCE;
  return buildThemePreference({
    primary: value.seed.primary || DEFAULT_THEME_PREFERENCE.seed.primary,
    accent: value.seed.accent || DEFAULT_THEME_PREFERENCE.seed.accent,
    background: value.seed.background || DEFAULT_THEME_PREFERENCE.seed.background,
    text: value.seed.text || DEFAULT_THEME_PREFERENCE.seed.text,
  }, value.presetId || 'custom');
}

export function readCachedThemePreference() {
  try {
    const raw = window.localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return DEFAULT_THEME_PREFERENCE;
    return normalizePreference(JSON.parse(raw));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function cacheThemePreference(preference: UserThemePreference) {
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(preference));
  } catch {
    // Theme cache is only a visual convenience for signed-out pages.
  }
}

function getTokens(preference: UserThemePreference) {
  return deriveThemeTokens(preference.seed, preference.presetId);
}

const initialPreference = readCachedThemePreference();
const defaultTokens = getTokens(initialPreference);
applyThemeTokens(defaultTokens, initialPreference.presetId);

export const useThemeStore = create<ThemeStore>((set, get) => ({
  preference: initialPreference,
  tokens: defaultTokens,
  loading: false,
  error: null,
  applyPreference: preference => {
    const normalized = normalizePreference(preference);
    const tokens = getTokens(normalized);
    applyThemeTokens(tokens, normalized.presetId);
    cacheThemePreference(normalized);
    set({ preference: normalized, tokens });
  },
  loadTheme: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.get<{ theme: UserThemePreference | null }>('/preferences/theme');
      get().applyPreference(normalizePreference(res.theme));
      set({ loading: false });
    } catch (error) {
      console.error('加载主题失败', error);
      get().applyPreference(DEFAULT_THEME_PREFERENCE);
      set({ loading: false, error: '加载主题失败，已使用默认配色' });
    }
  },
  saveTheme: async (seed, presetId = 'custom') => {
    const preference = buildThemePreference(seed, presetId);
    get().applyPreference(preference);
    set({ loading: true, error: null });
    try {
      const res = await api.put<{ theme: UserThemePreference }>('/preferences/theme', { theme: preference });
      get().applyPreference(normalizePreference(res.theme));
      set({ loading: false });
    } catch (error) {
      console.error('保存主题失败', error);
      set({ loading: false, error: '保存主题失败' });
      throw error;
    }
  },
  resetTheme: async () => {
    get().applyPreference(DEFAULT_THEME_PREFERENCE);
    set({ loading: true, error: null });
    try {
      await api.delete('/preferences/theme');
      get().applyPreference(DEFAULT_THEME_PREFERENCE);
      set({ loading: false });
    } catch (error) {
      console.error('重置主题失败', error);
      set({ loading: false, error: '重置主题失败' });
      throw error;
    }
  },
}));
