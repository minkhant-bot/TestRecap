import { useCallback, useEffect, useState } from 'react';
import { listWorkspaceJobs } from './api';
import type { WorkspaceJob } from './types';

export function useWorkspaceJobs(limit?: number) {
  const [jobs, setJobs] = useState<WorkspaceJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await listWorkspaceJobs();
      setJobs(limit ? next.slice(0, limit) : next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'ပရောဂျက်များကို ရယူ၍မရပါ။');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { jobs, loading, error, refresh };
}
