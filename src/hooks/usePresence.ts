import { useEffect, useState } from 'react';

/** Keeps an element mounted long enough for its exit transition to finish. */
export function usePresence(open: boolean, exitDuration = 220) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), exitDuration);
    return () => window.clearTimeout(timer);
  }, [exitDuration, open]);

  return { mounted, visible };
}
