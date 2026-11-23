export interface AvatarUser {
  id?: string;
  userId?: string;
  display_name?: string;
  displayName?: string;
}

export function getAvatarIdentity(user: AvatarUser) {
  return user.id || user.userId || '';
}

export function getAvatarDisplayName(user: AvatarUser) {
  return user.display_name || user.displayName || getAvatarIdentity(user) || '?';
}

export function getUploadedAvatarUrl(user: AvatarUser, cacheKey?: string | number) {
  const id = encodeURIComponent(getAvatarIdentity(user));
  if (!id) return '';
  const suffix = cacheKey ? `?t=${cacheKey}` : '';
  return `/api/avatars/${id}.jpg${suffix}`;
}

export function getAvatarUrl(user: AvatarUser, cacheKey?: string | number) {
  return getUploadedAvatarUrl(user, cacheKey);
}

export function getAvatarInitial(user: AvatarUser) {
  return getAvatarDisplayName(user).slice(0, 1);
}
