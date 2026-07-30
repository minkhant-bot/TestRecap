import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorPanel, Modal, Skeleton } from '../components';
import { deleteWorkspaceJob } from '../workspace/api';
import { JobList } from '../workspace/JobList';
import type { WorkspaceJob } from '../workspace/types';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';
import { UploadPanel } from './UploadPage';

export function ProjectsPage() {
  const { jobs, loading, error, refresh } = useWorkspaceJobs();
  const [deleting, setDeleting] = useState<WorkspaceJob | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const showUpload = uploadOpen || (!loading && !error && jobs.length === 0);
  const navigate = useNavigate();

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteWorkspaceJob(deleting.id);
      setDeleting(null);
      await refresh();
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : 'ပရောဂျက်ကို ဖျက်၍မရပါ။');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="ds-page-container workspace-page workspace-projects-page">
      <header className="workspace-page-header workspace-page-header--action workspace-projects-header">
        <div>
          <h1>ပရောဂျက်များ</h1>
          <p>ဗီဒီယိုအသစ်တင်ပြီး Recap စတင်ပါ။</p>
        </div>
        {!loading && !error && jobs.length > 0 && !uploadOpen && (
          <Button icon={<Plus size={17} />} onClick={() => setUploadOpen(true)}>Recap အသစ်</Button>
        )}
      </header>
      {showUpload ? (
        <UploadPanel
          geminiApiKey=""
          onCancel={() => setUploadOpen(false)}
          onComplete={job => navigate(`/projects/${job.id}`, {
            replace: true,
            state: { autoStart: true },
          })}
          showCancel={jobs.length > 0}
        />
      ) : (
        <Card>
          {loading && <div className="workspace-loading-list"><Skeleton height="3.75rem" /><Skeleton height="3.75rem" /></div>}
          {!loading && error && <ErrorPanel title="ပရောဂျက်များ မရရှိနိုင်ပါ" description={error} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => void refresh() }} />}
          {!loading && !error && jobs.length > 0 && <JobList jobs={jobs} onDelete={setDeleting} />}
        </Card>
      )}

      <Modal
        open={Boolean(deleting)}
        title="ပရောဂျက်ကို ဖျက်မလား?"
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
