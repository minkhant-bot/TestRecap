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
  priceMinor: string;
  currency: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

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

const get = <T>(path: string) => fetch(path, { credentials: 'include' }).then(parseResponse<T>);

export const getBillingOverview = async () => {
  const [balance, assignment, plans, ledger, purchases] = await Promise.all([
    get<BillingBalance>('/api/credits/balance'),
    get<PlanAssignment | null>('/api/plans/me'),
    get<BillingPlan[]>('/api/plans'),
    get<LedgerEntry[]>('/api/credits/ledger?limit=30'),
    get<PurchaseRequest[]>('/api/credit-purchase-requests'),
  ]);
  return { balance, assignment, plans, ledger, purchases };
};

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
  fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  }).then(parseResponse<T>);
