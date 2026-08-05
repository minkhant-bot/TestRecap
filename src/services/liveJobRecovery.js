// Startup reconciliation for live-job billing (P2_LIVE_JOB_BILLING_ENABLED).
//
// Gap this closes: `listRecoverableLiveJobIds` (liveJobBilling.js) and its
// underlying query were implemented and tested, but nothing in production
// ever called them. A hard process crash between a job's JSON-store terminal
// write (completed/failed/cancelled) and its Postgres settle/release call
// left the Postgres reservation permanently `reserved` (or, more rarely,
// `settled` with no matching JSON completion) with no automatic process to
// notice or fix it. See docs/12_KNOWN_ISSUES.md item 15.
//
// Safety model: the JSON workspace-jobs.json record remains the
// authoritative source of truth for a job's actual outcome (this file never
// invents an outcome). This sweep only acts on jobs whose JSON status is
// already terminal (completed/failed/cancelled) or whose JSON record is
// missing entirely; a job still genuinely active (pending/queued/processing)
// is left untouched -- it will settle/release itself through the ordinary
// WorkspaceWorker tick. Every settle/release call below is the same
// idempotent liveJobBilling.js function used by the normal pipeline, so
// re-running this sweep on every restart is always safe and never
// double-settles, double-refunds, or releases a still-active reservation.
// Jobs already `review_required` are left for Super Admin resolution, not
// auto-resolved -- no safe automatic resolution path exists for that state,
// and resolving it is by design a human decision.

import { auditLogsRepository } from '../db/repositories/index.js';
import { withTransaction } from '../db/client.js';
import {
  getLiveJobBillingStatus,
  isLiveJobBillingEnabled,
  listRecoverableLiveJobIds,
  markLiveJobReviewRequired,
  releaseLiveJob,
  settleLiveJob,
} from './liveJobBilling.js';
import { getWorkspaceJobInternal } from './workspaceJobs.js';
import { assertCompletedCoreOutput } from './corePipelineBridge.js';

const ACTIVE_WORKSPACE_STATUSES = new Set(['pending', 'queued', 'processing']);
const ACTIONABLE_BILLING_STATUSES = new Set(['reserved', 'settled']);

const logRecoveryDecision = async (jobId, decision, details = {}) => {
  try {
    await withTransaction(client => auditLogsRepository.insertAuditLog({
      actorService: 'startup_reconciliation',
      eventType: 'job.startup_reconciliation',
      resourceType: 'job',
      resourceId: jobId,
      afterState: { decision, ...details },
    }, { client }));
  } catch (error) {
    console.error(
      `[LiveJobRecovery] Failed to audit recovery decision for ${jobId}:`,
      error?.message || error,
    );
  }
};

const reconcileOne = async (jobId, {
  getBillingStatus, getWorkspaceJob, validateOutput, settle, release, reviewRequired, audit,
}) => {
  const billingJob = await getBillingStatus(jobId);
  if (!billingJob || !ACTIONABLE_BILLING_STATUSES.has(billingJob.billingStatus)) {
    // Already released/refunded/review_required (or vanished): nothing this
    // sweep should decide. review_required is intentionally left for Super
    // Admin -- there is no safe automatic resolution for it.
    return 'skipped';
  }

  const workspaceJob = getWorkspaceJob(jobId);
  if (!workspaceJob) {
    // The JSON operational record is gone and we have no independent way to
    // verify what actually happened. Never guess: escalate.
    await reviewRequired(jobId, 'startup_reconciliation_missing_workspace_record');
    await audit(jobId, 'review_required', { reason: 'workspace_record_missing' });
    return 'reconciled';
  }

  if (ACTIVE_WORKSPACE_STATUSES.has(workspaceJob.status)) {
    // Genuinely still active (requeued by the ordinary recovery path) -- it
    // will settle/release itself through the normal worker tick. Touching
    // the reservation here would risk releasing a still-valid reservation.
    return 'skipped';
  }

  if (workspaceJob.status === 'completed' && billingJob.billingStatus === 'reserved') {
    let hasValidOutput = false;
    try {
      validateOutput(jobId, { videoUrl: workspaceJob.videoUrl || `/output/${jobId}.mp4` });
      hasValidOutput = true;
    } catch {
      hasValidOutput = false;
    }
    if (hasValidOutput) {
      await settle(jobId, { outputValidated: true, reason: 'startup_reconciliation_valid_output' });
      await audit(jobId, 'settled', { workspaceStatus: workspaceJob.status });
    } else {
      await reviewRequired(jobId, 'startup_reconciliation_completed_output_unverifiable');
      await audit(jobId, 'review_required', {
        workspaceStatus: workspaceJob.status, reason: 'output_unverifiable',
      });
    }
    return 'reconciled';
  }

  if (['failed', 'cancelled'].includes(workspaceJob.status) && billingJob.billingStatus === 'reserved') {
    await release(jobId, 'startup_reconciliation_no_valid_output');
    await audit(jobId, 'released', { workspaceStatus: workspaceJob.status });
    return 'reconciled';
  }

  if (workspaceJob.status === 'completed' && billingJob.billingStatus === 'settled') {
    // Already correctly resolved (settle() sets Postgres jobs.status to
    // 'completed' in the same transaction, so listRecoverableLiveJobIds's own
    // query excludes this case in practice -- this branch is defense in
    // depth so re-running the sweep, or a future change to that query, can
    // never turn an already-settled job into a false review_required).
    return 'skipped';
  }

  // Any other combination (e.g. billing already settled but the JSON record
  // ended failed/cancelled) is an anomaly this sweep cannot safely resolve
  // by itself -- it must never guess between settle/release/refund.
  await reviewRequired(jobId, 'startup_reconciliation_state_mismatch');
  await audit(jobId, 'review_required', {
    workspaceStatus: workspaceJob.status, billingStatus: billingJob.billingStatus,
    reason: 'unexpected_state_combination',
  });
  return 'reconciled';
};

export const reconcileStrandedLiveJobs = async ({
  isEnabled = isLiveJobBillingEnabled,
  listStranded = listRecoverableLiveJobIds,
  getBillingStatus = getLiveJobBillingStatus,
  getWorkspaceJob = getWorkspaceJobInternal,
  validateOutput = assertCompletedCoreOutput,
  settle = settleLiveJob,
  release = releaseLiveJob,
  reviewRequired = markLiveJobReviewRequired,
  audit = logRecoveryDecision,
} = {}) => {
  if (!isEnabled()) return { enabled: false, reconciled: 0, skipped: 0, total: 0 };
  const jobIds = await listStranded();
  let reconciled = 0;
  let skipped = 0;
  for (const jobId of jobIds) {
    try {
      const outcome = await reconcileOne(jobId, {
        getBillingStatus, getWorkspaceJob, validateOutput, settle, release, reviewRequired, audit,
      });
      if (outcome === 'reconciled') reconciled += 1;
      else skipped += 1;
    } catch (error) {
      skipped += 1;
      console.error(`[LiveJobRecovery] Reconciliation failed for ${jobId}:`, error?.message || error);
    }
  }
  return { enabled: true, reconciled, skipped, total: jobIds.length };
};
