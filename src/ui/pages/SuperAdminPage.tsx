import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleDot, Coins, FileClock, Landmark, Package, Paperclip, ServerCog,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  addMatchingPurchaseCredits, adjustUserCredits, getScreenshotContent, getScreenshotMetadata, getSystemStatus, listAdminLogs,
  listAdminPurchases, listAdminUsers, listBillingAudit,
  type AdminAuditEvent, type AdminUser, type BillingAuditEvent,
  type ScreenshotMetadata, type SystemStatus,
} from '../admin/api';
import type { PurchaseRequest } from '../billing/api';
import { Badge, Button, Card, EmptyState, ErrorPanel, Input, Modal, Skeleton, Tabs, Toast } from '../components';

type TabId = 'users' | 'purchases' | 'packages' | 'credits' | 'audit' | 'system';

const requestError = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MB`;

export function SuperAdminPage() {
  const [tab, setTab] = useState<TabId>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
  const [logs, setLogs] = useState<AdminAuditEvent[]>([]);
  const [billingAudit, setBillingAudit] = useState<BillingAuditEvent[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [proof, setProof] = useState<ScreenshotMetadata | null>(null);
  const [proofId, setProofId] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [purchaseToCredit, setPurchaseToCredit] = useState<PurchaseRequest | null>(null);
  const [targetUid, setTargetUid] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pendingDirection, setPendingDirection] = useState<'grant' | 'deduction' | null>(null);
  const [mutating, setMutating] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; title: string; message?: string } | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBillingError(null);
    setAuditError(null);
    setSystemError(null);
    const [usersResult, logsResult, systemResult, purchasesResult, auditResult] = await Promise.allSettled([
      listAdminUsers(), listAdminLogs(), getSystemStatus(), listAdminPurchases(), listBillingAudit(),
    ]);
    if (usersResult.status === 'fulfilled') {
      setUsers(usersResult.value);
      setTargetUid(current => current || usersResult.value[0]?.uid || '');
    } else setError(requestError(usersResult.reason));
    if (logsResult.status === 'fulfilled') setLogs(logsResult.value);
    else setAuditError(requestError(logsResult.reason));
    if (systemResult.status === 'fulfilled') setSystem(systemResult.value);
    else setSystemError(requestError(systemResult.reason));
    if (purchasesResult.status === 'fulfilled') setPurchases(purchasesResult.value);
    else setBillingError(requestError(purchasesResult.reason));
    if (auditResult.status === 'fulfilled') setBillingAudit(auditResult.value);
    else setAuditError(current => current || requestError(auditResult.reason));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (proofUrl) URL.revokeObjectURL(proofUrl);
  }, [proofUrl]);

  const openProof = async (screenshotId: string) => {
    setProof(null);
    setProofId(screenshotId);
    setProofError(null);
    setProofUrl(current => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setProofLoading(true);
    try {
      const [metadata, content] = await Promise.all([
        getScreenshotMetadata(screenshotId), getScreenshotContent(screenshotId),
      ]);
      setProof(metadata);
      setProofUrl(URL.createObjectURL(content));
    } catch (requestFailure) {
      setProofError(requestError(requestFailure));
    } finally {
      setProofLoading(false);
    }
  };

  const closeProof = () => {
    if (proofUrl) URL.revokeObjectURL(proofUrl);
    setProofUrl(null);
    setProof(null);
    setProofId(null);
    setProofError(null);
  };

  const confirmAdjustment = async () => {
    if (!pendingDirection) return;
    setMutating(true);
    try {
      const result = await adjustUserCredits({
        userId: targetUid,
        amount: Number(amount),
        direction: pendingDirection,
        reason: reason.trim(),
      });
      setFeedback({ tone: 'success', title: 'Credit correction recorded', message: `Available balance: ${result.balance.availableBalance}` });
      setAmount('');
      setReason('');
      setPendingDirection(null);
    } catch (requestFailure) {
      setFeedback({ tone: 'danger', title: 'Credit correction failed', message: requestError(requestFailure) });
      setPendingDirection(null);
    } finally {
      setMutating(false);
    }
  };

  const confirmMatchingCredits = async () => {
    if (!purchaseToCredit) return;
    setMutating(true);
    try {
      await addMatchingPurchaseCredits(purchaseToCredit.id);
      setFeedback({
        tone: 'success',
        title: 'Matching credits added',
        message: `${purchaseToCredit.credits} credits were posted through the existing purchase ledger workflow.`,
      });
      setPurchaseToCredit(null);
      await load();
    } catch (requestFailure) {
      setFeedback({ tone: 'danger', title: 'Credits were not added', message: requestError(requestFailure) });
      setPurchaseToCredit(null);
    } finally {
      setMutating(false);
    }
  };

  const adjustmentValid = Number.isSafeInteger(Number(amount)) && Number(amount) > 0 && Boolean(targetUid && reason.trim());
  const auditEvents = useMemo(() => [
    ...billingAudit.map(event => ({ id: event.id, time: event.occurred_at, type: event.event_type, details: event.resource_type })),
    ...logs.map((event, index) => ({ id: `${event.timestamp}-${index}`, time: event.timestamp, type: event.type, details: JSON.stringify(event.details) })),
  ].sort((a, b) => b.time.localeCompare(a.time)), [billingAudit, logs]);

  const usersContent = loading ? <Skeleton height="16rem" /> : error ? <ErrorPanel title="Users are unavailable" description={error} action={{ label: 'Try again', onClick: () => void load() }} /> : (
    <Card className="admin-table-card">
      <div className="admin-table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>{users.map(user => (
        <tr key={user.uid}><td><strong>{user.displayName || 'Google user'}</strong><small>{user.email}</small></td><td><Badge tone={user.role === 'super_admin' ? 'accent' : 'neutral'}>{user.role}</Badge></td><td><Badge tone={user.status === 'active' ? 'success' : 'danger'}>{user.status}</Badge></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td></tr>
      ))}</tbody></table></div>
      <div className="admin-user-cards" aria-label="User records">{users.map(user => (
        <article className="admin-user-card" key={user.uid}>
          <header>
            <div><strong>{user.displayName || 'Google user'}</strong><small>{user.email}</small></div>
            <Badge tone={user.status === 'active' ? 'success' : 'danger'}>{user.status}</Badge>
          </header>
          <dl>
            <div><dt>Role</dt><dd><Badge tone={user.role === 'super_admin' ? 'accent' : 'neutral'}>{user.role}</Badge></dd></div>
            <div><dt>Plan / credits</dt><dd>Unavailable while billing is disabled</dd></div>
            <div><dt>Last sign-in</dt><dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</dd></div>
          </dl>
          <footer><span>Account actions</span><Badge tone="neutral">Not implemented</Badge></footer>
        </article>
      ))}</div>
      <div className="admin-policy-note"><ShieldCheck size={16} /><span>Bootstrap and last-Super-Admin protections remain enforced by the production authentication service. Pro plan membership never grants administration.</span></div>
    </Card>
  );

  const purchasesContent = loading ? <Skeleton height="16rem" /> : billingError ? <ErrorPanel title="Payment requests are unavailable" description={billingError} /> : purchases.length === 0 ? <EmptyState icon={FileClock} title="No payment requests" /> : (
    <div className="admin-purchase-section">
      <div className="admin-policy-note"><Landmark size={16} /><span>The Owner checks the bank transfer outside Blink, then uses Add matching credits. This changes neither permissions nor billing-plan membership, and no reject flow is presented as the primary workflow.</span></div>
      <div className="admin-purchase-list">{purchases.map(purchase => (
        <Card key={purchase.id} className="admin-purchase-card">
          <div>
            <strong>{purchase.planName}</strong>
            <small>{purchase.credits} credits · {purchase.priceMinor} {purchase.currency} minor units</small>
            <small>User {purchase.userId} · {new Date(purchase.submittedAt).toLocaleString()}</small>
          </div>
          <Badge tone={purchase.status === 'approved' ? 'success' : purchase.status === 'rejected' ? 'danger' : 'warning'}>
            {purchase.status === 'pending' ? 'Awaiting manual check' : purchase.status === 'approved' ? 'Credits added' : 'Rejected (historical)'}
          </Badge>
          <div className="admin-purchase-actions">
            <Button size="sm" variant="secondary" icon={<Paperclip size={15} />} onClick={() => void openProof(purchase.screenshotFileId)}>View proof</Button>
            {purchase.status === 'pending' && <Button size="sm" onClick={() => setPurchaseToCredit(purchase)}>Add matching credits</Button>}
          </div>
        </Card>
      ))}</div>
    </div>
  );

  const packagesContent = <Card title="Credit package management" description="Create, edit, activate, deactivate, archive, reorder, and inspect package audit history using the production package screen."><div className="admin-link-panel"><Package size={24} /><p>Archived packages are immutable and historical financial records are never rewritten.</p><Button onClick={() => navigate('/buy-credits')}>Open package management</Button></div></Card>;

  const creditsContent = <Card title="Manual credit correction" description="Use append-only grants or deductions with a required reason."><div className="admin-adjustment-form"><label><span>User</span><select value={targetUid} onChange={event => setTargetUid(event.target.value)}>{users.map(user => <option key={user.uid} value={user.uid}>{user.displayName || user.email} — {user.email}</option>)}</select></label><Input label="Amount (whole credits)" type="number" min="1" step="1" value={amount} onChange={event => setAmount(event.target.value)} /><Input label="Reason (required)" value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} /><div><Button disabled={!adjustmentValid} onClick={() => setPendingDirection('grant')}>Add credits</Button><Button variant="danger" disabled={!adjustmentValid} onClick={() => setPendingDirection('deduction')}>Deduct credits</Button></div></div></Card>;

  const auditContent = loading ? <Skeleton height="16rem" /> : auditEvents.length === 0 && auditError ? <ErrorPanel title="Audit logs are unavailable" description={auditError} /> : auditEvents.length === 0 ? <EmptyState icon={CircleDot} title="No audit events available" /> : <><Card className="admin-audit-card"><ol>{auditEvents.map(event => <li key={event.id}><CircleDot size={13} /><div><strong>{event.type.replace(/[_\.]/g, ' ')}</strong><span>{event.details}</span><small>{new Date(event.time).toLocaleString()}</small></div></li>)}</ol></Card>{auditError && <div className="admin-policy-note"><CircleDot size={14} /><span>Some audit sources are unavailable: {auditError}</span></div>}</>;

  const systemContent = loading ? <Skeleton height="16rem" /> : system ? <div className="admin-system-grid"><Card><ServerCog size={19} /><strong>{system.status}</strong><span>Application</span></Card><Card><FileClock size={19} /><strong>{Math.floor(system.uptimeSeconds / 60)} min</strong><span>Process uptime</span></Card><Card><Coins size={19} /><strong>{system.nodeVersion}</strong><span>Runtime</span></Card><Card><Landmark size={19} /><strong>{bytes(system.memory.rss)}</strong><span>Resident memory</span></Card></div> : <ErrorPanel title="System status is unavailable" description={systemError || undefined} />;

  const items = [
    { id: 'users', label: 'Users', content: usersContent },
    { id: 'purchases', label: 'Payment proofs', content: purchasesContent },
    { id: 'packages', label: 'Packages', content: packagesContent },
    { id: 'credits', label: 'Credit corrections', content: creditsContent },
    { id: 'audit', label: 'Audit log', content: auditContent },
    { id: 'system', label: 'System status', content: systemContent },
  ];

  return <div className="ds-page-container workspace-page super-admin-page"><header className="workspace-page-header workspace-page-header--action"><div><span className="workspace-eyebrow">Restricted</span><h1>Owner / Super Admin</h1><p>Real operational controls and records available to the protected Owner authority.</p></div><Badge tone="warning"><ShieldCheck size={13} /> super_admin only</Badge></header>{feedback && <Toast {...feedback} onDismiss={() => setFeedback(null)} />}<Tabs items={items} activeId={tab} onChange={id => setTab(id as TabId)} label="Super Admin sections" /><Modal open={proofId !== null} title="Private payment proof" description="View the submitted image, then check the bank independently before adding credits." onClose={closeProof}>{proofLoading ? <div className="admin-proof-loading"><Skeleton height="18rem" /><span>Loading private proof…</span></div> : proofError ? <ErrorPanel title="Payment proof is unavailable" description={proofError} action={proofId ? { label: 'Try again', onClick: () => void openProof(proofId) } : undefined} /> : proof && proofUrl ? <><div className="admin-proof-preview"><img src={proofUrl} alt={`Payment proof: ${proof.originalFilename}`} /></div><dl className="admin-proof-details"><div><dt>File</dt><dd>{proof.originalFilename}</dd></div><div><dt>Status</dt><dd>{proof.status}</dd></div><div><dt>Type</dt><dd>{proof.mimeType}</dd></div><div><dt>Size</dt><dd>{BigInt(proof.sizeBytes).toLocaleString()} bytes</dd></div></dl><a className="admin-proof-download" href={proofUrl} download={`payment-proof.${proof.mimeType.split('/')[1] || 'image'}`}>Download private copy</a></> : null}</Modal><Modal open={purchaseToCredit !== null} title={`Add ${purchaseToCredit?.credits || '0'} matching credits?`} description="Confirm only after checking the bank transfer outside Blink. The existing purchase service will post append-only ledger entries and mark this request as credits added." onClose={() => !mutating && setPurchaseToCredit(null)} footer={<><Button variant="ghost" disabled={mutating} onClick={() => setPurchaseToCredit(null)}>Cancel</Button><Button loading={mutating} onClick={() => void confirmMatchingCredits()}>Confirm add credits</Button></>}><p className="ds-modal-copy">Purchase: {purchaseToCredit?.id}<br />User: {purchaseToCredit?.userId}</p></Modal><Modal open={pendingDirection !== null} title={`${pendingDirection === 'grant' ? 'Add' : 'Deduct'} ${amount || '0'} credits?`} description="This creates a new ledger entry and audit record. Existing entries are not modified." onClose={() => !mutating && setPendingDirection(null)} footer={<><Button variant="ghost" disabled={mutating} onClick={() => setPendingDirection(null)}>Cancel</Button><Button variant={pendingDirection === 'deduction' ? 'danger' : 'primary'} loading={mutating} onClick={() => void confirmAdjustment()}>Confirm correction</Button></>}><p className="ds-modal-copy">Reason: {reason}</p></Modal></div>;
}
