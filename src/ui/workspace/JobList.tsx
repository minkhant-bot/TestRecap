import { useNavigate } from 'react-router-dom';
import { formatCreatedAt, formatDuration } from './format';
import { getDisplayedProgress, getJobStatusLabel } from './workflowPresentation';
import type { WorkspaceJob, WorkspaceRetryEligibility } from './types';

interface JobListProps {
  jobs: WorkspaceJob[];
  onDelete?: (job: WorkspaceJob) => void;
  compact?: boolean;
  retryEligibility?: Record<string, WorkspaceRetryEligibility>;
  retryingId?: string | null;
  onRetry?: (job: WorkspaceJob) => void;
}

export function JobList({ jobs, onDelete, compact = false, retryEligibility = {}, retryingId = null, onRetry }: JobListProps) {
  const navigate = useNavigate();
  const openJob = (job: WorkspaceJob) => {
    navigate(`/new-recap?job=${encodeURIComponent(job.id)}`);
  };
  return (
    <div className={`historylist ${compact ? 'historylist--compact' : ''}`}>
      {jobs.map(job => (
        <article
          key={job.id}
          className="historyitem"
          role="link"
          tabIndex={0}
          aria-label={`${job.filename} ကို ဖွင့်မည်`}
          onClick={event => {
            if ((event.target as HTMLElement).closest('button')) return;
            openJob(job);
          }}
          onKeyDown={event => {
            if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              openJob(job);
            }
          }}
        >
          <div className="thumb">
            {job.thumbnailUrl && (
              <img src={job.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
            )}
          </div>
          <div>
            <b>{job.filename}</b>
            <div className="muted">{formatCreatedAt(job.createdAt)} · {formatDuration(job.duration)}</div>
            <span className="chip" style={{ marginTop: 8 }}>
              {job.cancellationRequested
                ? 'Cancelling'
                : job.status === 'processing' ? 'In progress' : getJobStatusLabel(job)}
            </span>
            {['queued', 'processing'].includes(job.status) && (
              <div className="progress" style={{ marginTop: 8 }} aria-label={`${getDisplayedProgress(job)}% ပြီးစီးသည်`}>
                <span style={{ width: `${getDisplayedProgress(job)}%` }} />
              </div>
            )}
            {job.status === 'failed' && retryEligibility[job.id] && !retryEligibility[job.id].recoverable && (
              <div className="hint" style={{ marginTop: 8 }}>Not currently recoverable</div>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {job.status === 'completed' && (
              <button className="btn" onClick={event => { event.stopPropagation(); openJob(job); }}>Open</button>
            )}
            {job.status === 'failed' && retryEligibility[job.id]?.recoverable && onRetry && (
              <button className="btn" disabled={retryingId === job.id} onClick={event => { event.stopPropagation(); onRetry(job); }}>
                {retryingId === job.id ? 'Requeueing…' : 'Retry'}
              </button>
            )}
            {onDelete && !['queued', 'processing'].includes(job.status) && (
              <button className="btn" aria-label={`${job.filename} ကို ဖျက်မည်`} onClick={event => { event.stopPropagation(); onDelete(job); }}>Delete</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
