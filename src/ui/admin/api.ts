import { ApiError, adminGet, adminMutation, type PurchaseRequest, type TrialRequest } from '../billing/api';

export interface AdminUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  role: 'user' | 'admin' | 'super_admin';
  status: 'active' | 'disabled';
  createdAt: string | null;
  lastLoginAt: string | null;
}

export interface AdminAuditEvent {
  timestamp: string;
  type: string;
  details: Record<string, unknown>;
}

export interface BillingAuditEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  actor_user_id: string | null;
}

export interface SystemStatus {
  status: string;
  uptimeSeconds: number;
  nodeVersion: string;
  platform: string;
  cpuCount: number;
  memory: { rss: number; heapUsed: number };
  queue: { jobs?: unknown[]; activeJobId?: string | null };
}

export interface ScreenshotMetadata {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
  status: string;
  uploadedAt: string;
  verifiedAt: string | null;
}

export const listAdminUsers = () => adminGet<AdminUser[]>('/api/admin/users');
export const updateUserAccess = (uid: string, input: { role: AdminUser['role']; status: AdminUser['status'] }) =>
  adminMutation<AdminUser>(`/api/admin/users/${encodeURIComponent(uid)}`, input, 'PATCH');
export const listAdminPurchases = () => adminGet<PurchaseRequest[]>('/api/admin/billing/purchases');
export const listAdminLogs = () => adminGet<AdminAuditEvent[]>('/api/admin/logs?limit=100');
export const listBillingAudit = () => adminGet<BillingAuditEvent[]>('/api/admin/billing/audit');
export const getSystemStatus = () => adminGet<SystemStatus>('/api/admin/system');
export const getScreenshotMetadata = (id: string) =>
  adminGet<ScreenshotMetadata>(`/api/admin/billing/screenshots/${encodeURIComponent(id)}`);

export const getScreenshotContent = async (id: string) => {
  const response = await fetch(`/api/admin/billing/screenshots/${encodeURIComponent(id)}/content`, {
    credentials: 'include',
    headers: { Accept: 'image/jpeg,image/png,image/webp' },
  });
  if (response.status === 401) window.dispatchEvent(new CustomEvent('testrecap:session-expired'));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ApiError(payload.error || 'Payment proof preview is unavailable.', response.status, payload.code);
  }
  return response.blob();
};

// Rule #4 (frozen): approving a purchase now also auto-assigns Pro.
export const addMatchingPurchaseCredits = (purchaseId: string) =>
  adminMutation<{ purchase: PurchaseRequest; proAssignment: { planId: string } | null }>(
    `/api/admin/billing/purchases/${encodeURIComponent(purchaseId)}/approve`,
    {},
  );

// Rule #5 (frozen): Owner may reject invalid/fraudulent proof; reason required.
export const rejectPurchase = (purchaseId: string, reason: string) =>
  adminMutation<{ purchase: PurchaseRequest }>(
    `/api/admin/billing/purchases/${encodeURIComponent(purchaseId)}/reject`,
    { reason },
  );

export const adjustUserCredits = (input: {
  userId: string;
  amount: number;
  direction: 'grant' | 'deduction';
  reason: string;
}) => adminMutation<{ balance: { availableBalance: string } }>('/api/admin/billing/adjustments', input);

// Rule #1 (frozen): Owner reviews pending Trial requests and approves them.
export const listTrialRequests = () => adminGet<TrialRequest[]>('/api/admin/billing/trial-requests');

export const approveTrialRequest = (requestId: string) =>
  adminMutation<{ request: TrialRequest; grant: { credit_amount: string; expires_at: string } }>(
    `/api/admin/billing/trial-requests/${encodeURIComponent(requestId)}/approve`,
    {},
  );
