export interface CreditPackage {
  id: string;
  code: string;
  name: string;
  price: string;
  priceMinor: string;
  currency: string;
  creditAmount: string;
  bonusCredits: string;
  active: boolean;
  displayOrder: number;
  note: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditPackageInput {
  name: string;
  price: number;
  currency: string;
  creditAmount: number;
  bonusCredits: number;
  active: boolean;
  displayOrder: number;
  note: string | null;
}

export interface CreditPackageAuditEvent {
  id: string;
  occurred_at: string;
  actor_user_id: string;
  event_type: string;
  resource_id: string | null;
}

export interface CommercialPlan {
  id: string;
  code: 'trial' | 'normal' | 'pro';
  name: string;
  description: string;
  active: boolean;
  displayOrder: number;
  archivedAt: string | null;
}

export interface BankAccount {
  id: string;
  code: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  branch: string | null;
  currency: string;
  instructions: string;
  active: boolean;
  display_order: number;
  archived_at: string | null;
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('testrecap:session-expired'));
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'Credit package request failed.');
    Object.assign(error, { code: payload.code, status: response.status });
    throw error;
  }
  return payload as T;
};

const mutation = <T>(path: string, method: 'POST' | 'PATCH' | 'PUT', body: unknown) =>
  fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  }).then(parseResponse<T>);

export const listActiveCreditPackages = async () =>
  parseResponse<CreditPackage[]>(await fetch('/api/credit-packages', { credentials: 'include' }));

interface AdminCatalog { commercialPlans: CommercialPlan[]; creditPlans: CreditPackage[]; banks: BankAccount[] }
const getAdminCatalog = async () =>
  parseResponse<AdminCatalog>(await fetch('/api/admin/billing/catalog', { credentials: 'include' }));

export const listManagedCreditPackages = async () => (await getAdminCatalog()).creditPlans;
export const listManagedPlans = async () => (await getAdminCatalog()).commercialPlans;
export const listManagedBankAccounts = async () => (await getAdminCatalog()).banks;

export const listCreditPackageAudit = async () =>
  parseResponse<CreditPackageAuditEvent[]>(await fetch(
    '/api/admin/billing/audit?resourceType=credit_plan',
    { credentials: 'include' },
  ));

export const createCreditPackage = (input: CreditPackageInput) =>
  mutation<{ creditPackage: CreditPackage }>('/api/admin/billing/credit-packages', 'POST', {
    ...input, confirmed: true,
  });

export const editCreditPackage = (id: string, input: CreditPackageInput) =>
  mutation<{ creditPackage: CreditPackage }>(
    `/api/admin/billing/credit-packages/${encodeURIComponent(id)}`,
    'PATCH',
    { ...input, confirmed: true },
  );

export const setCreditPackageActive = (id: string, active: boolean) =>
  mutation<{ creditPackage: CreditPackage }>(
    `/api/admin/billing/credit-packages/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`,
    'POST',
    { confirmed: true },
  );

export const archiveCreditPackage = (id: string) =>
  mutation<{ creditPackage: CreditPackage }>(
    `/api/admin/billing/credit-packages/${encodeURIComponent(id)}/archive`,
    'POST',
    { confirmed: true },
  );

export const reorderCreditPackages = (items: Array<{ id: string; displayOrder: number }>) =>
  mutation<{ creditPackages: CreditPackage[] }>(
    '/api/admin/billing/credit-packages/reorder',
    'POST',
    { confirmed: true, items },
  );

// Trial's fixed grant, mirrored here only for display -- the actual grant
// amount is a backend constant (TRIAL_GRANT_CREDITS in billingFoundation.js)
// and is never sent from or computed by the client.
export const TRIAL_GRANT_CREDITS = 12;
export const TRIAL_GRANT_MINUTES = 6;

export interface PlanConfigInput {
  name: string;
  description: string;
  active: boolean;
}

// Owner configures only name/description/active; every technical field
// (credits per block, policy version, display order, billing mode,
// entitlements) is a backend-owned default applied server-side.
export const configurePlan = (code: 'trial' | 'pro', input: PlanConfigInput) =>
  mutation<{ plan: CommercialPlan; policy: unknown }>(`/api/admin/billing/plans/${code}/defaults`, 'PUT', input);

export interface BankConfigInput {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
  currency: string;
  instructions: string;
  active: boolean;
}

// No code field: the backend generates and safely de-duplicates a stable
// code from bank name + currency + account identity.
export const configureBank = (input: BankConfigInput) =>
  mutation<{ bank: BankAccount }>('/api/admin/billing/banks', 'POST', input);

export const linkPackageBank = (creditPlanId: string, bankAccountId: string, active: boolean) =>
  mutation<{ link: unknown }>(
    `/api/admin/billing/credit-plans/${encodeURIComponent(creditPlanId)}/banks/${encodeURIComponent(bankAccountId)}`,
    'PUT',
    { active },
  );
