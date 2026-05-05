import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];

export function useIdleTimeout({ idleMinutes, onIdle }) {
  const timerRef = useRef(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!idleMinutes || idleMinutes <= 0) return;

    const delay = idleMinutes * 60 * 1000;

    function reset() {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onIdleRef.current(), delay);
    }

    reset();
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, reset, { passive: true }));

    return () => {
      clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [idleMinutes]);
}
