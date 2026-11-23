const DEVICE_ID_KEY = 'ibd-device-id';

export type DeviceType = 'desktop' | 'mobile';

function browserName(userAgent: string) {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return 'Safari';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  return '浏览器';
}

export function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function getDeviceType(): DeviceType {
  const ua = navigator.userAgent || '';
  const touchLike = navigator.maxTouchPoints > 1;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/i.test(ua) && touchLike)) return 'mobile';
  return 'desktop';
}

export function getDeviceName() {
  const ua = navigator.userAgent || '';
  const browser = browserName(ua);
  let platform = '电脑端';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) platform = 'iPad';
  else if (/iPhone/i.test(ua)) platform = 'iPhone';
  else if (/Android/i.test(ua)) platform = /Mobile/i.test(ua) ? 'Android 手机' : 'Android 平板';
  else if (/Windows/i.test(ua)) platform = 'Windows';
  else if (/Macintosh|Mac OS X/i.test(ua)) platform = 'macOS';
  return `${platform} ${browser}`;
}

export function getDevicePayload() {
  return {
    deviceId: getDeviceId(),
    deviceType: getDeviceType(),
    deviceName: getDeviceName(),
  };
}
