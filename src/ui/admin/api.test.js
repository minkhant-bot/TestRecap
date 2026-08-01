import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('matching-credit action binds the existing idempotent purchase ledger endpoint', async () => {
  const adminApi = fs.readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  const billingApi = fs.readFileSync(new URL('../billing/api.ts', import.meta.url), 'utf8');

  assert.match(adminApi, /addMatchingPurchaseCredits = \(purchaseId: string\)/);
  assert.match(adminApi, /\/api\/admin\/billing\/purchases\/\$\{encodeURIComponent\(purchaseId\)\}\/approve/);
  assert.match(adminApi, /adminMutation<\{ purchase: PurchaseRequest \}>/);
  assert.match(billingApi, /'Idempotency-Key': crypto\.randomUUID\(\)/);
  assert.match(billingApi, /credentials: 'include'/);
});

test('payment proof UI uses private multipart upload and authenticated admin streaming', () => {
  const adminApi = fs.readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  const billingApi = fs.readFileSync(new URL('../billing/api.ts', import.meta.url), 'utf8');

  assert.match(billingApi, /new XMLHttpRequest\(\)/);
  assert.match(billingApi, /\/api\/credit-purchase-requests\/with-proof/);
  assert.match(billingApi, /form\.append\('proof', input\.proof, input\.proof\.name\)/);
  assert.match(billingApi, /'Idempotency-Key'/);
  assert.match(adminApi, /\/api\/admin\/billing\/screenshots\/\$\{encodeURIComponent\(id\)\}\/content/);
  assert.match(adminApi, /credentials: 'include'/);
});
