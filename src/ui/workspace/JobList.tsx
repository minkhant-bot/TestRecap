import { ArrowUpRight, Clock3, FileVideo2, RotateCcw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components';
import { formatCreatedAt, formatDuration } from './format';
import { getDisplayedProgress, getJobStatusLabel, getJobStatusTone } from './workflowPresentation';
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
    <div className={`workspace-job-list ${compact ? 'workspace-job-list--compact' : ''}`}>
      {jobs.map(job => (
        <article
          key={job.id}
          className={`workspace-job ${onDelete ? 'workspace-job--actionable' : ''}`}
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
          <span className="workspace-job__thumbnail">
            {job.thumbnailUrl
              ? <img src={job.thumbnailUrl} alt="" />
              : <FileVideo2 size={23} />}
          </span>
          <div className="workspace-job__main">
            <strong>{job.filename}</strong>
            <span>
              <span><Clock3 size={13} />{formatCreatedAt(job.createdAt)}</span>
              <span>{formatDuration(job.duration)}</span>
            </span>
            {['queued', 'processing'].includes(job.status) && (
              <span className="workspace-job__progress" aria-label={`${getDisplayedProgress(job)}% ပြီးစီးသည်`}>
                <i style={{ width: `${getDisplayedProgress(job)}%` }} />
              </span>
            )}
          </div>
          <div className="workspace-job__tail">
            <StatusBadge status={getJobStatusTone(job)}>
              {job.cancellationRequested
                ? 'Cancelling'
                : job.status === 'processing' ? 'In progress' : getJobStatusLabel(job)}
            </StatusBadge>
            {job.status === 'completed' && (
              <button
                className="workspace-job__open"
                onClick={event => {
                  event.stopPropagation();
                  openJob(job);
                }}
              >
                ဖွင့်မည် <ArrowUpRight size={14} />
              </button>
            )}
            {job.status === 'failed' && retryEligibility[job.id]?.recoverable && onRetry && (
              <button
                className="workspace-job__retry"
                disabled={retryingId === job.id}
                onClick={event => {
                  event.stopPropagation();
                  onRetry(job);
                }}
              >
                <RotateCcw size={14} />{retryingId === job.id ? 'Requeueing…' : 'Retry'}
              </button>
            )}
          </div>
          {job.status === 'failed' && retryEligibility[job.id] && !retryEligibility[job.id].recoverable && (
            <small className="workspace-job__retry-note">{retryEligibility[job.id].reason || 'Not safely recoverable'}</small>
          )}
          {onDelete && !['queued', 'processing'].includes(job.status) && (
            <button
              className="workspace-job__delete"
              aria-label={`${job.filename} ကို ဖျက်မည်`}
              onClick={event => {
                event.stopPropagation();
                onDelete(job);
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
