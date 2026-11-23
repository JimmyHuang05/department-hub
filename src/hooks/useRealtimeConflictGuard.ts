import { useEffect, useState } from 'react';
import { onDataChange, type DataChangeEvent, type RealtimeResource } from '../lib/realtime';

export function useRealtimeConflictGuard(resource: RealtimeResource, entityId: string | null | undefined, editing: boolean) {
  const [conflict, setConflict] = useState<DataChangeEvent | null>(null);
  useEffect(() => {
    if (import.meta.env.VITE_REALTIME_CONFLICT_GUARD_ENABLED === 'false' || !editing || !entityId) { setConflict(null); return undefined; }
    return onDataChange([resource], event => {
      if (event.entityId === entityId) setConflict(event);
    });
  }, [editing, entityId, resource]);
  return { conflict, clearConflict: () => setConflict(null) };
}
