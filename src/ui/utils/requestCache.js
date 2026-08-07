// Coalesces identical concurrent/near-concurrent GET requests behind one
// network call. Several screens legitimately need the same data at once
// (e.g. the sidebar's credit balance and the Buy Credits overview both read
// /api/credits/balance), and each already polls independently via
// useAutoRefresh -- without this, they each fire their own request every
// tick. The TTL is kept well under every screen's own refresh interval
// (>=12s; see useAutoRefresh) so this never makes data look staler than
// today's behavior -- it only merges requests that land close together.
const inFlight = new Map();

export function dedupeRequest(key, ttlMs, run) {
  const now = Date.now();
  const cached = inFlight.get(key);
  if (cached && cached.expires > now) return cached.promise;
  const promise = run();
  promise.catch(() => { inFlight.delete(key); });
  inFlight.set(key, { expires: now + ttlMs, promise });
  return promise;
}

export function clearDedupeCache() {
  inFlight.clear();
}
