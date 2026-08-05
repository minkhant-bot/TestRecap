import { useCallback, useEffect, useState, useRef } from 'react';
import { Button, Dialog, EmptyState, ErrorPanel, Skeleton, Tabs } from '../components';
import { listActiveCreditPackages, type CreditPackage } from '../creditPackages/api';
import {
  getBillingOverview,
  getMyTrialRequest,
  getPaymentProofConfiguration,
  listPackageBanks,
  purchaseTotalCredits,
  requestTrial,
  submitPurchaseWithProof,
  type BillingBalance,
  type BillingPlan,
  type LedgerEntry,
  type PackageBank,
  type PaymentProofConfiguration,
  type PlanAssignment,
  type PurchaseRequest,
  type TrialRequest,
} from '../billing/api';

type BuyStep = 'bank' | 'proof' | 'submitted';

// Human labels for the raw PurchaseRequest.status enum — matches the wording
// already used on the Owner's equivalent Super Admin purchases view.
const PURCHASE_STATUS_LABEL: Record<PurchaseRequest['status'], string> = {
  pending: 'Awaiting check',
  approved: 'Credits added',
  rejected: 'Rejected',
};

const isBillingDisabledError = (error: unknown) =>
  error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'BILLING_NOT_ENABLED';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Credit package request failed.';

// Display-only equivalent of the existing, unchanged 30-second credit block
// system (1 credit = 30s of source video) — never used for billing, purely
// informational so a credit amount means something concrete at a glance.
// Always fed the TOTAL (base + bonus) credits, never base credits alone.
const formatProcessingMinutes = (credits: string) => {
  const totalSeconds = Number(credits) * 30;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds}s`;
};

// Total granted credits for a catalog package (base + configured bonus).
// Mirrors purchaseTotalCredits(); package cards use base/bonus field names,
// purchase requests use credits/packageBonusCredits.
const packageTotalCredits = (pkg: CreditPackage) =>
  (BigInt(pkg.creditAmount) + BigInt(pkg.bonusCredits || '0')).toString();

// Interaction Rule (CLAUDE.md): the bank -> proof -> submitted purchase flow
// is a popup now, not an inline expanding panel. Step logic/idempotency
// unchanged from the reference's own BuyFlow progression.
function BuyFlow({
  pkg, banks, banksLoading, banksError, proofConfig, step, setStep,
  selectedBankId, setSelectedBankId, proofFile, proofPreviewUrl, selectProof,
  proofProgress, proofError, proofSubmitting, submitProof,
}: {
  pkg: CreditPackage;
  banks: PackageBank[];
  banksLoading: boolean;
  banksError: string | null;
  proofConfig: PaymentProofConfiguration | null;
  step: BuyStep;
  setStep(step: BuyStep): void;
  selectedBankId: string;
  setSelectedBankId(id: string): void;
  proofFile: File | null;
  proofPreviewUrl: string | null;
  selectProof(file: File | null): void;
  proofProgress: number;
  proofError: string | null;
  proofSubmitting: boolean;
  submitProof(): void;
}) {
  const proofInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      {step === 'bank' && (
        <div>
          <p className="muted">Transfer <strong>{pkg.priceMinor ?? pkg.price} {pkg.currency}</strong> to one of these accounts, then continue.</p>
          {banksLoading ? <Skeleton height="4rem" />
            : banksError ? <ErrorPanel title="Bank details are unavailable" description={banksError} />
              : banks.length === 0 ? <EmptyState title="No bank account is configured for this package" />
                : (
                  <div className="stack" style={{ gap: 8 }}>
                    {banks.map(bank => (
                      <label key={bank.id} className="row" style={{ padding: 10, border: `1px solid ${selectedBankId === bank.id ? 'var(--accent)' : 'var(--line2)'}`, borderRadius: 12, cursor: 'pointer' }}>
                        <input type="radio" name="payment-bank" checked={selectedBankId === bank.id} onChange={() => setSelectedBankId(bank.id)} />
                        <span style={{ flex: 1 }}>{bank.bank_name}</span>
                        <code style={{ fontSize: 12, color: 'var(--muted)' }}>{bank.account_number}</code>
                      </label>
                    ))}
                  </div>
                )}
          <div style={{ marginTop: 16 }}>
            <Button disabled={!selectedBankId} onClick={() => setStep('proof')}>I've transferred the money</Button>
          </div>
        </div>
      )}

      {step === 'proof' && (
        <div>
          <p className="muted">Attach a screenshot or photo of the transfer as payment proof.
            {proofConfig && ` ${proofConfig.extensions.map(v => v.toUpperCase()).join(', ')} · maximum ${proofConfig.maxSizeMb} MB.`}
          </p>
          <input ref={proofInputRef} className="sr-only" type="file" accept={proofConfig?.mimeTypes.join(',') || 'image/jpeg,image/png,image/webp'} disabled={proofSubmitting} onChange={event => selectProof(event.target.files?.[0] || null)} />
          <button
            className="uploadpanel panel"
            type="button"
            disabled={proofSubmitting}
            onClick={() => proofInputRef.current?.click()}
            style={{ width: '100%', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
          >
            {proofPreviewUrl ? <img src={proofPreviewUrl} alt="Selected payment proof preview" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 12 }} /> : null}
            <span className="muted">{proofFile ? `${proofFile.name} attached` : 'Click to attach payment proof'}</span>
          </button>
          {proofSubmitting && (
            <div style={{ marginTop: 12 }}>
              <div className="progress"><span style={{ width: `${proofProgress}%` }} /></div>
              <small className="hint">Uploading… {proofProgress}%</small>
            </div>
          )}
          {proofError && <div className="alert error" role="alert" style={{ marginTop: 12 }}>{proofError} Your selected file is retained so you can retry safely.</div>}
          <div style={{ marginTop: 16 }}>
            <Button disabled={!proofFile || proofSubmitting} loading={proofSubmitting} onClick={submitProof}>
              {proofError ? 'Retry submission' : 'Submit for manual review'}
            </Button>
          </div>
        </div>
      )}

      {step === 'submitted' && (
        <div style={{ textAlign: 'center', padding: '8px 0' }}>
          <p style={{ margin: '0 0 16px' }}>✓ The Owner will check the bank account manually outside the app, then add {packageTotalCredits(pkg)} matching credits to your balance. There's no automatic approval step.</p>
        </div>
      )}
    </>
  );
}

export function BuyCreditsPage() {
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [billing, setBilling] = useState<{
    balance: BillingBalance;
    assignment: PlanAssignment | null;
    plans: BillingPlan[];
    ledger: LedgerEntry[];
    purchases: PurchaseRequest[];
  } | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingUnavailable, setBillingUnavailable] = useState(false);
  const [buying, setBuying] = useState<CreditPackage | null>(null);
  const [step, setStep] = useState<BuyStep>('bank');
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
  const [proofWorkflowKey, setProofWorkflowKey] = useState(() => crypto.randomUUID());
  const [trialRequest, setTrialRequest] = useState<TrialRequest | null>(null);
  const [requestingTrial, setRequestingTrial] = useState(false);
  const [trialRequestError, setTrialRequestError] = useState<string | null>(null);
  const [activityTab, setActivityTab] = useState<'ledger' | 'requests'>('ledger');

  const loadPackages = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const items = await listActiveCreditPackages();
      setPackages(items.filter(item => item.active && !item.archivedAt));
    } catch (error) {
      if (isBillingDisabledError(error)) setBillingUnavailable(true);
      else setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      setBilling(await getBillingOverview());
    } catch (error) {
      if (isBillingDisabledError(error)) setBillingUnavailable(true);
      else setBillingError(errorMessage(error));
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => { void loadBilling(); }, [loadBilling]);

  // Rule #1 (frozen): Guest taps "Request Trial" -> pending -> Owner approves.
  useEffect(() => { void getMyTrialRequest().then(setTrialRequest); }, []);

  const submitTrialRequest = async () => {
    if (requestingTrial) return;
    setRequestingTrial(true);
    setTrialRequestError(null);
    try {
      const { request } = await requestTrial();
      setTrialRequest(request);
    } catch (error) {
      setTrialRequestError(errorMessage(error));
    } finally {
      setRequestingTrial(false);
    }
  };

  useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  const closeBuyFlow = () => { if (!proofSubmitting) setBuying(null); };

  const openBuyFlow = async (item: CreditPackage) => {
    setBuying(item);
    setStep('bank');
    setBanks([]);
    setSelectedBankId('');
    setBanksError(null);
    setProofConfig(null);
    setProofFile(null);
    setProofError(null);
    setProofProgress(0);
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
    if (!buying || !selectedBankId || !proofFile || proofSubmitting) return;
    setProofSubmitting(true);
    setProofError(null);
    setProofProgress(0);
    try {
      const upload = submitPurchaseWithProof({
        creditPlanId: buying.id,
        bankAccountId: selectedBankId,
        proof: proofFile,
        idempotencyKey: proofWorkflowKey,
        onProgress: setProofProgress,
      });
      await upload.promise;
      setProofProgress(100);
      setStep('submitted');
      await loadBilling();
    } catch (error) {
      setProofError(errorMessage(error));
    } finally {
      setProofSubmitting(false);
    }
  };

  const ledgerContent = billing?.ledger.length === 0 ? <EmptyState title="No credit entries yet" /> : (
    <div className="stack" style={{ gap: 8 }}>
      {billing?.ledger.map(entry => (
        <div className="row between" key={entry.id}>
          <div><strong>{entry.reason || entry.entryType.replace(/_/g, ' ')}</strong><div className="hint">{new Date(entry.createdAt).toLocaleString()}</div></div>
          <span style={{ color: entry.amount.startsWith('-') ? 'var(--text)' : 'var(--success)' }}>{entry.amount.startsWith('-') ? '' : '+'}{BigInt(entry.amount).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );

  const requestsContent = billing?.purchases.length === 0 ? <EmptyState title="No payment requests yet" description="Select a package, transfer the exact amount, and submit your payment proof." /> : (
    <div className="stack" style={{ gap: 8 }}>
      {billing?.purchases.map(purchase => {
        const totalCredits = purchaseTotalCredits(purchase);
        const hasBonus = BigInt(purchase.packageBonusCredits || '0') > 0n;
        return (
          <div className="row between" key={purchase.id}>
            <div>
              <strong>{purchase.planName} — {totalCredits} credits</strong>
              <div className="hint">
                {hasBonus && `${purchase.credits} base + ${purchase.packageBonusCredits} bonus · `}
                {purchase.priceMinor} {purchase.currency} · {new Date(purchase.submittedAt).toLocaleString()}
              </div>
            </div>
            <span className="chip">{PURCHASE_STATUS_LABEL[purchase.status]}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="pagetitle">
        <div>
          <span className="kicker">BILLING</span>
          <h1>Plans &amp; Credits</h1>
        </div>
        {billing && <span className="chip">{billing.assignment?.planName || 'No plan'}</span>}
      </div>

      {billingUnavailable ? (
        <EmptyState
          title="Plans & Credits aren't available yet"
          description="Billing isn't turned on for this workspace yet."
        />
      ) : (
        <>
          {billingLoading ? (
            <div className="row wrap"><Skeleton height="7rem" /><Skeleton height="7rem" /></div>
          ) : billingError ? (
            <ErrorPanel title="Plans and credit account are unavailable" description={billingError} />
          ) : billing && (
            <div className="statsgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 24 }}>
              <div className="stat"><b>{BigInt(billing.balance.availableBalance).toLocaleString()}</b><span>Available credits · {BigInt(billing.balance.reservedBalance).toLocaleString()} reserved</span></div>
              <div className="stat"><b>{billing.assignment?.planName || 'No plan'}</b><span>Current plan</span></div>
            </div>
          )}

          {billing && !billing.assignment && (
            <div className="panel" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Trial</h3>
              {trialRequest?.status === 'pending' ? (
                <p className="muted">Trial တောင်းဆိုပြီးပါပြီ — Owner အတည်ပြုရန် စောင့်ဆိုင်းနေပါသည်။</p>
              ) : trialRequest?.status === 'approved' ? (
                <p className="muted">Trial အတည်ပြုပြီးပါပြီ — Credits ကြည့်ရန် refresh လုပ်ပါ။</p>
              ) : (
                <>
                  <p className="muted">Blink ကို အခမဲ့ စမ်းကြည့်ပါ — Credit ၁၂ ခု ရရှိမည်၊ ၅ ရက်အတွင်း သက်တမ်းရှိသည်။</p>
                  <Button loading={requestingTrial} disabled={requestingTrial} onClick={() => void submitTrialRequest()}>Trial တောင်းဆိုမည်</Button>
                </>
              )}
              {trialRequestError && <div className="alert error" role="alert" style={{ marginTop: 10 }}>{trialRequestError}</div>}
            </div>
          )}

          <h3>Credit Packages</h3>
          {loading ? (
            <Skeleton height="12rem" />
          ) : loadError ? (
            <ErrorPanel title="Credit packages are unavailable" description={loadError} action={{ label: 'Try again', onClick: () => void loadPackages() }} />
          ) : packages.length === 0 ? (
            <EmptyState title="လက်ရှိ ရရှိနိုင်သော ပက်ကေ့ချ် မရှိသေးပါ" />
          ) : (
            <div className="pricegrid">
              {packages.map(item => {
                const totalCredits = packageTotalCredits(item);
                const minutes = formatProcessingMinutes(totalCredits);
                const hasBonus = BigInt(item.bonusCredits) > 0n;
                return (
                  <div className="price price--compact" key={item.id}>
                    <small>{item.name}</small>
                    <div className="priceCredits">
                      <b>{totalCredits}</b>
                      <span>Credits</span>
                    </div>
                    {hasBonus && <div className="hint">{item.creditAmount} base + {item.bonusCredits} bonus</div>}
                    {minutes && <div className="hint">≈ {minutes} processing</div>}
                    <div className="priceCost">
                      <span className="priceCost__amount">{item.priceMinor ?? item.price}</span>
                      <span className="priceCost__currency">{item.currency}</span>
                    </div>
                    {item.note && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>{item.note}</p>}
                    <Button onClick={() => void openBuyFlow(item)} style={{ width: '100%', marginTop: 12 }}>Buy</Button>
                  </div>
                );
              })}
            </div>
          )}

          {billing && (
            <div className="panel" style={{ marginTop: 24 }}>
              <Tabs
                label="Account activity"
                activeId={activityTab}
                onChange={id => setActivityTab(id as 'ledger' | 'requests')}
                items={[
                  { id: 'ledger', label: 'Credit ledger', content: ledgerContent },
                  { id: 'requests', label: 'My Requests', content: requestsContent },
                ]}
              />
            </div>
          )}
        </>
      )}

      <Dialog
        open={Boolean(buying)}
        onClose={closeBuyFlow}
        busy={proofSubmitting}
        title={buying ? `Buy ${buying.name} — ${packageTotalCredits(buying)} credits` : 'Buy credits'}
      >
        {buying && (
          <BuyFlow
            pkg={buying}
            banks={banks}
            banksLoading={banksLoading}
            banksError={banksError}
            proofConfig={proofConfig}
            step={step}
            setStep={setStep}
            selectedBankId={selectedBankId}
            setSelectedBankId={setSelectedBankId}
            proofFile={proofFile}
            proofPreviewUrl={proofPreviewUrl}
            selectProof={selectProof}
            proofProgress={proofProgress}
            proofError={proofError}
            proofSubmitting={proofSubmitting}
            submitProof={() => void submitProof()}
          />
        )}
        {step === 'submitted' && (
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <Button variant="secondary" onClick={closeBuyFlow}>Done</Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
