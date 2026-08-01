import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, CheckCircle2, Coins, History, Landmark, Paperclip, Pencil, Plus, ReceiptText, Upload, Wallet } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, Button, Card, EmptyState, ErrorPanel, Input, Modal, Skeleton, Toast } from '../components';
import {
  archiveCreditPackage,
  createCreditPackage,
  editCreditPackage,
  listActiveCreditPackages,
  listCreditPackageAudit,
  listManagedCreditPackages,
  reorderCreditPackages,
  setCreditPackageActive,
  type CreditPackage,
  type CreditPackageAuditEvent,
  type CreditPackageInput,
} from '../creditPackages/api';
import {
  getBillingOverview,
  getPaymentProofConfiguration,
  listPackageBanks,
  submitPurchaseWithProof,
  type BillingBalance,
  type BillingPlan,
  type LedgerEntry,
  type PackageBank,
  type PaymentProofConfiguration,
  type PlanAssignment,
  type PurchaseRequest,
} from '../billing/api';

interface PackageDraft {
  name: string;
  price: string;
  currency: string;
  creditAmount: string;
  bonusCredits: string;
  active: boolean;
  displayOrder: string;
  note: string;
}

interface PendingAction {
  title: string;
  description: string;
  dangerous?: boolean;
  run: () => Promise<unknown>;
}

const emptyDraft = (displayOrder = 0): PackageDraft => ({
  name: '', price: '', currency: 'MMK', creditAmount: '', bonusCredits: '0',
  active: false, displayOrder: String(displayOrder), note: '',
});

const packageDraft = (item: CreditPackage): PackageDraft => ({
  name: item.name,
  price: item.priceMinor ?? item.price,
  currency: item.currency,
  creditAmount: item.creditAmount,
  bonusCredits: item.bonusCredits,
  active: item.active,
  displayOrder: String(item.displayOrder),
  note: item.note ?? '',
});

const toInput = (draft: PackageDraft): CreditPackageInput => ({
  name: draft.name.trim(),
  price: Number(draft.price),
  currency: draft.currency.trim().toUpperCase(),
  creditAmount: Number(draft.creditAmount),
  bonusCredits: Number(draft.bonusCredits),
  active: draft.active,
  displayOrder: Number(draft.displayOrder),
  note: draft.note.trim() || null,
});

const validationError = (draft: PackageDraft) => {
  const values = toInput(draft);
  if (!values.name) return 'Package name is required.';
  if (!/^\p{Lu}{3}$/u.test(values.currency)) return 'Currency must be a 3-letter uppercase code.';
  if (!Number.isSafeInteger(values.price) || values.price < 1) return 'Price must be a positive integer in minor units.';
  if (!Number.isSafeInteger(values.creditAmount) || values.creditAmount < 1) return 'Credit amount must be a positive integer.';
  if (!Number.isSafeInteger(values.bonusCredits) || values.bonusCredits < 0) return 'Bonus credits must be a non-negative integer.';
  if (!Number.isSafeInteger(values.displayOrder) || values.displayOrder < 0) return 'Display order must be a non-negative integer.';
  return null;
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error && 'code' in error && error.code === 'BILLING_NOT_ENABLED') {
    return 'Billing is not enabled in this environment. Package management is unavailable.';
  }
  return error instanceof Error ? error.message : 'Credit package request failed.';
};

const formatAuditEvent = (event: CreditPackageAuditEvent) =>
  event.event_type.replace('credit_package.', '').replace(/_/g, ' ');

export function BuyCreditsPage() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; title: string; message?: string } | null>(null);
  const [editing, setEditing] = useState<CreditPackage | 'new' | null>(null);
  const [draft, setDraft] = useState<PackageDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [mutating, setMutating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [audit, setAudit] = useState<CreditPackageAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [billing, setBilling] = useState<{
    balance: BillingBalance;
    assignment: PlanAssignment | null;
    plans: BillingPlan[];
    ledger: LedgerEntry[];
    purchases: PurchaseRequest[];
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(!isSuperAdmin);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [paymentPackage, setPaymentPackage] = useState<CreditPackage | null>(null);
  const [banks, setBanks] = useState<PackageBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [proofConfig, setProofConfig] = useState<PaymentProofConfiguration | null>(null);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [proofProgress, setProofProgress] = useState(0);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofSubmitted, setProofSubmitted] = useState(false);
  const [proofWorkflowKey, setProofWorkflowKey] = useState(() => crypto.randomUUID());
  const proofInputRef = useRef<HTMLInputElement>(null);

  const loadPackages = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const items = isSuperAdmin ? await listManagedCreditPackages() : await listActiveCreditPackages();
      setPackages(isSuperAdmin ? items : items.filter(item => item.active && !item.archivedAt));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  const loadBilling = useCallback(async () => {
    if (isSuperAdmin) return;
    setBillingLoading(true);
    setBillingError(null);
    try {
      setBilling(await getBillingOverview());
    } catch (error) {
      setBillingError(errorMessage(error));
    } finally {
      setBillingLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => { void loadBilling(); }, [loadBilling]);

  useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const sortedPackages = useMemo(
    () => [...packages].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [packages],
  );
  const reorderable = sortedPackages.filter(item => !item.archivedAt);

  const openCreate = () => {
    const nextOrder = reorderable.reduce((maximum, item) => Math.max(maximum, item.displayOrder), -1) + 1;
    setDraft(emptyDraft(nextOrder));
    setFormError(null);
    setEditing('new');
  };

  const openEdit = (item: CreditPackage) => {
    setDraft(packageDraft(item));
    setFormError(null);
    setEditing(item);
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validationError(draft);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    const values = toInput(draft);
    const creating = editing === 'new';
    const item = editing !== 'new' ? editing : null;
    setFormError(null);
    setEditing(null);
    setPending({
      title: creating ? 'Create credit package?' : 'Save financial changes?',
      description: `${values.name}: ${values.price} ${values.currency} minor units, ${values.creditAmount} credits + ${values.bonusCredits} bonus. Historical transactions will not be changed.`,
      run: () => creating ? createCreditPackage(values) : editCreditPackage(item!.id, values),
    });
  };

  const requestStatus = (item: CreditPackage, active: boolean) => setPending({
    title: `${active ? 'Activate' : 'Deactivate'} ${item.name}?`,
    description: active
      ? 'The package will become visible to normal users. Existing historical transaction values stay unchanged.'
      : 'The package will stop appearing to normal users. Existing historical transaction values stay unchanged.',
    run: () => setCreditPackageActive(item.id, active),
  });

  const requestArchive = (item: CreditPackage) => setPending({
    title: `Archive ${item.name}?`,
    description: 'This package will be deactivated and cannot be edited or reactivated. Historical references will be preserved.',
    dangerous: true,
    run: () => archiveCreditPackage(item.id),
  });

  const requestMove = (item: CreditPackage, direction: -1 | 1) => {
    const index = reorderable.findIndex(candidate => candidate.id === item.id);
    const other = reorderable[index + direction];
    if (!other) return;
    const reordered = [...reorderable];
    [reordered[index], reordered[index + direction]] = [other, item];
    const items = reordered.map((candidate, displayOrder) => ({ id: candidate.id, displayOrder }));
    setPending({
      title: `Change display order for ${item.name}?`,
      description: `Move this package ${direction < 0 ? 'up' : 'down'} in the customer package list. Historical transactions will not be changed.`,
      run: () => reorderCreditPackages(items),
    });
  };

  const confirmAction = async () => {
    if (!pending) return;
    setMutating(true);
    try {
      await pending.run();
      setPending(null);
      setFeedback({ tone: 'success', title: 'Credit packages updated', message: 'The change was saved and audit logged.' });
      await loadPackages();
    } catch (error) {
      setPending(null);
      setFeedback({ tone: 'danger', title: 'Package change failed', message: errorMessage(error) });
    } finally {
      setMutating(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setAuditLoading(true);
    setAuditError(null);
    try {
      setAudit(await listCreditPackageAudit());
    } catch (error) {
      setAuditError(errorMessage(error));
    } finally {
      setAuditLoading(false);
    }
  };

  const openPaymentDetails = async (item: CreditPackage) => {
    setPaymentPackage(item);
    setBanks([]);
    setSelectedBankId('');
    setBanksError(null);
    setProofConfig(null);
    setProofFile(null);
    setProofError(null);
    setProofProgress(0);
    setProofSubmitted(false);
    setProofWorkflowKey(crypto.randomUUID());
    setBanksLoading(true);
    try {
      const [accounts, configuration] = await Promise.all([
        listPackageBanks(item.id), getPaymentProofConfiguration(),
      ]);
      setBanks(accounts);
      setSelectedBankId(accounts[0]?.id || '');
      setProofConfig(configuration);
    } catch (error) {
      setBanksError(errorMessage(error));
    } finally {
      setBanksLoading(false);
    }
  };

  const selectProof = (file: File | null) => {
    setProofError(null);
    setProofSubmitted(false);
    setProofProgress(0);
    setProofWorkflowKey(crypto.randomUUID());
    if (!file) {
      setProofFile(null);
      return;
    }
    if (proofConfig && !proofConfig.mimeTypes.includes(file.type)) {
      setProofFile(null);
      setProofError(`Choose a ${proofConfig.extensions.map(value => value.toUpperCase()).join(', ')} image.`);
      return;
    }
    if (proofConfig && file.size > proofConfig.maxSizeBytes) {
      setProofFile(null);
      setProofError(`Payment proof must be ${proofConfig.maxSizeMb} MB or smaller.`);
      return;
    }
    if (file.size === 0) {
      setProofFile(null);
      setProofError('The selected file is empty.');
      return;
    }
    setProofFile(file);
  };

  const submitProof = async () => {
    if (!paymentPackage || !selectedBankId || !proofFile || proofSubmitting) return;
    setProofSubmitting(true);
    setProofError(null);
    setProofProgress(0);
    try {
      const upload = submitPurchaseWithProof({
        creditPlanId: paymentPackage.id,
        bankAccountId: selectedBankId,
        proof: proofFile,
        idempotencyKey: proofWorkflowKey,
        onProgress: setProofProgress,
      });
      await upload.promise;
      setProofProgress(100);
      setProofSubmitted(true);
      setFeedback({ tone: 'success', title: 'Payment proof submitted', message: 'The Owner will check the bank transfer outside Blink before adding matching credits.' });
      await loadBilling();
    } catch (error) {
      setProofError(errorMessage(error));
    } finally {
      setProofSubmitting(false);
    }
  };

  const closePaymentDetails = () => {
    if (proofSubmitting) return;
    setPaymentPackage(null);
    setProofFile(null);
  };

  return (
    <div className="ds-page-container workspace-page credit-packages-page">
      <header className="workspace-page-header workspace-page-header--action">
        <div>
          <span className="workspace-eyebrow">Billing</span>
          <h1>{isSuperAdmin ? 'Credit Package Management' : 'ခရက်ဒစ် ပက်ကေ့ချ်များ'}</h1>
          <p>{isSuperAdmin
            ? 'Manage package availability and pricing. Pro is a plan and does not grant an administrative role.'
            : 'လက်ရှိ ရရှိနိုင်သော ခရက်ဒစ် ပက်ကေ့ချ်များ။'}</p>
        </div>
        {isSuperAdmin && (
          <div className="credit-packages-header__actions">
            <Button variant="secondary" icon={<History size={17} />} onClick={() => void openHistory()}>Audit history</Button>
            <Button icon={<Plus size={17} />} onClick={openCreate}>Create package</Button>
          </div>
        )}
      </header>

      {feedback && (
        <Toast {...feedback} onDismiss={() => setFeedback(null)} />
      )}

      {!isSuperAdmin && (
        <section className="billing-overview" aria-label="Plans and credit account">
          {billingLoading ? (
            <div className="billing-summary-grid"><Skeleton height="7rem" /><Skeleton height="7rem" /></div>
          ) : billingError ? (
            <ErrorPanel title="Plans and credit account are unavailable" description={billingError} />
          ) : billing && (
            <>
              <div className="billing-summary-grid">
                <Card className="billing-summary-card"><Wallet size={19} /><span>Available credits</span><strong>{BigInt(billing.balance.availableBalance).toLocaleString()}</strong><small>{BigInt(billing.balance.reservedBalance).toLocaleString()} reserved</small></Card>
                <Card className="billing-summary-card"><Coins size={19} /><span>Current plan</span><strong>{billing.assignment?.planName || 'No active plan'}</strong><small>Pro is a plan, never an admin role.</small></Card>
              </div>
              <Card title="Available plans" description="Rates are loaded from the active PostgreSQL plan policies.">
                <div className="billing-plan-list">
                  {billing.plans.map(plan => (
                    <article key={plan.id}>
                      <div><strong>{plan.name}</strong><span>{plan.description || '—'}</span></div>
                      <Badge tone={billing.assignment?.planCode === plan.code ? 'success' : 'neutral'}>{plan.policy.billingMode === 'byok' ? 'BYOK' : 'Blink funded'}</Badge>
                      <small>{plan.policy.creditsPerBlock} credits / {plan.policy.billingBlockSeconds}s block</small>
                    </article>
                  ))}
                </div>
              </Card>
            </>
          )}
        </section>
      )}

      <Card className="credit-packages-card">
        {loading ? (
          <div className="credit-packages-loading" aria-label="Loading credit packages">
            <Skeleton height="5rem" /><Skeleton height="5rem" /><Skeleton height="5rem" />
          </div>
        ) : loadError ? (
          <ErrorPanel title="Credit packages are unavailable" description={loadError} action={{ label: 'Try again', onClick: () => void loadPackages() }} />
        ) : sortedPackages.length === 0 ? (
          <EmptyState
            icon={Coins}
            title={isSuperAdmin ? 'No credit packages yet' : 'လက်ရှိ ရရှိနိုင်သော ပက်ကေ့ချ် မရှိသေးပါ'}
            description={isSuperAdmin ? 'Create the first package when billing is enabled.' : undefined}
            action={isSuperAdmin ? { label: 'Create package', onClick: openCreate } : undefined}
          />
        ) : (
          <div className="credit-packages-list">
            {sortedPackages.map((item) => {
              const activeIndex = reorderable.findIndex(candidate => candidate.id === item.id);
              return (
                <article className={`credit-package ${item.archivedAt ? 'credit-package--archived' : ''}`} key={item.id}>
                  <div className="credit-package__identity">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.priceMinor ?? item.price} {item.currency} <small>minor units</small></span>
                    </div>
                    <Badge tone={item.archivedAt ? 'neutral' : item.active ? 'success' : 'warning'}>
                      {item.archivedAt ? 'Archived' : item.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <dl className="credit-package__facts">
                    <div><dt>Credits</dt><dd>{item.creditAmount}</dd></div>
                    <div><dt>Bonus</dt><dd>{item.bonusCredits}</dd></div>
                    <div><dt>Order</dt><dd>{item.displayOrder}</dd></div>
                    <div><dt>Note</dt><dd>{item.note || '—'}</dd></div>
                  </dl>
                  {isSuperAdmin && (
                    <div className="credit-package__actions" aria-label={`Manage ${item.name}`}>
                      <Button variant="ghost" size="sm" icon={<ArrowUp size={16} />} disabled={Boolean(item.archivedAt) || activeIndex <= 0} onClick={() => requestMove(item, -1)} aria-label={`Move ${item.name} up`}>Up</Button>
                      <Button variant="ghost" size="sm" icon={<ArrowDown size={16} />} disabled={Boolean(item.archivedAt) || activeIndex < 0 || activeIndex >= reorderable.length - 1} onClick={() => requestMove(item, 1)} aria-label={`Move ${item.name} down`}>Down</Button>
                      <Button variant="secondary" size="sm" icon={<Pencil size={16} />} disabled={Boolean(item.archivedAt)} onClick={() => openEdit(item)}>Edit</Button>
                      <Button variant="secondary" size="sm" disabled={Boolean(item.archivedAt)} onClick={() => requestStatus(item, !item.active)}>{item.active ? 'Deactivate' : 'Activate'}</Button>
                      <Button variant="danger" size="sm" icon={<Archive size={16} />} disabled={Boolean(item.archivedAt)} onClick={() => requestArchive(item)}>Archive</Button>
                    </div>
                  )}
                  {!isSuperAdmin && (
                    <div className="credit-package__actions">
                      <Button size="sm" variant="secondary" icon={<Landmark size={16} />} onClick={() => void openPaymentDetails(item)}>Payment details</Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Card>

      {!isSuperAdmin && billing && (
        <div className="billing-history-grid">
          <Card title="Credit ledger" description="Posted credit entries are append-only.">
            {billing.ledger.length === 0 ? <EmptyState icon={ReceiptText} title="No credit entries yet" /> : (
              <ol className="billing-ledger">
                {billing.ledger.map(entry => <li key={entry.id}><div><strong>{entry.reason || entry.entryType.replace(/_/g, ' ')}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></div><span className={entry.amount.startsWith('-') ? 'is-negative' : 'is-positive'}>{entry.amount.startsWith('-') ? '' : '+'}{BigInt(entry.amount).toLocaleString()}</span></li>)}
              </ol>
            )}
          </Card>
          <Card title="Payment proof requests" description="The Owner verifies the real bank transfer outside Blink before adding matching credits.">
            {billing.purchases.length === 0 ? <EmptyState icon={ReceiptText} title="No payment requests yet" description="Select a package, transfer the exact amount, and submit your payment proof." /> : (
              <ol className="billing-purchases">
                {billing.purchases.map(purchase => <li key={purchase.id}><div><strong>{purchase.planName}</strong><small>{purchase.priceMinor} {purchase.currency} minor units · {new Date(purchase.submittedAt).toLocaleString()}</small></div><Badge tone={purchase.status === 'approved' ? 'success' : purchase.status === 'rejected' ? 'danger' : 'warning'}>{purchase.status}</Badge></li>)}
              </ol>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Create credit package' : 'Edit credit package'}
        description="Prices are stored and submitted as integer minor units. Currency is required."
        onClose={() => setEditing(null)}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="credit-package-form">Review changes</Button></>}
      >
        <form id="credit-package-form" className="credit-package-form" onSubmit={submitForm}>
          {formError && <div className="credit-package-form__error" role="alert">{formError}</div>}
          <Input label="Name" value={draft.name} maxLength={100} required onChange={event => setDraft({ ...draft, name: event.target.value })} />
          <div className="credit-package-form__grid">
            <Input label="Price (minor units)" type="number" min="1" step="1" value={draft.price} required onChange={event => setDraft({ ...draft, price: event.target.value })} />
            <Input label="Currency code" value={draft.currency} minLength={3} maxLength={3} required onChange={event => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} />
            <Input label="Credit amount" type="number" min="1" step="1" value={draft.creditAmount} required onChange={event => setDraft({ ...draft, creditAmount: event.target.value })} />
            <Input label="Bonus credits" type="number" min="0" step="1" value={draft.bonusCredits} required onChange={event => setDraft({ ...draft, bonusCredits: event.target.value })} />
            <Input label="Display order" type="number" min="0" step="1" value={draft.displayOrder} required onChange={event => setDraft({ ...draft, displayOrder: event.target.value })} />
          </div>
          <label className="credit-package-form__note">
            <span>Note (optional)</span>
            <textarea value={draft.note} maxLength={1000} rows={3} onChange={event => setDraft({ ...draft, note: event.target.value })} />
          </label>
          <label className="credit-package-form__check">
            <input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />
            <span>Active and visible to normal users</span>
          </label>
        </form>
      </Modal>

      <Modal
        open={pending !== null}
        title={pending?.title ?? 'Confirm package change'}
        description="Confirmation is required for package and financial configuration changes."
        onClose={() => !mutating && setPending(null)}
        footer={<><Button variant="ghost" disabled={mutating} onClick={() => setPending(null)}>Cancel</Button><Button variant={pending?.dangerous ? 'danger' : 'primary'} loading={mutating} onClick={() => void confirmAction()}>Confirm change</Button></>}
      >
        <p className="ds-modal-copy">{pending?.description}</p>
      </Modal>

      <Modal open={historyOpen} title="Credit package audit history" description="Recent package events recorded by the existing audit API." onClose={() => setHistoryOpen(false)}>
        {auditLoading ? <div className="credit-packages-loading"><Skeleton height="3rem" /><Skeleton height="3rem" /></div>
          : auditError ? <ErrorPanel title="Audit history is unavailable" description={auditError} />
            : audit.length === 0 ? <EmptyState icon={History} title="No package audit events found" />
              : <ol className="credit-package-audit">{audit.slice(0, 20).map(event => (
                <li key={event.id}><strong>{formatAuditEvent(event)}</strong><span>{new Date(event.occurred_at).toLocaleString()}</span><small>Actor: {event.actor_user_id}</small></li>
              ))}</ol>}
      </Modal>

      <Modal
        open={paymentPackage !== null}
        title={paymentPackage ? `${paymentPackage.name} payment details` : 'Payment details'}
        description="Transfer the exact amount, then submit an image. The Owner checks the bank outside Blink."
        onClose={closePaymentDetails}
        footer={proofSubmitted ? <Button onClick={closePaymentDetails}>Done</Button> : <><Button variant="ghost" disabled={proofSubmitting} onClick={closePaymentDetails}>Cancel</Button><Button icon={<Upload size={16} />} loading={proofSubmitting} disabled={!selectedBankId || !proofFile || banksLoading || Boolean(banksError)} onClick={() => void submitProof()}>{proofError ? 'Retry submission' : 'Submit proof'}</Button></>}
      >
        {paymentPackage && (
          <div className="billing-payment-summary">
            <span>Exact transfer amount</span>
            <strong>{paymentPackage.priceMinor ?? paymentPackage.price} {paymentPackage.currency} <small>minor units</small></strong>
            <small>{paymentPackage.creditAmount} credits{BigInt(paymentPackage.bonusCredits) > 0n ? ` + ${paymentPackage.bonusCredits} bonus` : ''}</small>
          </div>
        )}
        <ol className="billing-payment-flow" aria-label="Manual payment workflow">
          <li><span>1</span><div><strong>Transfer money</strong><small>Send the exact amount to a configured account below.</small></div></li>
          <li><span>2</span><div><strong>Upload payment proof</strong><small>Choose a private JPEG, PNG, or WebP image below.</small></div></li>
          <li><span>3</span><div><strong>Owner checks the bank</strong><small>Verification happens outside Blink.</small></div></li>
          <li><span>4</span><div><strong>Matching credits are added</strong><small>The Owner confirms an append-only purchase ledger entry.</small></div></li>
        </ol>
        {banksLoading ? <div className="credit-packages-loading"><Skeleton height="4rem" /><Skeleton height="4rem" /></div>
          : banksError ? <ErrorPanel title="Bank details are unavailable" description={banksError} />
            : banks.length === 0 ? <EmptyState icon={Landmark} title="No bank account is configured for this package" />
              : <fieldset className="billing-bank-list"><legend>Select the account you transferred to</legend>{banks.map(bank => <label className={selectedBankId === bank.id ? 'is-selected' : ''} key={bank.id}><input type="radio" name="payment-bank" value={bank.id} checked={selectedBankId === bank.id} disabled={proofSubmitting || proofSubmitted} onChange={() => { setSelectedBankId(bank.id); setProofWorkflowKey(crypto.randomUUID()); }} /><Landmark size={18} /><span><strong>{bank.bank_name}</strong><small>{bank.account_name}</small><code>{bank.account_number}</code><small>{bank.instructions || bank.branch || ''}</small></span></label>)}</fieldset>}
        {!banksLoading && banks.length > 0 && (
          <section className="billing-proof-upload" aria-labelledby="payment-proof-heading">
            <div><strong id="payment-proof-heading">Payment proof image</strong><small>{proofConfig ? `${proofConfig.extensions.map(value => value.toUpperCase()).join(', ')} · maximum ${proofConfig.maxSizeMb} MB` : 'JPEG, PNG, or WebP'}</small></div>
            {proofSubmitted ? (
              <div className="billing-proof-success" role="status"><CheckCircle2 size={20} /><div><strong>Proof submitted</strong><span>Awaiting the Owner’s manual bank check. Credits are not added automatically.</span></div></div>
            ) : (
              <>
                <input ref={proofInputRef} className="billing-proof-input" type="file" accept={proofConfig?.mimeTypes.join(',') || 'image/jpeg,image/png,image/webp'} disabled={proofSubmitting} onChange={event => selectProof(event.target.files?.[0] || null)} />
                <button className="billing-proof-picker" type="button" disabled={proofSubmitting} onClick={() => proofInputRef.current?.click()}>
                  {proofPreviewUrl ? <img src={proofPreviewUrl} alt="Selected payment proof preview" /> : <Paperclip size={22} />}
                  <span><strong>{proofFile?.name || 'Choose screenshot or photo'}</strong><small>{proofFile ? `${(proofFile.size / (1024 * 1024)).toFixed(2)} MB · choose another file` : 'Stored privately after server validation'}</small></span>
                </button>
                {proofSubmitting && <div className="billing-proof-progress" role="status" aria-live="polite"><div><span style={{ width: `${proofProgress}%` }} /></div><small>Uploading payment proof… {proofProgress}%</small></div>}
                {proofError && <div className="billing-proof-error" role="alert"><strong>Proof was not submitted</strong><span>{proofError} Your selected file is retained so you can retry safely.</span></div>}
              </>
            )}
          </section>
        )}
      </Modal>
    </div>
  );
}
