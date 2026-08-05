import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmBody, Dialog, EmptyState, ErrorPanel, Skeleton } from '../components';
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
    <>
      <div className="pagetitle">
        <div>
          <span className="kicker">WORKSPACE</span>
          <h1>မှတ်တမ်း</h1>
          <p>တန်းစီနေခြင်း၊ လုပ်ဆောင်နေခြင်းနှင့် ပြီးစီးသွားသော Recap အားလုံးကို ကြည့်ရှုပါ။</p>
          <p className="hint">Completed videos are available for 24 hours.</p>
        </div>
      </div>
      {loading && <div style={{ display: 'grid', gap: 12 }}><Skeleton height="4.5rem" /><Skeleton height="4.5rem" /></div>}
      {!loading && error && <ErrorPanel title="မှတ်တမ်း မရရှိနိုင်ပါ" description={error} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => void refresh() }} />}
      {!loading && !error && jobs.length === 0 && <EmptyState title="မှတ်တမ်းမရှိသေးပါ" />}
      {!loading && !error && jobs.length > 0 && <JobList jobs={jobs} onDelete={setDeleting} retryEligibility={retryEligibility} retryingId={retryingId} onRetry={job => void retryJob(job)} />}
      {retryError && <div className="alert error" role="alert">{retryError}</div>}

      <Dialog
        open={deleting !== null}
        onClose={() => { if (!deleteBusy) setDeleting(null); }}
        busy={deleteBusy}
        title={deleting ? `Recap ကို ဖျက်မလား? — ${deleting.filename}` : 'Recap ကို ဖျက်မလား?'}
      >
        {deleteError && <div className="alert error" role="alert" style={{ marginBottom: 10 }}>{deleteError}</div>}
        <ConfirmBody
          dangerous
          busy={deleteBusy}
          confirmLabel="ဖျက်မည်"
          cancelLabel="ပယ်ဖျက်မည်"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      </Dialog>
    </>
  );
}
