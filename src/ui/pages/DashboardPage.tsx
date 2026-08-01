import { ArrowRight, Clock3, FileClock, FolderOpen, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { listAdminPurchases, listAdminUsers } from '../admin/api';
import { Button, Card, EmptyState, ErrorPanel, Skeleton } from '../components';
import { JobList } from '../workspace/JobList';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';

export function DashboardPage() {
  const { profile } = useAuth();
  const { jobs, loading, error, refresh } = useWorkspaceJobs();
  const [adminSnapshot, setAdminSnapshot] = useState<{
    registeredUsers: number | null;
    pendingPurchases: number | null;
  }>({ registeredUsers: null, pendingPurchases: null });
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const navigate = useNavigate();
  const firstName = profile?.displayName?.trim().split(/\s+/)[0] || 'ဖန်တီးသူ';
  const activeJobs = jobs.filter(job => ['pending', 'queued', 'processing'].includes(job.status)).length;
  const recentJobs = jobs.slice(0, 5);

  useEffect(() => {
    let active = true;
    setSnapshotLoading(true);
    void Promise.allSettled([listAdminUsers(), listAdminPurchases()]).then(([usersResult, purchasesResult]) => {
      if (!active) return;
      setAdminSnapshot({
        registeredUsers: usersResult.status === 'fulfilled' ? usersResult.value.length : null,
        pendingPurchases: purchasesResult.status === 'fulfilled'
          ? purchasesResult.value.filter(purchase => purchase.status === 'pending').length
          : null,
      });
      setSnapshotLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <div className="ds-page-container workspace-page">
      <header className="workspace-welcome">
        <div>
          <span className="workspace-eyebrow">Overview</span>
          <h1>ပြန်လည်ကြိုဆိုပါတယ်၊ {firstName}</h1>
          <p>လတ်တလော Blink အလုပ်များကို တစ်နေရာတည်းတွင် ကြည့်ရှုပါ။</p>
        </div>
        <Button size="lg" icon={<Plus size={18} />} onClick={() => navigate('/new-recap')}>Recap အသစ်</Button>
      </header>

      <div className="workspace-metric-grid" aria-label="Real job summary">
        <Card className="workspace-metric-card"><Clock3 size={18} /><strong>{activeJobs}</strong><span>လုပ်ဆောင်နေသော jobs</span></Card>
        <Card className="workspace-metric-card"><Users size={18} /><strong>{snapshotLoading ? '…' : adminSnapshot.registeredUsers ?? '—'}</strong><span>မှတ်ပုံတင်ထားသော users</span>{adminSnapshot.registeredUsers === null && !snapshotLoading && <small>လက်ရှိ မရရှိနိုင်ပါ</small>}</Card>
        <Card className="workspace-metric-card"><FileClock size={18} /><strong>{snapshotLoading ? '…' : adminSnapshot.pendingPurchases ?? '—'}</strong><span>လက်ဖြင့်စစ်ဆေးရန် payment requests</span>{adminSnapshot.pendingPurchases === null && !snapshotLoading && <small>Billing ပိတ်ထားသည် သို့မဟုတ် မရရှိနိုင်ပါ</small>}</Card>
      </div>

      <Card
        title="လတ်တလော လုပ်ငန်းများ"
        action={<Button variant="ghost" size="sm" icon={<ArrowRight size={15} />} onClick={() => navigate('/history')}>အားလုံးကြည့်မည်</Button>}
      >
        {loading && (
          <div className="workspace-loading-list">
            <Skeleton height="4.5rem" /><Skeleton height="4.5rem" /><Skeleton height="4.5rem" />
          </div>
        )}
        {!loading && error && (
          <ErrorPanel title="လတ်တလော လုပ်ငန်းများ မရရှိနိုင်ပါ" description={error} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => void refresh() }} />
        )}
        {!loading && !error && jobs.length === 0 && (
          <EmptyState
            icon={FolderOpen}
            title="ပရောဂျက် မရှိသေးပါ"
            action={{ label: 'ဗီဒီယိုတင်မည်', onClick: () => navigate('/new-recap') }}
          />
        )}
        {!loading && !error && recentJobs.length > 0 && <JobList jobs={recentJobs} compact />}
      </Card>
    </div>
  );
}
