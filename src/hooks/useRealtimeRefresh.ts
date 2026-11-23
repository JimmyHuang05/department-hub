import { useEffect, useRef } from 'react';
import { onDataChange, type DataChangeEvent, type RealtimeResource } from '../lib/realtime';

export function useRealtimeRefresh(
  resources: RealtimeResource[],
  refresh: (event: DataChangeEvent) => void | Promise<void>,
  delay = 160,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const resourceKey = resources.join('|');
  useEffect(() => {
    let timer = 0;
    const stop = onDataChange(resourceKey.split('|') as RealtimeResource[], event => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshRef.current(event), delay);
    });
    const fullSync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshRef.current({ resource: resources[0] } as DataChangeEvent), delay);
    };
    window.addEventListener('ibd:realtime-full-sync', fullSync);
    return () => { stop(); window.removeEventListener('ibd:realtime-full-sync', fullSync); window.clearTimeout(timer); };
  }, [resourceKey, delay]);
}
