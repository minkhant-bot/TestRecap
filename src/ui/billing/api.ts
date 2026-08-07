import { dedupeRequest } from '../utils/requestCache.js';

export interface BillingBalance {
  postedBalance: string;
  reservedBalance: string;
  availableBalance: string;
}

export interface PlanAssignment {
  planCode: string;
  planName: string;
  status: string;
  startsAt: string;
}

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  policy: {
    billingBlockSeconds: number;
    creditsPerBlock: string;
    billingMode: 'byok' | 'blink_funded';
  };
}

export interface LedgerEntry {
  id: string;
  amount: string;
  entryType: string;
  reason: string | null;
  createdAt: string;
}

export interface PackageBank {
  id: string;
  code: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  branch: string | null;
  instructions: string | null;
  currency: string;
}

export interface PurchaseRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  userId: string;
  creditPlanId: string;
  screenshotFileId: string;
  planName: string;
  credits: string;
  packageBonusCredits: string;
  priceMinor: string;
  currency: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

// Total granted credits = base credits + package bonus credits. Every
// display (package cards, purchase popup, purchase history, Owner review,
// ledger, balance) must derive from this one shared computation rather than
// showing base credits alone.
export const purchaseTotalCredits = (purchase: Pick<PurchaseRequest, 'credits' | 'packageBonusCredits'>) =>
  (BigInt(purchase.credits) + BigInt(purchase.packageBonusCredits || '0')).toString();

export interface PaymentProofConfiguration {
  maxSizeBytes: number;
  maxSizeMb: number;
  mimeTypes: string[];
  extensions: string[];
}

export interface PaymentProofMetadata {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
  status: string;
  uploadedAt?: string;
  verifiedAt?: string | null;
}

export interface PaymentProofSubmission {
  purchase: PurchaseRequest;
  proof: PaymentProofMetadata;
}

export interface TrialRequest {
  id: string;
  userId: string;
  status: 'pending' | 'approved';
  requestedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  userEmail?: string;
  userDisplayName?: string;
}

export class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const parseResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (response.status === 401) window.dispatchEvent(new CustomEvent('testrecap:session-expired'));
  if (!response.ok) throw new ApiError(payload.error || 'Request failed.', response.status, payload.code);
  return payload as T;
};

// A stalled request (slow/unreachable database, dropped connection) must
// never spin a loading indicator forever — every billing fetch races against
// this timeout so callers always get a real, actionable error and their
// `finally` block always runs.
const REQUEST_TIMEOUT_MS = 20000;
const fetchWithTimeout = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal })
    .catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('Request timed out. Please try again.', 0, 'TIMEOUT');
      }
      throw new ApiError('Network error. Check your connection and try again.', 0, 'NETWORK_ERROR');
    })
    .finally(() => clearTimeout(timer));
};

// Short coalescing window (well under useAutoRefresh's >=12s cadence): merges
// requests that land close together -- e.g. AppShell's sidebar balance poll
// and BuyCreditsPage's own overview poll both reading /api/credits/balance --
// into a single network call, without changing how stale data can ever get.
const DEDUPE_TTL_MS = 4000;
const get = <T>(path: string) =>
  dedupeRequest(path, DEDUPE_TTL_MS, () => fetchWithTimeout(path, { credentials: 'include' }).then(parseResponse<T>));

export const getBalance = () => get<BillingBalance>('/api/credits/balance');
export const getMyPlanAssignment = () => get<PlanAssignment | null>('/api/plans/me');

export const getBillingOverview = async () => {
  const [balance, assignment, plans, ledger, purchases] = await Promise.all([
    getBalance(),
    getMyPlanAssignment(),
    get<BillingPlan[]>('/api/plans'),
    get<LedgerEntry[]>('/api/credits/ledger?limit=30'),
    get<PurchaseRequest[]>('/api/credit-purchase-requests'),
  ]);
  return { balance, assignment, plans, ledger, purchases };
};

// Rule #1 (frozen): Guest taps "Request Trial" -> pending -> Owner approves.
export const getMyTrialRequest = () => get<TrialRequest | null>('/api/trial/request').catch(() => null);

export const requestTrial = () =>
  fetchWithTimeout('/api/trial/request', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  }).then(parseResponse<{ request: TrialRequest }>);

export const listPackageBanks = (packageId: string) =>
  get<PackageBank[]>(`/api/credit-plans/${encodeURIComponent(packageId)}/bank-accounts`);

export const getPaymentProofConfiguration = () =>
  get<PaymentProofConfiguration>('/api/payment-proofs/config');

export const submitPurchaseWithProof = (input: {
  creditPlanId: string;
  bankAccountId: string;
  proof: File;
  idempotencyKey: string;
  onProgress?: (percentage: number) => void;
}) => {
  const request = new XMLHttpRequest();
  const promise = new Promise<PaymentProofSubmission>((resolve, reject) => {
    request.open('POST', '/api/credit-purchase-requests/with-proof');
    request.withCredentials = true;
    request.setRequestHeader('Idempotency-Key', input.idempotencyKey);
    request.upload.addEventListener('progress', event => {
      if (event.lengthComputable) input.onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      let payload: { error?: string; code?: string } & Partial<PaymentProofSubmission> = {};
      try { payload = JSON.parse(request.responseText || '{}'); } catch { /* structured fallback below */ }
      if (request.status === 401) window.dispatchEvent(new CustomEvent('testrecap:session-expired'));
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(payload.error || 'Payment proof upload failed.', request.status, payload.code));
        return;
      }
      resolve(payload as PaymentProofSubmission);
    });
    request.addEventListener('error', () => reject(new ApiError('Payment proof upload failed. Check your connection and retry.', 0, 'NETWORK_ERROR')));
    request.addEventListener('abort', () => reject(new ApiError('Payment proof upload was cancelled.', 0, 'UPLOAD_CANCELLED')));
    const form = new FormData();
    form.append('creditPlanId', input.creditPlanId);
    form.append('bankAccountId', input.bankAccountId);
    form.append('proof', input.proof, input.proof.name);
    request.send(form);
  });
  return { promise, cancel: () => request.abort() };
};

export const adminGet = get;

export const adminMutation = <T>(path: string, body: unknown, method: 'POST' | 'PATCH' = 'POST') =>
  fetchWithTimeout(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  }).then(parseResponse<T>);
