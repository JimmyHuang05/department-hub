export type ThemeSeed = {
  primary: string;
  accent: string;
  background: string;
  text: string;
};

export type ThemeTokens = {
  page: string;
  panel: string;
  panelSoft: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  primary: string;
  primaryHover: string;
  primaryText: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  overlay: string;
  sidebar: string;
  sidebarText: string;
  sidebarMuted: string;
  sidebarActive: string;
};

export type ThemePreset = {
  id: string;
  name: string;
  note: string;
  seed: ThemeSeed;
};

export type UserThemePreference = {
  version: 1;
  presetId: string;
  seed: ThemeSeed;
};

export const DEFAULT_THEME_SEED: ThemeSeed = {
  primary: '#1D4ED8',
  accent: '#BE123C',
  background: '#F6F7FB',
  text: '#202A36',
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'blue-rose',
    name: '晴川丹枫',
    note: '晴川历历汉阳树，芳草萋萋鹦鹉洲。',
    seed: DEFAULT_THEME_SEED,
  },
  {
    id: 'paper-green',
    name: '素笺松墨',
    note: '明月松间照，清泉石上流。',
    seed: {
      primary: '#166534',
      accent: '#9A5B13',
      background: '#FAF9F5',
      text: '#26332D',
    },
  },
  {
    id: 'solemn-red',
    name: '丹阙肃仪',
    note: '大江东去，浪淘尽，千古风流人物。',
    seed: {
      primary: '#991B1B',
      accent: '#B45309',
      background: '#F8F5F2',
      text: '#2B1F1F',
    },
  },
  {
    id: 'soft-pink',
    name: '樱云绮梦',
    note: '云想衣裳花想容，春风拂槛露华浓。',
    seed: {
      primary: '#DB2777',
      accent: '#F59EBC',
      background: '#FFF5F8',
      text: '#3A2530',
    },
  },
  {
    id: 'ink-mono',
    name: '玄素墨影',
    note: '墨分五色，素卷留白。',
    seed: {
      primary: '#111827',
      accent: '#52525B',
      background: '#F8FAFC',
      text: '#171717',
    },
  },
];

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHex(hex: string) {
  const normalized = normalizeHex(hex);
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map(channel => clamp(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function mix(color: string, target: string, amount: number) {
  const from = parseHex(color);
  const to = parseHex(target);
  return toHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
}

function relativeLuminance(hex: string) {
  const { r, g, b } = parseHex(hex);
  const channels = [r, g, b].map(value => {
    const next = value / 255;
    return next <= 0.03928 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(first: string, second: string) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function normalizeHex(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map(char => char + char).join('')}`.toUpperCase();
  }
  return '#000000';
}

export function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) || /^#[0-9a-fA-F]{3}$/.test(value.trim());
}

export function deriveThemeTokens(seed: ThemeSeed, _presetId = 'custom'): ThemeTokens {
  const primary = normalizeHex(seed.primary);
  const accent = normalizeHex(seed.accent);
  const page = normalizeHex(seed.background);
  const text = normalizeHex(seed.text);
  return {
    page,
    panel: mix(page, '#FFFFFF', 0.9),
    panelSoft: mix(page, text, 0.04),
    border: mix(page, text, 0.11),
    text,
    muted: mix(text, page, 0.36),
    faint: mix(text, page, 0.58),
    primary,
    primaryHover: mix(primary, '#000000', 0.16),
    primaryText: contrastRatio(primary, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#111827',
    primarySoft: mix(primary, page, 0.88),
    accent,
    accentSoft: mix(accent, page, 0.9),
    danger: accent,
    dangerSoft: mix(accent, page, 0.92),
    success: '#166534',
    successSoft: '#F0FDF4',
    warning: '#92400E',
    warningSoft: '#FFFBEB',
    info: primary,
    infoSoft: mix(primary, page, 0.88),
    overlay: 'rgb(15 23 42 / 30%)',
    sidebar: mix(page, '#FFFFFF', 0.94),
    sidebarText: mix(text, page, 0.12),
    sidebarMuted: mix(text, page, 0.55),
    sidebarActive: primary,
  };
}

export function applyThemeTokens(tokens: ThemeTokens, presetId = 'custom') {
  const root = document.documentElement;
  Object.entries(tokens).forEach(([key, value]) => {
    root.style.setProperty(`--app-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  });
  root.classList.remove('dark');
  root.classList.add('light');
  root.dataset.themeMode = 'light';
  root.dataset.themePreset = presetId;
}

export function buildThemePreference(seed: ThemeSeed, presetId = 'custom'): UserThemePreference {
  return {
    version: 1,
    presetId,
    seed: {
      primary: normalizeHex(seed.primary),
      accent: normalizeHex(seed.accent),
      background: normalizeHex(seed.background),
      text: normalizeHex(seed.text),
    },
  };
}

export const DEFAULT_THEME_PREFERENCE = buildThemePreference(DEFAULT_THEME_SEED, 'blue-rose');
