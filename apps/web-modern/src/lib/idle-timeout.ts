import { useEffect, useRef } from "react";

/**
 * Triggers `onIdle` if the user is inactive for `timeoutMs` milliseconds.
 *
 * "Activity" = mousedown, mousemove, keydown, touchstart, scroll, focus,
 * or the tab regaining visibility. The timer resets on any of those events.
 *
 * Active API requests do NOT count as activity by themselves — long-running
 * background polls would otherwise indefinitely hold a session open. The
 * intent is "no human input for X minutes → log out for security".
 */
export function useIdleTimeout(timeoutMs: number, onIdle: () => void, enabled = true): void {
  const timerRef = useRef<number | null>(null);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    const events: (keyof WindowEventMap)[] = [
      "mousedown", "mousemove", "keydown", "touchstart", "scroll", "focus",
    ];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });

    const onVisibility = () => { if (!document.hidden) reset(); };
    document.addEventListener("visibilitychange", onVisibility);

    reset(); // start the initial countdown

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      for (const ev of events) window.removeEventListener(ev, reset);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [timeoutMs, enabled]);
}
