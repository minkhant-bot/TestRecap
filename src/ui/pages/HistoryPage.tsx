import { Clock3, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorPanel, Modal, Skeleton } from '../components';
import { deleteWorkspaceJob } from '../workspace/api';
import { JobList } from '../workspace/JobList';
import type { WorkspaceJob } from '../workspace/types';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';

export function HistoryPage() {
  const { jobs, loading, error, refresh } = useWorkspaceJobs();
  const [deleting, setDeleting] = useState<WorkspaceJob | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(true), 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);

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
        <h1>မှတ်တမ်း</h1>
        <p>Recap အားလုံးကို ပြန်လည်ကြည့်ပါ။</p>
      </header>
      <Card className="workspace-history-card">
        {loading && <div className="workspace-loading-list"><Skeleton height="4.5rem" /><Skeleton height="4.5rem" /></div>}
        {!loading && error && <ErrorPanel title="မှတ်တမ်း မရရှိနိုင်ပါ" description={error} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => void refresh() }} />}
        {!loading && !error && jobs.length === 0 && <EmptyState icon={Clock3} title="မှတ်တမ်းမရှိသေးပါ" />}
        {!loading && !error && jobs.length > 0 && <JobList jobs={jobs} onDelete={setDeleting} />}
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
