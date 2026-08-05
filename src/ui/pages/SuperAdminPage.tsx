import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import {
  addMatchingPurchaseCredits, adjustUserCredits, approveTrialRequest, getScreenshotContent, getScreenshotMetadata,
  getSystemStatus, listAdminLogs, listAdminPurchases, listAdminUsers, listBillingAudit, listTrialRequests,
  rejectPurchase, updateUserAccess,
  type AdminAuditEvent, type AdminUser, type BillingAuditEvent,
  type ScreenshotMetadata, type SystemStatus,
} from '../admin/api';
import {
  archiveCreditPackage, configureBank, configurePlan, createCreditPackage, createPlanPolicy,
  editCreditPackage, linkPackageBank, listCreditPackageAudit, listManagedBankAccounts,
  listManagedCreditPackages, listManagedPlans, reorderCreditPackages, setCreditPackageActive,
  type BankAccount, type CommercialPlan, type CreditPackage, type CreditPackageAuditEvent, type CreditPackageInput,
} from '../creditPackages/api';
import { purchaseTotalCredits, type PurchaseRequest, type TrialRequest } from '../billing/api';
import { Button, ConfirmBody, Dialog, EmptyState, ErrorPanel, Input, Skeleton, StatCard, Tabs } from '../components';
import { JobList } from '../workspace/JobList';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';

type TabId = 'overview' | 'users' | 'trial' | 'purchases' | 'packages' | 'credits' | 'audit' | 'system';

interface PackageDraft {
  name: string; price: string; currency: string; creditAmount: string;
  bonusCredits: string; active: boolean; displayOrder: string; note: string;
}

interface PendingPackageAction {
  title: string; description: string; dangerous?: boolean; run: () => Promise<unknown>;
}

const emptyDraft = (displayOrder = 0): PackageDraft => ({
  name: '', price: '', currency: 'MMK', creditAmount: '', bonusCredits: '0',
  active: false, displayOrder: String(displayOrder), note: '',
});

const packageDraft = (item: CreditPackage): PackageDraft => ({
  name: item.name, price: item.priceMinor ?? item.price, currency: item.currency,
  creditAmount: item.creditAmount, bonusCredits: item.bonusCredits, active: item.active,
  displayOrder: String(item.displayOrder), note: item.note ?? '',
});

const toInput = (draft: PackageDraft): CreditPackageInput => ({
  name: draft.name.trim(), price: Number(draft.price), currency: draft.currency.trim().toUpperCase(),
  creditAmount: Number(draft.creditAmount), bonusCredits: Number(draft.bonusCredits),
  active: draft.active, displayOrder: Number(draft.displayOrder), note: draft.note.trim() || null,
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

interface PlanDraft {
  name: string; description: string; active: boolean; displayOrder: string;
  creditsPerBlock: string; version: string;
}
const PLAN_LABEL: Record<'trial' | 'pro', string> = { trial: 'Trial', pro: 'Pro' };
const emptyPlanDraft = (code: 'trial' | 'pro'): PlanDraft => ({
  name: PLAN_LABEL[code], description: '', active: true, displayOrder: '0',
  creditsPerBlock: '1', version: '1',
});
const planDraftFromExisting = (plan: CommercialPlan): PlanDraft => ({
  name: plan.name, description: plan.description, active: plan.active,
  displayOrder: String(plan.displayOrder), creditsPerBlock: '1', version: '1',
});
const planValidationError = (draft: PlanDraft) => {
  if (!draft.name.trim()) return 'Plan name is required.';
  const displayOrder = Number(draft.displayOrder);
  const creditsPerBlock = Number(draft.creditsPerBlock);
  const version = Number(draft.version);
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) return 'Display order must be a non-negative integer.';
  if (!Number.isSafeInteger(creditsPerBlock) || creditsPerBlock < 1) return 'Credits per 30-second block must be a positive integer.';
  if (!Number.isSafeInteger(version) || version < 1) return 'Policy version must be a positive integer.';
  return null;
};

interface BankDraft {
  code: string; bankName: string; accountName: string; accountNumber: string;
  branch: string; currency: string; instructions: string; active: boolean; displayOrder: string;
}
const emptyBankDraft = (): BankDraft => ({
  code: '', bankName: '', accountName: '', accountNumber: '',
  branch: '', currency: 'MMK', instructions: '', active: true, displayOrder: '0',
});
const bankDraftFromExisting = (bank: BankAccount): BankDraft => ({
  code: bank.code, bankName: bank.bank_name, accountName: bank.account_name,
  accountNumber: bank.account_number, branch: bank.branch ?? '', currency: bank.currency,
  instructions: bank.instructions, active: bank.active, displayOrder: String(bank.display_order),
});
const bankValidationError = (draft: BankDraft) => {
  if (!draft.code.trim()) return 'Bank code is required.';
  if (!draft.bankName.trim()) return 'Bank name is required.';
  if (!draft.accountName.trim()) return 'Account name is required.';
  if (!draft.accountNumber.trim()) return 'Account number is required.';
  if (!/^[A-Z]{3}$/.test(draft.currency.trim().toUpperCase())) return 'Currency must be a 3-letter uppercase code.';
  const displayOrder = Number(draft.displayOrder);
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) return 'Display order must be a non-negative integer.';
  return null;
};

const requestError = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const bytes = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MB`;

// Both the Users directory and the Credits user-picker need the same
// name/email search + incrementally-rendered result list: the backend
// `/api/admin/users` contract returns the full roster in one call (no
// server-side search/pagination params to preserve), so scalability for
// large rosters is handled client-side — filter the already-fetched array,
// then only render a growing page of it instead of every row at once.
const USER_PAGE_SIZE = 20;
const filterUsers = (list: AdminUser[], query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(user =>
    (user.displayName || '').toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle));
};

// Human labels for raw role/status enum values — never show the underlying
// identifier (e.g. "super_admin", "active") directly in the UI.
const ROLE_LABEL: Record<AdminUser['role'], string> = { user: 'User', admin: 'Admin', super_admin: 'Owner' };
const USER_STATUS_LABEL: Record<AdminUser['status'], string> = { active: 'Active', disabled: 'Banned' };
const ROLE_OPTIONS: AdminUser['role'][] = ['user', 'admin', 'super_admin'];

// Confirmation body rendered inside a Dialog — the Dialog itself supplies
// the title, close control, and backdrop/scroll-lock chrome.
export function SuperAdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<TabId>('overview');
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
  const [purchaseToReject, setPurchaseToReject] = useState<PurchaseRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [trialRequests, setTrialRequests] = useState<TrialRequest[]>([]);
  const [trialRequestsLoading, setTrialRequestsLoading] = useState(true);
  const [trialRequestsError, setTrialRequestsError] = useState<string | null>(null);
  const [approvingTrialId, setApprovingTrialId] = useState<string | null>(null);
  const [trialToApprove, setTrialToApprove] = useState<TrialRequest | null>(null);
  const [managingUser, setManagingUser] = useState<AdminUser | null>(null);
  const [roleDraft, setRoleDraft] = useState<AdminUser['role']>('user');
  const [userStep, setUserStep] = useState<'edit' | 'confirmRole' | 'confirmBan' | 'confirmUnban'>('edit');
  const [userMutating, setUserMutating] = useState(false);
  const [targetUid, setTargetUid] = useState('');
  const [usersQuery, setUsersQuery] = useState('');
  const [usersVisibleCount, setUsersVisibleCount] = useState(USER_PAGE_SIZE);
  const [creditsQuery, setCreditsQuery] = useState('');
  const [creditsVisibleCount, setCreditsVisibleCount] = useState(USER_PAGE_SIZE);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pendingDirection, setPendingDirection] = useState<'grant' | 'deduction' | null>(null);
  const [mutating, setMutating] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; title: string; message?: string } | null>(null);

  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CreditPackage | 'new' | null>(null);
  const [draft, setDraft] = useState<PackageDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingPackage, setPendingPackage] = useState<PendingPackageAction | null>(null);
  const [packageMutating, setPackageMutating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [audit, setAudit] = useState<CreditPackageAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [packageAuditError, setPackageAuditError] = useState<string | null>(null);

  const [plans, setPlans] = useState<CommercialPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planEditing, setPlanEditing] = useState<'trial' | 'pro' | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(emptyPlanDraft('trial'));
  const [planMutating, setPlanMutating] = useState(false);
  const [planFormError, setPlanFormError] = useState<string | null>(null);

  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [banksError, setBanksError] = useState<string | null>(null);
  const [bankEditing, setBankEditing] = useState<BankAccount | 'new' | null>(null);
  const [bankDraft, setBankDraft] = useState<BankDraft>(emptyBankDraft());
  const [bankMutating, setBankMutating] = useState(false);
  const [bankFormError, setBankFormError] = useState<string | null>(null);
  const [linkPackageChoice, setLinkPackageChoice] = useState<Record<string, string>>({});
  const [linkingBankId, setLinkingBankId] = useState<string | null>(null);

  const { jobs: recentJobs, loading: jobsLoading } = useWorkspaceJobs(5);

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

  const loadTrialRequests = useCallback(async () => {
    setTrialRequestsLoading(true);
    setTrialRequestsError(null);
    try {
      setTrialRequests(await listTrialRequests());
    } catch (requestFailure) {
      setTrialRequestsError(requestError(requestFailure));
    } finally {
      setTrialRequestsLoading(false);
    }
  }, []);
  useEffect(() => { void loadTrialRequests(); }, [loadTrialRequests]);

  const loadPackages = useCallback(async () => {
    setPackagesLoading(true);
    setPackagesError(null);
    try {
      setPackages(await listManagedCreditPackages());
    } catch (error) {
      setPackagesError(requestError(error));
    } finally {
      setPackagesLoading(false);
    }
  }, []);

  useEffect(() => { void loadPackages(); }, [loadPackages]);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      setPlans(await listManagedPlans());
    } catch (error) {
      setPlansError(requestError(error));
    } finally {
      setPlansLoading(false);
    }
  }, []);
  useEffect(() => { void loadPlans(); }, [loadPlans]);

  const loadBanks = useCallback(async () => {
    setBanksLoading(true);
    setBanksError(null);
    try {
      setBanks(await listManagedBankAccounts());
    } catch (error) {
      setBanksError(requestError(error));
    } finally {
      setBanksLoading(false);
    }
  }, []);
  useEffect(() => { void loadBanks(); }, [loadBanks]);

  useEffect(() => () => {
    if (proofUrl) URL.revokeObjectURL(proofUrl);
  }, [proofUrl]);

  const openProof = async (screenshotId: string) => {
    setPurchaseToCredit(null);
    setPurchaseToReject(null);
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
      const result = await adjustUserCredits({ userId: targetUid, amount: Number(amount), direction: pendingDirection, reason: reason.trim() });
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
      const result = await addMatchingPurchaseCredits(purchaseToCredit.id);
      const totalCredits = purchaseTotalCredits(purchaseToCredit);
      setFeedback({
        tone: 'success', title: 'Credits added',
        message: result.proAssignment
          ? `${totalCredits} credits were posted and the user was assigned Pro.`
          : `${totalCredits} credits were posted through the existing purchase ledger workflow.`,
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

  const confirmRejectPurchase = async () => {
    if (!purchaseToReject || !rejectReason.trim()) return;
    setMutating(true);
    try {
      await rejectPurchase(purchaseToReject.id, rejectReason.trim());
      setFeedback({ tone: 'success', title: 'Purchase rejected', message: 'No credits were added.' });
      setPurchaseToReject(null);
      setRejectReason('');
      await load();
    } catch (requestFailure) {
      setFeedback({ tone: 'danger', title: 'Purchase could not be rejected', message: requestError(requestFailure) });
    } finally {
      setMutating(false);
    }
  };

  const confirmApproveTrial = async (request: TrialRequest) => {
    if (approvingTrialId) return;
    setApprovingTrialId(request.id);
    try {
      await approveTrialRequest(request.id);
      setFeedback({ tone: 'success', title: 'Trial approved', message: '12 credits granted, expiring in 120 hours.' });
      setTrialToApprove(null);
      await loadTrialRequests();
    } catch (requestFailure) {
      setFeedback({ tone: 'danger', title: 'Trial could not be approved', message: requestError(requestFailure) });
    } finally {
      setApprovingTrialId(null);
    }
  };

  // Rule #7 (frozen): banning suspends Firebase sign-in immediately (no new
  // session can be issued), which is what blocks job/Trial/purchase creation
  // — without touching jobs already in flight. Role-hierarchy, self-lockout,
  // and bootstrap/last-Owner protections are all enforced server-side; this
  // client only surfaces whatever message that enforcement returns.
  const openManageUser = (user: AdminUser) => {
    setManagingUser(user);
    setRoleDraft(user.role);
    setUserStep('edit');
  };
  const closeManageUser = () => { if (!userMutating) { setManagingUser(null); setUserStep('edit'); } };
  const submitUserChange = async (input: { role: AdminUser['role']; status: AdminUser['status'] }) => {
    if (!managingUser) return;
    setUserMutating(true);
    try {
      const updated = await updateUserAccess(managingUser.uid, input);
      setUsers(current => current.map(user => (user.uid === updated.uid ? updated : user)));
      setFeedback({ tone: 'success', title: 'User access updated', message: `${updated.displayName || updated.email}: ${ROLE_LABEL[updated.role]} · ${USER_STATUS_LABEL[updated.status]}.` });
      setManagingUser(null);
    } catch (requestFailure) {
      setFeedback({ tone: 'danger', title: 'User access was not updated', message: requestError(requestFailure) });
    } finally {
      setUserMutating(false);
      setUserStep('edit');
    }
  };

  const sortedPackages = useMemo(
    () => [...packages].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [packages],
  );
  const reorderablePackages = sortedPackages.filter(item => !item.archivedAt);

  const openPlanConfig = (code: 'trial' | 'pro') => {
    const existing = plans.find(item => item.code === code);
    setPlanDraft(existing ? planDraftFromExisting(existing) : emptyPlanDraft(code));
    setPlanFormError(null);
    setPlanEditing(code);
  };
  const submitPlanForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!planEditing) return;
    const invalid = planValidationError(planDraft);
    if (invalid) { setPlanFormError(invalid); return; }
    setPlanFormError(null);
    setPlanMutating(true);
    try {
      await configurePlan(planEditing, {
        name: planDraft.name.trim(), description: planDraft.description.trim(),
        active: planDraft.active, displayOrder: Number(planDraft.displayOrder),
      });
      await createPlanPolicy(planEditing, {
        version: Number(planDraft.version), creditsPerBlock: Number(planDraft.creditsPerBlock),
      });
      setFeedback({ tone: 'success', title: `${PLAN_LABEL[planEditing]} plan configured`, message: `${planDraft.creditsPerBlock} credits per 30-second block.` });
      setPlanEditing(null);
      await loadPlans();
    } catch (requestFailure) {
      setPlanFormError(requestError(requestFailure));
    } finally {
      setPlanMutating(false);
    }
  };

  const openBankCreate = () => {
    setBankDraft(emptyBankDraft());
    setBankFormError(null);
    setBankEditing('new');
  };
  const openBankEdit = (bank: BankAccount) => {
    setBankDraft(bankDraftFromExisting(bank));
    setBankFormError(null);
    setBankEditing(bank);
  };
  const submitBankForm = async (event: FormEvent) => {
    event.preventDefault();
    const invalid = bankValidationError(bankDraft);
    if (invalid) { setBankFormError(invalid); return; }
    setBankFormError(null);
    setBankMutating(true);
    try {
      await configureBank(bankDraft.code.trim(), {
        bankName: bankDraft.bankName.trim(), accountName: bankDraft.accountName.trim(),
        accountNumber: bankDraft.accountNumber.trim(), branch: bankDraft.branch.trim() || null,
        currency: bankDraft.currency.trim().toUpperCase(), instructions: bankDraft.instructions.trim(),
        active: bankDraft.active, displayOrder: Number(bankDraft.displayOrder),
      });
      setFeedback({ tone: 'success', title: 'Bank account saved', message: `${bankDraft.bankName}: ${bankDraft.currency.toUpperCase()}.` });
      setBankEditing(null);
      await loadBanks();
    } catch (requestFailure) {
      setBankFormError(requestError(requestFailure));
    } finally {
      setBankMutating(false);
    }
  };
  const linkBankToPackage = async (bank: BankAccount, active: boolean) => {
    const packageId = linkPackageChoice[bank.id];
    if (!packageId) return;
    setLinkingBankId(bank.id);
    try {
      await linkPackageBank(packageId, bank.id, active);
      const packageName = packages.find(item => item.id === packageId)?.name ?? 'package';
      setFeedback({ tone: 'success', title: active ? 'Bank linked' : 'Bank unlinked', message: `${bank.bank_name} · ${packageName}.` });
    } catch (requestFailure) {
      setFeedback({ tone: 'danger', title: 'Bank link was not updated', message: requestError(requestFailure) });
    } finally {
      setLinkingBankId(null);
    }
  };

  const filteredUsers = useMemo(() => filterUsers(users, usersQuery), [users, usersQuery]);
  const visibleUsers = filteredUsers.slice(0, usersVisibleCount);
  const filteredCreditUsers = useMemo(() => filterUsers(users, creditsQuery), [users, creditsQuery]);
  const visibleCreditUsers = filteredCreditUsers.slice(0, creditsVisibleCount);
  const selectedCreditUser = users.find(user => user.uid === targetUid) ?? null;
  const selectCreditUser = (uid: string) => { setTargetUid(uid); setAmount(''); setReason(''); };
  const clearCreditUser = () => { setTargetUid(''); setCreditsQuery(''); setCreditsVisibleCount(USER_PAGE_SIZE); setAmount(''); setReason(''); };

  const openCreate = () => {
    const nextOrder = reorderablePackages.reduce((maximum, item) => Math.max(maximum, item.displayOrder), -1) + 1;
    setDraft(emptyDraft(nextOrder));
    setFormError(null);
    setPendingPackage(null);
    setHistoryOpen(false);
    setEditing('new');
  };
  const openEdit = (item: CreditPackage) => {
    setDraft(packageDraft(item));
    setFormError(null);
    setPendingPackage(null);
    setHistoryOpen(false);
    setEditing(item);
  };
  const submitPackageForm = (event: FormEvent) => {
    event.preventDefault();
    const invalid = validationError(draft);
    if (invalid) { setFormError(invalid); return; }
    const values = toInput(draft);
    const creating = editing === 'new';
    const item = editing !== 'new' ? editing : null;
    setFormError(null);
    setEditing(null);
    setPendingPackage({
      title: creating ? 'Create credit package?' : 'Save financial changes?',
      description: `${values.name}: ${values.price} ${values.currency} minor units, ${values.creditAmount} credits + ${values.bonusCredits} bonus.`,
      run: () => creating ? createCreditPackage(values) : editCreditPackage(item!.id, values),
    });
  };
  const requestPackageStatus = (item: CreditPackage, active: boolean) => { setEditing(null); setHistoryOpen(false); setPendingPackage({
    title: `${active ? 'Activate' : 'Deactivate'} ${item.name}?`,
    description: 'Historical transaction values stay unchanged.',
    run: () => setCreditPackageActive(item.id, active),
  }); };
  const requestPackageArchive = (item: CreditPackage) => { setEditing(null); setHistoryOpen(false); setPendingPackage({
    title: `Archive ${item.name}?`,
    description: 'This package will be deactivated and cannot be edited or reactivated.',
    dangerous: true,
    run: () => archiveCreditPackage(item.id),
  }); };
  const requestPackageMove = (item: CreditPackage, direction: -1 | 1) => {
    const index = reorderablePackages.findIndex(candidate => candidate.id === item.id);
    const other = reorderablePackages[index + direction];
    if (!other) return;
    const reordered = [...reorderablePackages];
    [reordered[index], reordered[index + direction]] = [other, item];
    const items = reordered.map((candidate, displayOrder) => ({ id: candidate.id, displayOrder }));
    setEditing(null);
    setHistoryOpen(false);
    setPendingPackage({
      title: `Change display order for ${item.name}?`,
      description: `Move this package ${direction < 0 ? 'up' : 'down'} in the customer package list.`,
      run: () => reorderCreditPackages(items),
    });
  };
  const confirmPackageAction = async () => {
    if (!pendingPackage) return;
    setPackageMutating(true);
    try {
      await pendingPackage.run();
      setPendingPackage(null);
      setFeedback({ tone: 'success', title: 'Credit packages updated', message: 'The change was saved and audit logged.' });
      await loadPackages();
    } catch (error) {
      setPendingPackage(null);
      setFeedback({ tone: 'danger', title: 'Package change failed', message: requestError(error) });
    } finally {
      setPackageMutating(false);
    }
  };
  const openPackageHistory = async () => {
    setEditing(null);
    setPendingPackage(null);
    setHistoryOpen(true);
    setAuditLoading(true);
    setPackageAuditError(null);
    try {
      setAudit(await listCreditPackageAudit());
    } catch (error) {
      setPackageAuditError(requestError(error));
    } finally {
      setAuditLoading(false);
    }
  };

  const adjustmentValid = Number.isSafeInteger(Number(amount)) && Number(amount) > 0 && Boolean(targetUid && reason.trim());
  // Owner/Admin audit view shows sanitized operational status only -- the
  // billing-audit resource type is a clean label already; the legacy
  // in-memory log payload is an arbitrary internal object and is
  // deliberately never dumped raw here.
  const auditEvents = useMemo(() => [
    ...billingAudit.map(event => ({ id: event.id, time: event.occurred_at, type: event.event_type, details: event.resource_type })),
    ...logs.map((event, index) => ({ id: `${event.timestamp}-${index}`, time: event.timestamp, type: event.type, details: '' })),
  ].sort((a, b) => b.time.localeCompare(a.time)), [billingAudit, logs]);
  const activeJobs = recentJobs.filter(job => ['pending', 'queued', 'processing'].includes(job.status)).length;
  const pendingPurchases = purchases.filter(purchase => purchase.status === 'pending').length;

  const overviewContent = (
    <>
      <div className="adminGrid" style={{ marginBottom: 20 }}>
        <StatCard variant="adminCard" value={jobsLoading ? '…' : activeJobs} label="Active jobs" />
        <StatCard variant="adminCard" value={loading ? '…' : users.length} label="Registered users" />
        <StatCard variant="adminCard" value={loading ? '…' : pendingPurchases} label="Awaiting manual credit" />
        <StatCard variant="adminCard" value={system?.status ?? '—'} label="Application status" />
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Recent workspace jobs</h3>
        {jobsLoading ? <Skeleton height="4.5rem" />
          : recentJobs.length === 0 ? <EmptyState title="No jobs yet" />
            : <JobList jobs={recentJobs} compact />}
      </div>
    </>
  );

  const usersContent = loading ? <Skeleton height="16rem" /> : error ? <ErrorPanel title="Users are unavailable" description={error} action={{ label: 'Try again', onClick: () => void load() }} /> : (
    <>
      <div style={{ maxWidth: 360 }}>
        <Input
          label="Search users"
          type="search"
          placeholder="Name or email"
          value={usersQuery}
          onChange={event => { setUsersQuery(event.target.value); setUsersVisibleCount(USER_PAGE_SIZE); }}
        />
      </div>
      {filteredUsers.length === 0 ? <EmptyState title="No matching users" /> : (
        <>
          <div className="adminTable">{visibleUsers.map(user => (
            <div className="adminRow" key={user.uid}>
              <div><strong>{user.displayName || 'Google user'}</strong><small>{user.email}</small></div>
              <span><i className={`statusDot ${user.role === 'super_admin' ? '' : 'warn'}`} />{ROLE_LABEL[user.role]}</span>
              <span><i className={`statusDot ${user.status === 'active' ? '' : 'bad'}`} />{USER_STATUS_LABEL[user.status]}</span>
              <div className="adminActions">
                <small>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</small>
                <Button variant="secondary" onClick={() => openManageUser(user)}>Manage</Button>
              </div>
            </div>
          ))}</div>
          <div className="row between wrap" style={{ marginTop: 12 }}>
            <small className="hint">Showing {visibleUsers.length} of {filteredUsers.length} users</small>
            {filteredUsers.length > visibleUsers.length && (
              <Button variant="secondary" onClick={() => setUsersVisibleCount(count => count + USER_PAGE_SIZE)}>Load more</Button>
            )}
          </div>
        </>
      )}
      <p className="hint" style={{ marginTop: 12 }}>Bootstrap and last-Super-Admin protections remain enforced by the production authentication service. Pro plan membership never grants administration.</p>

      <Dialog
        open={managingUser !== null}
        onClose={closeManageUser}
        busy={userMutating}
        title={managingUser ? `Manage ${managingUser.displayName || managingUser.email}` : 'Manage user'}
      >
        {managingUser && (() => {
          const isSelf = managingUser.uid === profile?.uid;
          const roleChanged = roleDraft !== managingUser.role;
          if (userStep === 'confirmRole') return (
            <ConfirmBody
              description={`Change ${managingUser.displayName || managingUser.email} to ${ROLE_LABEL[roleDraft]}?`}
              busy={userMutating}
              confirmLabel="Confirm role change"
              onConfirm={() => void submitUserChange({ role: roleDraft, status: managingUser.status })}
              onCancel={() => setUserStep('edit')}
            />
          );
          if (userStep === 'confirmBan') return (
            <ConfirmBody
              description={`Ban ${managingUser.displayName || managingUser.email}? They will be signed out and unable to sign in, create jobs, request Trial, or submit purchases. Jobs already running are not interrupted.`}
              dangerous
              busy={userMutating}
              confirmLabel="Confirm ban"
              onConfirm={() => void submitUserChange({ role: managingUser.role, status: 'disabled' })}
              onCancel={() => setUserStep('edit')}
            />
          );
          if (userStep === 'confirmUnban') return (
            <ConfirmBody
              description={`Unban ${managingUser.displayName || managingUser.email}? They will be able to sign in again immediately.`}
              busy={userMutating}
              confirmLabel="Confirm unban"
              onConfirm={() => void submitUserChange({ role: managingUser.role, status: 'active' })}
              onCancel={() => setUserStep('edit')}
            />
          );
          return (
            <>
              {isSelf && <p className="hint" style={{ marginTop: 0 }}>You cannot change your own role or access.</p>}
              <label className="field">
                <span>Role</span>
                <select value={roleDraft} disabled={isSelf} onChange={event => setRoleDraft(event.target.value as AdminUser['role'])}>
                  {ROLE_OPTIONS.map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                </select>
              </label>
              <div className="row wrap">
                <Button disabled={isSelf || !roleChanged} onClick={() => setUserStep('confirmRole')}>Save role</Button>
                <Button
                  variant={managingUser.status === 'active' ? 'danger' : 'secondary'}
                  disabled={isSelf}
                  onClick={() => setUserStep(managingUser.status === 'active' ? 'confirmBan' : 'confirmUnban')}
                >
                  {managingUser.status === 'active' ? 'Ban user' : 'Unban user'}
                </Button>
              </div>
            </>
          );
        })()}
      </Dialog>
    </>
  );

  // Rule #1 (frozen): no eligibility questionnaire — just a pending request
  // the Owner approves. Approval grants exactly 12 credits, expiring in 120
  // hours (handled entirely server-side).
  const planConfigPanel = (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Trial / Pro plan configuration</h3>
      {plansLoading ? <Skeleton height="4rem" /> : plansError ? (
        <ErrorPanel title="Plan configuration is unavailable" description={plansError} action={{ label: 'Try again', onClick: () => void loadPlans() }} />
      ) : (
        <div className="adminTable">
          {(['trial', 'pro'] as const).map(code => {
            const plan = plans.find(item => item.code === code);
            return (
              <div className="adminRow" key={code}>
                <div><strong>{PLAN_LABEL[code]}</strong><small>{plan ? plan.name : 'Not configured yet'}</small></div>
                <span><i className={`statusDot ${plan?.active ? '' : 'warn'}`} />{plan?.active ? 'Active' : plan ? 'Inactive' : 'Not configured'}</span>
                <div className="adminActions">
                  <Button variant="secondary" onClick={() => openPlanConfig(code)}>{plan ? 'Edit' : 'Configure'}</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={planEditing !== null} onClose={() => { if (!planMutating) setPlanEditing(null); }} busy={planMutating} title={planEditing ? `Configure ${PLAN_LABEL[planEditing]} plan` : 'Configure plan'}>
        <form onSubmit={event => void submitPlanForm(event)}>
          {planFormError && <div className="alert error" role="alert" style={{ marginBottom: 12 }}>{planFormError}</div>}
          <Input label="Name" value={planDraft.name} maxLength={100} required onChange={event => setPlanDraft({ ...planDraft, name: event.target.value })} />
          <label className="field">
            <span>Description (optional)</span>
            <textarea value={planDraft.description} maxLength={1000} rows={2} onChange={event => setPlanDraft({ ...planDraft, description: event.target.value })} />
          </label>
          <div className="packageFormGrid">
            <Input label="Credits per 30-second block" type="number" min="1" step="1" value={planDraft.creditsPerBlock} required onChange={event => setPlanDraft({ ...planDraft, creditsPerBlock: event.target.value })} />
            <Input label="Policy version" type="number" min="1" step="1" value={planDraft.version} required onChange={event => setPlanDraft({ ...planDraft, version: event.target.value })} />
            <Input label="Display order" type="number" min="0" step="1" value={planDraft.displayOrder} required onChange={event => setPlanDraft({ ...planDraft, displayOrder: event.target.value })} />
          </div>
          <p className="hint">{planEditing === 'trial' ? 'BYOK only -- Blur and Flip stay off for Trial.' : 'Blink-funded -- Blur and Flip are included for Pro.'} This is fixed by product rule and is not editable here.</p>
          <label className="checkline">
            <input type="checkbox" checked={planDraft.active} onChange={event => setPlanDraft({ ...planDraft, active: event.target.checked })} />
            Active
          </label>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Button type="submit" loading={planMutating} disabled={planMutating}>Save plan</Button>
            <Button type="button" variant="ghost" disabled={planMutating} onClick={() => setPlanEditing(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );

  const trialContent = (
    <>
      {planConfigPanel}
      {trialRequestsLoading ? <Skeleton height="16rem" /> : trialRequestsError ? <ErrorPanel title="Trial requests are unavailable" description={trialRequestsError} action={{ label: 'Try again', onClick: () => void loadTrialRequests() }} /> : trialRequests.length === 0 ? <EmptyState title="No pending Trial requests" /> : (
        <>
          <div className="adminTable">{trialRequests.map(request => (
            <div className="adminRow" key={request.id}>
              <div><strong>{request.userDisplayName || request.userEmail || 'Google user'}</strong><small>{request.userEmail}</small></div>
              <span>Requested {new Date(request.requestedAt).toLocaleString()}</span>
              <span><i className="statusDot warn" />Pending review</span>
              <div className="adminActions">
                <Button disabled={approvingTrialId !== null} onClick={() => setTrialToApprove(request)}>Approve Trial</Button>
              </div>
            </div>
          ))}</div>

          <Dialog
            open={trialToApprove !== null}
            onClose={() => { if (!approvingTrialId) setTrialToApprove(null); }}
            busy={approvingTrialId !== null}
            title="Approve Trial?"
          >
            {trialToApprove && (
              <ConfirmBody
                description={`Grants ${trialToApprove.userDisplayName || trialToApprove.userEmail} exactly 12 credits, expiring in 120 hours. This can only happen once per account.`}
                busy={approvingTrialId !== null}
                confirmLabel="Confirm approval"
                onConfirm={() => void confirmApproveTrial(trialToApprove)}
                onCancel={() => setTrialToApprove(null)}
              />
            )}
          </Dialog>
        </>
      )}
    </>
  );

  const purchasesContent = loading ? <Skeleton height="16rem" /> : billingError ? <ErrorPanel title="Payment requests are unavailable" description={billingError} /> : purchases.length === 0 ? <EmptyState title="No payment requests" /> : (
    <>
      <p className="hint" style={{ marginBottom: 12 }}>The Owner checks the bank transfer outside Blink, then uses Add Credits — which also assigns Pro. Reject invalid or fraudulent proof instead; no credits are added.</p>
      <div className="adminTable">{purchases.map(purchase => {
        const hasBonus = BigInt(purchase.packageBonusCredits || '0') > 0n;
        return (
        <div className="adminRow" key={purchase.id}>
          <div>
            <strong>{purchase.planName}</strong>
            <small>
              {purchaseTotalCredits(purchase)} credits
              {hasBonus && ` (${purchase.credits} base + ${purchase.packageBonusCredits} bonus)`}
              {' · '}{purchase.priceMinor} {purchase.currency}
            </small>
          </div>
          <span>User {purchase.userId}</span>
          <span><i className={`statusDot ${purchase.status === 'approved' ? '' : purchase.status === 'rejected' ? 'bad' : 'warn'}`} />{purchase.status === 'pending' ? 'Awaiting check' : purchase.status === 'approved' ? 'Credits added' : 'Rejected'}</span>
          <div className="adminActions">
            <Button variant="secondary" onClick={() => void openProof(purchase.screenshotFileId)}>View proof</Button>
            {purchase.status === 'pending' && <Button onClick={() => { setProofId(null); setPurchaseToReject(null); setPurchaseToCredit(purchase); }}>Add Credits</Button>}
            {purchase.status === 'pending' && <Button variant="danger" onClick={() => { setProofId(null); setPurchaseToCredit(null); setPurchaseToReject(purchase); setRejectReason(''); }}>Reject</Button>}
          </div>
        </div>
        );
      })}</div>

      <Dialog open={proofId !== null} onClose={closeProof} busy={proofLoading} title="Private payment proof">
        {proofLoading ? <Skeleton height="12rem" /> : proofError ? <ErrorPanel title="Payment proof is unavailable" description={proofError} action={{ label: 'Try again', onClick: () => proofId && void openProof(proofId) }} /> : proof && proofUrl ? (
          <div>
            <img src={proofUrl} alt={`Payment proof: ${proof.originalFilename}`} style={{ maxWidth: '100%', borderRadius: 12 }} />
            <p className="hint" style={{ marginTop: 8 }}>{proof.originalFilename} · {proof.mimeType} · {BigInt(proof.sizeBytes).toLocaleString()} bytes · {proof.status}</p>
            <a className="btn" href={proofUrl} download={`payment-proof.${proof.mimeType.split('/')[1] || 'image'}`}>Download private copy</a>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={purchaseToCredit !== null} onClose={() => { if (!mutating) setPurchaseToCredit(null); }} busy={mutating} title="Add Credits and assign Pro?">
        {purchaseToCredit && (
          <ConfirmBody
            description={`Add ${purchaseTotalCredits(purchaseToCredit)} credits and assign Pro. Confirm only after checking the bank transfer outside Blink.`}
            busy={mutating}
            confirmLabel="Confirm Add Credits"
            onConfirm={() => void confirmMatchingCredits()}
            onCancel={() => setPurchaseToCredit(null)}
          />
        )}
      </Dialog>

      <Dialog open={purchaseToReject !== null} onClose={() => { if (!mutating) setPurchaseToReject(null); }} busy={mutating} title="Reject this purchase?">
        {purchaseToReject && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>No credits are added. A reason is required.</p>
            <Input label="Reason" value={rejectReason} maxLength={1000} onChange={event => setRejectReason(event.target.value)} />
            <div className="row wrap" style={{ marginTop: 12 }}>
              <Button variant="danger" loading={mutating} disabled={!rejectReason.trim()} onClick={() => void confirmRejectPurchase()}>Confirm Reject</Button>
              <Button variant="ghost" disabled={mutating} onClick={() => setPurchaseToReject(null)}>Cancel</Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );

  const packagesContent = (
    <>
      <div className="row wrap between" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ margin: 0 }}>Normal users see active packages only.</p>
        <div className="row wrap">
          <Button variant="secondary" onClick={() => void openPackageHistory()}>Audit history</Button>
          <Button onClick={openCreate}>Create package</Button>
        </div>
      </div>
      {packagesLoading ? <Skeleton height="12rem" /> : packagesError ? <ErrorPanel title="Credit packages are unavailable" description={packagesError} action={{ label: 'Try again', onClick: () => void loadPackages() }} /> : sortedPackages.length === 0 ? (
        <EmptyState title="No credit packages yet" action={{ label: 'Create package', onClick: openCreate }} />
      ) : (
        <div className="adminTable">
          {sortedPackages.map((item) => {
            const activeIndex = reorderablePackages.findIndex(candidate => candidate.id === item.id);
            return (
              <div className="adminRow" key={item.id} style={item.archivedAt ? { opacity: 0.6 } : undefined}>
                <div><strong>{item.name}</strong><small>{item.creditAmount} credits · {item.priceMinor ?? item.price} {item.currency}</small></div>
                <span>Order {item.displayOrder}</span>
                <span><i className={`statusDot ${item.archivedAt ? 'warn' : item.active ? '' : 'warn'}`} />{item.archivedAt ? 'Archived' : item.active ? 'Active' : 'Inactive'}</span>
                <div className="adminActions">
                  <Button variant="ghost" disabled={Boolean(item.archivedAt) || activeIndex <= 0} onClick={() => requestPackageMove(item, -1)} aria-label={`Move ${item.name} up`}>Up</Button>
                  <Button variant="ghost" disabled={Boolean(item.archivedAt) || activeIndex < 0 || activeIndex >= reorderablePackages.length - 1} onClick={() => requestPackageMove(item, 1)} aria-label={`Move ${item.name} down`}>Down</Button>
                  <Button variant="secondary" disabled={Boolean(item.archivedAt)} onClick={() => openEdit(item)}>Edit</Button>
                  <Button variant="secondary" disabled={Boolean(item.archivedAt)} onClick={() => requestPackageStatus(item, !item.active)}>{item.active ? 'Deactivate' : 'Activate'}</Button>
                  <Button variant="danger" disabled={Boolean(item.archivedAt)} onClick={() => requestPackageArchive(item)}>Archive</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Create credit package' : 'Edit credit package'}>
        <form onSubmit={submitPackageForm}>
          {formError && <div className="alert error" role="alert" style={{ marginBottom: 12 }}>{formError}</div>}
          <Input label="Name" value={draft.name} maxLength={100} required onChange={event => setDraft({ ...draft, name: event.target.value })} />
          <div className="packageFormGrid">
            <Input label="Price (minor units)" type="number" min="1" step="1" value={draft.price} required onChange={event => setDraft({ ...draft, price: event.target.value })} />
            <Input label="Currency code" value={draft.currency} minLength={3} maxLength={3} required onChange={event => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} />
            <Input label="Credit amount" type="number" min="1" step="1" value={draft.creditAmount} required onChange={event => setDraft({ ...draft, creditAmount: event.target.value })} />
            <Input label="Bonus credits" type="number" min="0" step="1" value={draft.bonusCredits} required onChange={event => setDraft({ ...draft, bonusCredits: event.target.value })} />
            <Input label="Display order" type="number" min="0" step="1" value={draft.displayOrder} required onChange={event => setDraft({ ...draft, displayOrder: event.target.value })} />
          </div>
          <label className="field">
            <span>Note (optional)</span>
            <textarea value={draft.note} maxLength={1000} rows={3} onChange={event => setDraft({ ...draft, note: event.target.value })} />
          </label>
          <label className="checkline">
            <input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />
            Active and visible to normal users
          </label>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Button type="submit">Review changes</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={pendingPackage !== null} onClose={() => { if (!packageMutating) setPendingPackage(null); }} busy={packageMutating} title={pendingPackage?.title ?? 'Confirm change'}>
        {pendingPackage && (
          <ConfirmBody
            description={pendingPackage.description}
            dangerous={pendingPackage.dangerous}
            busy={packageMutating}
            confirmLabel="Confirm change"
            onConfirm={() => void confirmPackageAction()}
            onCancel={() => setPendingPackage(null)}
          />
        )}
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title="Credit package audit history">
        {auditLoading ? <Skeleton height="6rem" />
          : packageAuditError ? <ErrorPanel title="Audit history is unavailable" description={packageAuditError} />
            : audit.length === 0 ? <EmptyState title="No package audit events found" />
              : <ol className="adminAuditList">{audit.slice(0, 20).map(event => (
                <li key={event.id}><div><strong>{event.event_type.replace('credit_package.', '').replace(/_/g, ' ')}</strong><small>{new Date(event.occurred_at).toLocaleString()} · Actor: {event.actor_user_id}</small></div></li>
              ))}</ol>}
      </Dialog>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="row wrap between" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Bank accounts</h3>
          <Button onClick={openBankCreate}>Create bank account</Button>
        </div>
        {banksLoading ? <Skeleton height="8rem" /> : banksError ? (
          <ErrorPanel title="Bank accounts are unavailable" description={banksError} action={{ label: 'Try again', onClick: () => void loadBanks() }} />
        ) : banks.length === 0 ? <EmptyState title="No bank accounts yet" action={{ label: 'Create bank account', onClick: openBankCreate }} /> : (
          <div className="adminTable">
            {banks.map(bank => {
              const matchingPackages = packages.filter(item => item.currency === bank.currency && !item.archivedAt);
              return (
                <div className="adminRow" key={bank.id} style={bank.archived_at ? { opacity: 0.6 } : undefined}>
                  <div><strong>{bank.bank_name}</strong><small>{bank.account_name} · {bank.account_number} · {bank.currency}</small></div>
                  <span><i className={`statusDot ${bank.active ? '' : 'warn'}`} />{bank.active ? 'Active' : 'Inactive'}</span>
                  <div className="adminActions">
                    <select
                      value={linkPackageChoice[bank.id] ?? ''}
                      onChange={event => setLinkPackageChoice({ ...linkPackageChoice, [bank.id]: event.target.value })}
                      disabled={matchingPackages.length === 0}
                    >
                      <option value="">{matchingPackages.length === 0 ? `No ${bank.currency} packages` : 'Select package…'}</option>
                      {matchingPackages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <Button
                      variant="secondary"
                      disabled={!linkPackageChoice[bank.id] || linkingBankId === bank.id}
                      onClick={() => void linkBankToPackage(bank, true)}
                    >Link</Button>
                    <Button
                      variant="ghost"
                      disabled={!linkPackageChoice[bank.id] || linkingBankId === bank.id}
                      onClick={() => void linkBankToPackage(bank, false)}
                    >Unlink</Button>
                    <Button variant="secondary" onClick={() => openBankEdit(bank)}>Edit</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>Only packages in the same currency as a bank account can be linked to it — there is no currency conversion.</p>
      </div>

      <Dialog open={bankEditing !== null} onClose={() => { if (!bankMutating) setBankEditing(null); }} busy={bankMutating} title={bankEditing === 'new' ? 'Create bank account' : 'Edit bank account'}>
        <form onSubmit={event => void submitBankForm(event)}>
          {bankFormError && <div className="alert error" role="alert" style={{ marginBottom: 12 }}>{bankFormError}</div>}
          <Input label="Bank code" value={bankDraft.code} maxLength={50} required disabled={bankEditing !== 'new'} onChange={event => setBankDraft({ ...bankDraft, code: event.target.value })} />
          <Input label="Bank name" value={bankDraft.bankName} maxLength={100} required onChange={event => setBankDraft({ ...bankDraft, bankName: event.target.value })} />
          <div className="packageFormGrid">
            <Input label="Account name" value={bankDraft.accountName} maxLength={100} required onChange={event => setBankDraft({ ...bankDraft, accountName: event.target.value })} />
            <Input label="Account number" value={bankDraft.accountNumber} maxLength={100} required onChange={event => setBankDraft({ ...bankDraft, accountNumber: event.target.value })} />
            <Input label="Branch (optional)" value={bankDraft.branch} maxLength={100} onChange={event => setBankDraft({ ...bankDraft, branch: event.target.value })} />
            <Input label="Currency code" value={bankDraft.currency} minLength={3} maxLength={3} required onChange={event => setBankDraft({ ...bankDraft, currency: event.target.value.toUpperCase() })} />
            <Input label="Display order" type="number" min="0" step="1" value={bankDraft.displayOrder} required onChange={event => setBankDraft({ ...bankDraft, displayOrder: event.target.value })} />
          </div>
          <label className="field">
            <span>Instructions (optional)</span>
            <textarea value={bankDraft.instructions} maxLength={1000} rows={3} onChange={event => setBankDraft({ ...bankDraft, instructions: event.target.value })} />
          </label>
          <label className="checkline">
            <input type="checkbox" checked={bankDraft.active} onChange={event => setBankDraft({ ...bankDraft, active: event.target.checked })} />
            Active
          </label>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Button type="submit" loading={bankMutating} disabled={bankMutating}>Save bank account</Button>
            <Button type="button" variant="ghost" disabled={bankMutating} onClick={() => setBankEditing(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );

  const creditsContent = (
    <>
      <div className="panel">
        {!selectedCreditUser ? (
          <>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Search size={16} aria-hidden="true" />Select a user</h3>
            <Input
              label="Search users"
              type="search"
              placeholder="Name or email"
              value={creditsQuery}
              onChange={event => { setCreditsQuery(event.target.value); setCreditsVisibleCount(USER_PAGE_SIZE); }}
            />
            {filteredCreditUsers.length === 0 ? <EmptyState title="No matching users" /> : (
              <>
                <ul className="userPickList">
                  {visibleCreditUsers.map(user => (
                    <li key={user.uid}>
                      <button type="button" onClick={() => selectCreditUser(user.uid)}>
                        <span><strong>{user.displayName || 'Google user'}</strong><small>{user.email}</small></span>
                        <span className="chip">{ROLE_LABEL[user.role]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="row between wrap" style={{ marginTop: 8 }}>
                  <small className="hint">Showing {visibleCreditUsers.length} of {filteredCreditUsers.length} users</small>
                  {filteredCreditUsers.length > visibleCreditUsers.length && (
                    <Button variant="secondary" onClick={() => setCreditsVisibleCount(count => count + USER_PAGE_SIZE)}>Load more</Button>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 4 }}>
              <div><strong>{selectedCreditUser.displayName || 'Google user'}</strong><div className="muted">{selectedCreditUser.email}</div></div>
              <Button variant="ghost" onClick={clearCreditUser}>Change user</Button>
            </div>
            <Input label="Amount (whole credits)" type="number" min="1" step="1" value={amount} onChange={event => setAmount(event.target.value)} />
            <Input label="Reason (required)" value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} />
            <div className="row wrap"><Button disabled={!adjustmentValid} onClick={() => setPendingDirection('grant')}>Add credits</Button><Button variant="danger" disabled={!adjustmentValid} onClick={() => setPendingDirection('deduction')}>Deduct credits</Button></div>
          </>
        )}
      </div>
      <Dialog
        open={pendingDirection !== null}
        onClose={() => { if (!mutating) setPendingDirection(null); }}
        busy={mutating}
        title={`${pendingDirection === 'grant' ? 'Add' : 'Deduct'} ${amount || '0'} credits?`}
      >
        <ConfirmBody
          description={`This creates a new ledger entry and audit record. Reason: ${reason}`}
          dangerous={pendingDirection === 'deduction'}
          busy={mutating}
          confirmLabel="Confirm correction"
          onConfirm={() => void confirmAdjustment()}
          onCancel={() => setPendingDirection(null)}
        />
      </Dialog>
    </>
  );

  const auditContent = loading ? <Skeleton height="16rem" /> : auditEvents.length === 0 && auditError ? <ErrorPanel title="Audit logs are unavailable" description={auditError} /> : auditEvents.length === 0 ? <EmptyState title="No audit events available" /> : (
    <>
      <ol className="adminAuditList">{auditEvents.map(event => <li key={event.id}><div><strong>{event.type.replace(/[_.]/g, ' ')}</strong><span>{event.details}</span><small>{new Date(event.time).toLocaleString()}</small></div></li>)}</ol>
      {auditError && <p className="hint" style={{ marginTop: 12 }}>Some audit sources are unavailable: {auditError}</p>}
    </>
  );

  const systemContent = loading ? <Skeleton height="16rem" /> : system ? (
    <div className="adminGrid">
      <StatCard variant="adminCard" value={system.status} label="Application" />
      <StatCard variant="adminCard" value={`${Math.floor(system.uptimeSeconds / 60)} min`} label="Process uptime" />
      <StatCard variant="adminCard" value={system.nodeVersion} label="Runtime" />
      <StatCard variant="adminCard" value={bytes(system.memory.rss)} label="Resident memory" />
    </div>
  ) : <ErrorPanel title="System status is unavailable" description={systemError || undefined} />;

  const items = [
    { id: 'overview', label: 'Overview', content: overviewContent },
    { id: 'users', label: 'Users', content: usersContent },
    { id: 'trial', label: 'Trial Requests', content: trialContent },
    { id: 'purchases', label: 'Purchases', content: purchasesContent },
    { id: 'packages', label: 'Packages', content: packagesContent },
    { id: 'credits', label: 'Credits', content: creditsContent },
    { id: 'audit', label: 'Audit Log', content: auditContent },
    { id: 'system', label: 'System Status', content: systemContent },
  ];

  return (
    <>
      <div className="pagetitle">
        <div><span className="kicker">RESTRICTED</span><h1>Super Admin</h1><p>{profile?.email} — real operational controls available to the protected Owner authority.</p></div>
        <span className="chip">Owner access only</span>
      </div>
      {feedback && (
        <div className={`alert ${feedback.tone === 'success' ? 'success' : 'error'}`}>
          <div className="row between"><strong>{feedback.title}</strong><button className="btn ghost iconBtn" aria-label="Dismiss" onClick={() => setFeedback(null)}><X size={16} aria-hidden="true" /></button></div>
          {feedback.message && <div style={{ marginTop: 4 }}>{feedback.message}</div>}
        </div>
      )}
      <Tabs items={items} activeId={tab} onChange={id => setTab(id as TabId)} label="Super Admin sections" />
    </>
  );
}
