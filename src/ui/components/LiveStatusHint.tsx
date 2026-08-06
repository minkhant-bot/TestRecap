// Compact indicator for pages driven by useAutoRefresh: rendered only once
// background refresh has failed repeatedly (see useAutoRefresh's `degraded`
// return value), never as a permanent or blocking element -- most of the
// time this renders nothing at all.
export function LiveStatusHint({ degraded }: { degraded: boolean }) {
  if (!degraded) return null;
  return (
    <p className="hint liveStatusHint" role="status">
      Live updates paused -- retrying in the background…
    </p>
  );
}
