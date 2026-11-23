import { api, isOwnMutation } from './api';

export type RealtimeResource = 'project' | 'worklog' | 'task' | 'message' | 'questionnaire' |
  'submission' | 'cloud-file' | 'tool' | 'skill' | 'user' | 'settings';

export interface DataChangeEvent {
  type: 'data-change';
  eventId: string;
  sequence: number;
  resource: RealtimeResource;
  action: 'created' | 'updated' | 'deleted' | 'replied' | 'published';
  entityId: string;
  parentId?: string;
  version?: string;
  updatedAt: string;
  actor: { id: string; name: string };
  mutationId?: string;
  changedFields?: string[];
}

const seen = new Set<string>();
const seenQueue: string[] = [];

function remember(eventId: string) {
  if (!eventId || seen.has(eventId)) return false;
  seen.add(eventId);
  seenQueue.push(eventId);
  if (seenQueue.length > 1000) seen.delete(seenQueue.shift()!);
  return true;
}

export function sequenceStorageKey(userId: string) {
  return `ibd_realtime_sequence:${userId}`;
}

export function getLastSequence(userId: string) {
  return Math.max(0, Number(sessionStorage.getItem(sequenceStorageKey(userId))) || 0);
}

export function acceptDataChange(event: DataChangeEvent, userId: string) {
  if (!event?.eventId || !remember(event.eventId)) return false;
  if (event.sequence > getLastSequence(userId)) {
    sessionStorage.setItem(sequenceStorageKey(userId), String(event.sequence));
  }
  if (event.mutationId && isOwnMutation(event.mutationId)) return false;
  window.dispatchEvent(new CustomEvent<DataChangeEvent>('ibd:data-change', { detail: event }));
  return true;
}

export async function recoverDataChanges(userId: string) {
  let after = getLastSequence(userId);
  let rounds = 0;
  do {
    const result = await api.get<{events: DataChangeEvent[]; latestSequence: number; hasMore: boolean; requiresFullSync?: boolean}>(
      `/realtime/changes?after=${after}&limit=500`,
    );
    if (result.requiresFullSync) window.dispatchEvent(new Event('ibd:realtime-full-sync'));
    for (const event of result.events || []) acceptDataChange(event, userId);
    const next = Math.max(after, Number(result.latestSequence) || after);
    if (next === after || !result.hasMore) return;
    after = next;
    sessionStorage.setItem(sequenceStorageKey(userId), String(after));
    rounds += 1;
  } while (rounds < 20);
}

export function onDataChange(resources: RealtimeResource[], handler: (event: DataChangeEvent) => void) {
  const allowed = new Set(resources);
  const listener = (raw: Event) => {
    const event = (raw as CustomEvent<DataChangeEvent>).detail;
    if (event && allowed.has(event.resource)) handler(event);
  };
  window.addEventListener('ibd:data-change', listener);
  return () => window.removeEventListener('ibd:data-change', listener);
}
