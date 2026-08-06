import { useCallback, useEffect, useState } from 'react';
import { getSystemStatus, listAdminPurchases, listAdminUsers, type SystemStatus } from '../admin/api';
import type { PurchaseRequest } from '../billing/api';
import { EmptyState, LiveStatusHint, Skeleton, StatCard } from '../components';
import { JobList } from '../workspace/JobList';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

// The former Admin "Overview" tab, moved to its own page (Owner/Super Admin
// only, same as before) so it can sit first in navigation instead of being
// one selector option among many. Same permissions, same data sources --
// only where this content lives has changed.
export function DashboardPage() {
  const [userCount, setUserCount] = useState(0);
  const [pendingPurchases, setPendingPurchases] = useState(0);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const { jobs: recentJobs, loading: jobsLoading, degraded: jobsDegraded } = useWorkspaceJobs(5);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [users, purchases, systemStatus] = await Promise.all([
        listAdminUsers(), listAdminPurchases(), getSystemStatus(),
      ]);
      setUserCount(users.length);
      setPendingPurchases(purchases.filter((purchase: PurchaseRequest) => purchase.status === 'pending').length);
      setSystem(systemStatus);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load().catch(() => undefined); }, [load]);
  const { degraded } = useAutoRefresh(load);

  const activeJobs = recentJobs.filter(job => ['pending', 'queued', 'processing'].includes(job.status)).length;

  return (
    <>
      <div className="pagetitle">
        <div><span className="kicker">OVERVIEW</span><h1>Dashboard</h1></div>
      </div>
      <LiveStatusHint degraded={degraded || jobsDegraded} />
      <div className="adminGrid" style={{ marginBottom: 20 }}>
        <StatCard variant="adminCard" value={jobsLoading ? '…' : activeJobs} label="Active jobs" />
        <StatCard variant="adminCard" value={loading ? '…' : userCount} label="Registered users" />
        <StatCard variant="adminCard" value={loading ? '…' : pendingPurchases} label="Awaiting manual credit" />
        <StatCard variant="adminCard" value={system?.status ?? '—'} label="Application status" />
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Recent workspace jobs</h3>
        {jobsLoading ? <Skeleton height="4.5rem" />
          : recentJobs.length === 0 ? <EmptyState title="No jobs yet" />
            : <JobList jobs={recentJobs} compact />}
      </div>
    </>
  );
}
