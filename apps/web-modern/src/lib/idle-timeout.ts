import { useEffect, useRef } from "react";

/**
 * Triggers `onIdle` only when the device was suspended or the screensaver
 * blocked execution for longer than `gapThresholdMs`.
 *
 * Mecánica: un setInterval despierta cada CHECK_INTERVAL_MS y compara el
 * tiempo transcurrido contra el esperado. Si el delta supera el umbral,
 * los timers del browser estuvieron pausados → la PC se suspendió o el
 * screensaver/lock-screen mantuvo la pestaña inactiva el tiempo suficiente
 * para que el SO degradara los timers de fondo. En cualquiera de esos
 * casos, cerramos sesión.
 *
 * NO se cierra sesión por inactividad humana (mouse/teclado quietos): si
 * el usuario está mirando la pantalla, los timers siguen ejecutándose
 * normalmente y no hay drift.
 */
const CHECK_INTERVAL_MS = 30 * 1000;

export function useIdleTimeout(gapThresholdMs: number, onIdle: () => void, enabled = true): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let lastTick = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;
      if (delta > gapThresholdMs) onIdleRef.current();
    }, CHECK_INTERVAL_MS);

    return () => { window.clearInterval(id); };
  }, [gapThresholdMs, enabled]);
}
