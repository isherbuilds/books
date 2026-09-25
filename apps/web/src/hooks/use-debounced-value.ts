import { useEffect, useRef, useState } from "react";

// `useDeferredValue` is not a swap for this: it defers rendering, not the fetch
// the value triggers.
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);

    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

// The same pause for a value React never holds: an uncontrolled box keeps its text
// in the DOM, so the callback reads it when it runs, not when it was scheduled. `now`
// runs at once and drops a pending pause.
export function useDebouncedCallback(callback: () => void, delay: number) {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    schedule: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(callback, delay);
    },
    now: () => {
      window.clearTimeout(timer.current);
      callback();
    },
  };
}
