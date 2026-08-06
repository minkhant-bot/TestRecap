import { useEffect, useRef, useState } from 'react';

// The one controlled update mechanism for pages/hooks that don't have a
// real-time push channel (SSE exists only for a single active job's status
// via useJobStatus; everything else -- dashboard metrics, trial requests,
// purchases, credit balances/ledger, user/package/bank admin lists --
// refreshes through this single polling primitive instead of each screen
// inventing its own setInterval, which is how duplicate/inconsistent
// polling crept in previously (e.g. HistoryPage's own ad-hoc interval).
//
// Behavior:
// - One interval per mount, always cleared on unmount/dependency change --
//   never more than one timer per caller.
// - Silently skipped while the tab is hidden (no wasted requests), and an
//   immediate refresh fires the moment the tab regains focus/visibility or
//   the browser reports it's back online -- this is the "reconnect after
//   temporary network loss" behavior.
// - `degraded` only flips true after 3 consecutive failures, so a single
//   transient blip never shows a connection warning; it clears on the next
//   success. Callers use it to render a compact retry hint, never a
//   blocking error state.
export function useAutoRefresh(
  refresh: (silent: boolean) => Promise<void>,
  { intervalMs = 12000, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
) {
  const [degraded, setDegraded] = useState(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let failures = 0;
    let inFlight = false;

    const tick = async () => {
      if (inFlight || cancelled || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        await refreshRef.current(true);
        if (!cancelled) {
          failures = 0;
          setDegraded(false);
        }
      } catch {
        if (!cancelled) {
          failures += 1;
          if (failures >= 3) setDegraded(true);
        }
      } finally {
        inFlight = false;
      }
    };

    const interval = window.setInterval(() => void tick(), intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled, intervalMs]);

  return { degraded };
}
