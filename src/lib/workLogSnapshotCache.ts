import { api } from './api';

const CACHE_TTL_MS = 60_000;
let cachedWeekKeys: string[] | null = null;
let cachedAt = 0;
let weekKeysRequest: Promise<string[]> | null = null;

export function getWorkLogSnapshotWeekKeys(force = false): Promise<string[]> {
  const cacheIsFresh = cachedWeekKeys && Date.now() - cachedAt < CACHE_TTL_MS;
  if (!force && cacheIsFresh) return Promise.resolve(cachedWeekKeys!);
  if (weekKeysRequest) return weekKeysRequest;

  weekKeysRequest = api.get<{ weekKeys: string[] }>('/entries/snapshot-weeks/list')
    .then(result => {
      cachedWeekKeys = result.weekKeys || [];
      cachedAt = Date.now();
      return cachedWeekKeys;
    })
    .finally(() => {
      weekKeysRequest = null;
    });

  return weekKeysRequest;
}

export function invalidateWorkLogSnapshotWeekKeys() {
  cachedWeekKeys = null;
  cachedAt = 0;
}
