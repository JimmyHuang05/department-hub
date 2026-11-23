import { useState, useEffect } from 'react';

/**
 * 防抖 hook：延迟更新 value，直到 delay 毫秒内没有新变化
 */
export function useDebounce<T>(value: T, delay: number = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
