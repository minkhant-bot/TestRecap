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

export interface PlanConfigInput {
  name: string;
  description: string;
  active: boolean;
  displayOrder: number;
}

export const configurePlan = (code: 'trial' | 'pro', input: PlanConfigInput) =>
  mutation<{ plan: CommercialPlan }>(`/api/admin/billing/plans/${code}`, 'PUT', input);

// Rule #4 (frozen): Trial is BYOK-only with no Blur/Flip; Pro is
// Blink-funded with Blur/Flip. These entitlement flags and the billing mode
// are derived from the plan code, never owner-editable, so this form can
// never submit a policy that violates that frozen rule.
const FROZEN_POLICY_SHAPE: Record<'trial' | 'pro', {
  billingMode: string; trialAllowanceCredits: number;
  entitlements: Array<{ key: string; enabled: boolean }>;
}> = {
  trial: {
    billingMode: 'byok',
    trialAllowanceCredits: 12,
    entitlements: [
      { key: 'blur', enabled: false },
      { key: 'flip', enabled: false },
      { key: 'byok_mode', enabled: true },
      { key: 'blink_funded_mode', enabled: false },
    ],
  },
  pro: {
    billingMode: 'blink_funded',
    trialAllowanceCredits: 0,
    entitlements: [
      { key: 'blur', enabled: true },
      { key: 'flip', enabled: true },
      { key: 'byok_mode', enabled: false },
      { key: 'blink_funded_mode', enabled: true },
    ],
  },
};

export const createPlanPolicy = (code: 'trial' | 'pro', input: { version: number; creditsPerBlock: number }) =>
  mutation<{ policy: unknown }>(`/api/admin/billing/plans/${code}/policies`, 'POST', {
    version: input.version,
    creditsPerBlock: input.creditsPerBlock,
    active: true,
    effectiveFrom: new Date().toISOString(),
    ...FROZEN_POLICY_SHAPE[code],
  });

export interface BankConfigInput {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
  currency: string;
  instructions: string;
  active: boolean;
  displayOrder: number;
}

export const configureBank = (code: string, input: BankConfigInput) =>
  mutation<{ bank: BankAccount }>(`/api/admin/billing/banks/${encodeURIComponent(code)}`, 'PUT', input);

export const linkPackageBank = (creditPlanId: string, bankAccountId: string, active: boolean) =>
  mutation<{ link: unknown }>(
    `/api/admin/billing/credit-plans/${encodeURIComponent(creditPlanId)}/banks/${encodeURIComponent(bankAccountId)}`,
    'PUT',
    { active },
  );
