const MOTION_PREFERENCE_PREFIX = 'ibd:web-animations:';

function getPreferenceKey(userId?: string | null) {
  return `${MOTION_PREFERENCE_PREFIX}${userId || 'anonymous'}`;
}

export function readAnimationsEnabled(userId?: string | null): boolean {
  try {
    return window.localStorage.getItem(getPreferenceKey(userId)) !== 'off';
  } catch {
    return true;
  }
}

export function applyAnimationsEnabled(enabled: boolean) {
  document.documentElement.dataset.animations = enabled ? 'on' : 'off';
}

export function saveAnimationsEnabled(userId: string | null | undefined, enabled: boolean) {
  try {
    window.localStorage.setItem(getPreferenceKey(userId), enabled ? 'on' : 'off');
  } catch {
    // The preference still applies to the current page when storage is unavailable.
  }
  applyAnimationsEnabled(enabled);
}
