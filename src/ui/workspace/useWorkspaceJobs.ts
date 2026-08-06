import { useCallback, useEffect, useState } from 'react';
import { listWorkspaceJobs } from './api';
import type { WorkspaceJob } from './types';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

export function useWorkspaceJobs(limit?: number, { intervalMs = 12000 }: { intervalMs?: number } = {}) {
  const [jobs, setJobs] = useState<WorkspaceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Silent (background poll) failures are rethrown so useAutoRefresh can
  // count them toward its degraded state; foreground calls (mount, manual
  // retry, explicit awaits elsewhere) keep the original non-throwing
  // contract -- every existing caller's error handling is unaffected.
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const next = await listWorkspaceJobs();
      setJobs(limit ? next.slice(0, limit) : next);
    } catch (requestError) {
      if (!silent) setError(requestError instanceof Error ? requestError.message : 'ပရောဂျက်များကို ရယူ၍မရပါ။');
      if (silent) throw requestError;
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The one controlled update mechanism (see useAutoRefresh): recent jobs
  // and their status now refresh on their own, so callers must never add a
  // second interval/subscription on top of this hook.
  const { degraded } = useAutoRefresh(refresh, { intervalMs });

  return { jobs, loading, error, refresh, degraded };
}
