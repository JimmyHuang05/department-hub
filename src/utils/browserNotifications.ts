export interface BrowserNotificationPreferences {
  enabled: boolean;
  sound: boolean;
}

export interface RealtimeNotificationPayload {
  id: string;
  title: string;
  content?: string;
  actionUrl?: string;
}

const preferenceKey = (userId?: string) => `ibd-browser-notifications:${userId || 'anonymous'}`;
let audioContext: AudioContext | null = null;

export function browserNotificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function browserNotificationPermission(): NotificationPermission | 'unsupported' {
  return browserNotificationsSupported() ? Notification.permission : 'unsupported';
}

export function readBrowserNotificationPreferences(userId?: string): BrowserNotificationPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey(userId)) || '{}');
    return { enabled: value.enabled === true, sound: value.sound !== false };
  } catch {
    return { enabled: false, sound: true };
  }
}

export function saveBrowserNotificationPreferences(userId: string | undefined, value: BrowserNotificationPreferences) {
  localStorage.setItem(preferenceKey(userId), JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('ibd:browser-notification-preferences', { detail: value }));
}

export async function requestBrowserNotificationAccess(userId?: string) {
  if (!browserNotificationsSupported()) return 'unsupported' as const;
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    const current = readBrowserNotificationPreferences(userId);
    saveBrowserNotificationPreferences(userId, { ...current, enabled: true });
    await primeNotificationSound();
  }
  return permission;
}

export async function primeNotificationSound() {
  if (typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === 'suspended') await audioContext.resume();
}

export async function playNotificationSound() {
  try {
    await primeNotificationSound();
    if (!audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
    gain.connect(audioContext.destination);
    [740, 988].forEach((frequency, index) => {
      const oscillator = audioContext!.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(start + index * 0.11);
      oscillator.stop(start + 0.22 + index * 0.11);
    });
  } catch {
    // 浏览器可能在未发生用户交互时阻止音频，保持静默即可。
  }
}

export async function showRealtimeBrowserNotification(userId: string | undefined, payload: RealtimeNotificationPayload) {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return;
  const preferences = readBrowserNotificationPreferences(userId);
  if (!preferences.enabled) return;
  try {
    const seenKey = `ibd-browser-notification-seen:${payload.id}`;
    if (sessionStorage.getItem(seenKey)) return;
    sessionStorage.setItem(seenKey, '1');
  } catch { /* storage unavailable */ }

  const notification = new Notification(payload.title || '你有一条新消息', {
    body: payload.content || '',
    icon: '/favicon.ico',
    tag: payload.id,
  });
  notification.onclick = () => {
    window.focus();
    if (payload.actionUrl) window.location.assign(payload.actionUrl);
    notification.close();
  };
  if (preferences.sound) await playNotificationSound();
}
