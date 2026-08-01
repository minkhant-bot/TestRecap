import { Clock3, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorPanel, Modal, Skeleton } from '../components';
import { deleteWorkspaceJob, getWorkspaceRetryEligibility, retryWorkspaceJob } from '../workspace/api';
import { JobList } from '../workspace/JobList';
import type { WorkspaceJob, WorkspaceRetryEligibility } from '../workspace/types';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';

export function HistoryPage() {
  const { jobs, loading, error, refresh } = useWorkspaceJobs();
  const [deleting, setDeleting] = useState<WorkspaceJob | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retryEligibility, setRetryEligibility] = useState<Record<string, WorkspaceRetryEligibility>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const retryKeys = useState(() => new Map<string, string>())[0];
  const navigate = useNavigate();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(true), 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  useEffect(() => {
    let current = true;
    const failed = jobs.filter(job => job.status === 'failed');
    void Promise.all(failed.map(async job => [
      job.id, await getWorkspaceRetryEligibility(job.id),
    ] as const)).then(entries => {
      if (current) setRetryEligibility(Object.fromEntries(entries));
    }).catch(requestError => {
      if (current) setRetryError(requestError instanceof Error ? requestError.message : 'Retry availability could not be checked.');
    });
    return () => { current = false; };
  }, [jobs]);

  const retryJob = async (job: WorkspaceJob) => {
    if (retryingId) return;
    setRetryingId(job.id);
    setRetryError(null);
    const key = retryKeys.get(job.id) || crypto.randomUUID();
    retryKeys.set(job.id, key);
    try {
      await retryWorkspaceJob(job.id, key);
      await refresh(true);
      navigate(`/new-recap?job=${encodeURIComponent(job.id)}`);
    } catch (requestError) {
      setRetryError(requestError instanceof Error ? requestError.message : 'Retry could not be requested.');
    } finally {
      setRetryingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteWorkspaceJob(deleting.id);
      setDeleting(null);
      await refresh();
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : 'မှတ်တမ်းကို ဖျက်၍မရပါ။');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="ds-page-container workspace-page workspace-history-page">
      <header className="workspace-page-header">
        <span className="workspace-eyebrow">Workspace</span>
        <h1>မှတ်တမ်း</h1>
        <p>တန်းစီနေခြင်း၊ လုပ်ဆောင်နေခြင်းနှင့် ပြီးစီးသွားသော Recap အားလုံးကို ကြည့်ရှုပါ။</p>
      </header>
      <Card className="workspace-history-card">
        {loading && <div className="workspace-loading-list"><Skeleton height="4.5rem" /><Skeleton height="4.5rem" /></div>}
        {!loading && error && <ErrorPanel title="မှတ်တမ်း မရရှိနိုင်ပါ" description={error} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => void refresh() }} />}
        {!loading && !error && jobs.length === 0 && <EmptyState icon={Clock3} title="မှတ်တမ်းမရှိသေးပါ" />}
        {!loading && !error && jobs.length > 0 && <JobList jobs={jobs} onDelete={setDeleting} retryEligibility={retryEligibility} retryingId={retryingId} onRetry={job => void retryJob(job)} />}
        {retryError && <div className="workspace-upload-error" role="alert">{retryError}</div>}
      </Card>

      <Modal
        open={Boolean(deleting)}
        title="Recap ကို ဖျက်မလား?"
        onClose={() => !deleteBusy && setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" disabled={deleteBusy} onClick={() => setDeleting(null)}>ပယ်ဖျက်မည်</Button>
            <Button variant="danger" loading={deleteBusy} icon={<Trash2 size={16} />} onClick={() => void confirmDelete()}>ဖျက်မည်</Button>
          </>
        }
      >
        <p className="ds-modal-copy">{deleting?.filename}</p>
        {deleteError && <div className="workspace-upload-error" role="alert">{deleteError}</div>}
      </Modal>
    </div>
  );
}
