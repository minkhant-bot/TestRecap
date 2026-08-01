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

const mutation = <T>(path: string, method: 'POST' | 'PATCH', body: unknown) =>
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

export const listManagedCreditPackages = async () => {
  const catalog = await parseResponse<{ creditPlans: CreditPackage[] }>(
    await fetch('/api/admin/billing/catalog', { credentials: 'include' }),
  );
  return catalog.creditPlans;
};

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
