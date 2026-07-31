import { withTransaction } from '../db/client.js';
import {
  auditLogsRepository,
  balancesRepository,
  bootstrapRepository,
  ledgerRepository,
  planAssignmentsRepository,
  plansRepository,
  rolesRepository,
  usersRepository,
} from '../db/repositories/index.js';

export const ensureUserFromFirebaseIdentity = async (identity, { client = null } = {}) => {
  if (!identity?.uid) throw new Error('A resolved Firebase UID is required.');
  return usersRepository.ensureUser({
    firebaseUid: identity.uid,
    email: identity.email || null,
    displayName: identity.displayName || null,
    photoUrl: identity.photoURL || null,
  }, { client });
};

export const getAuthoritativeRole = async (userId, options = {}) =>
  rolesRepository.findRoleByUserId(userId, options);

export const assignRoleInTransaction = async (assignment, { client }) =>
  rolesRepository.assignRole(assignment, { client });

export const getCurrentPlanAssignment = async (userId, options = {}) =>
  planAssignmentsRepository.findCurrentPlanAssignment(userId, options);

export const getPlanPolicyVersion = async (policyVersionId, options = {}) =>
  plansRepository.findPlanPolicyVersionById(policyVersionId, options);

export const getCreditBalanceProjection = async (userId, options = {}) =>
  balancesRepository.findBalanceAccount(userId, options);

export const reconcileCreditBalance = async (userId, { client }) => {
  if (!client) throw new Error('Balance reconciliation requires an existing transaction client.');
  const [postedBalance, reservedBalance] = await Promise.all([
    ledgerRepository.sumPostedCredits(userId, { client }),
    ledgerRepository.sumReservedCredits(userId, { client }),
  ]);
  return balancesRepository.setBalanceProjection({
    userId,
    postedBalance,
    reservedBalance,
  }, { client });
};

export const recordAuditEvent = async (event, { client }) =>
  auditLogsRepository.insertAuditLog(event, { client });

export const bootstrapSuperAdmin = async ({
  bootstrapName = 'initial-super-admin',
  resolvedFirebaseIdentity,
}, {
  transaction = withTransaction,
  repositories = {
    audit: auditLogsRepository,
    bootstrap: bootstrapRepository,
    roles: rolesRepository,
    users: usersRepository,
  },
} = {}) => transaction(async client => {
  if (!resolvedFirebaseIdentity?.uid) {
    throw new Error('Resolve the configured bootstrap identity to a Firebase UID before bootstrap.');
  }

  await client.query('SELECT pg_advisory_xact_lock($1)', [824173501]);
  const current = await repositories.bootstrap.findBootstrapState(
    bootstrapName,
    { client, forUpdate: true },
  );
  if (current?.status === 'disabled') throw new Error('Super Admin bootstrap is disabled.');
  if (current?.status === 'completed') {
    const role = await repositories.roles.findRoleByUserId(current.bootstrap_user_id, { client });
    return { userId: current.bootstrap_user_id, role, alreadyCompleted: true };
  }

  const user = await repositories.users.ensureUser({
    firebaseUid: resolvedFirebaseIdentity.uid,
    email: resolvedFirebaseIdentity.email || null,
    displayName: resolvedFirebaseIdentity.displayName || null,
    photoUrl: resolvedFirebaseIdentity.photoURL || null,
  }, { client });
  const role = await repositories.roles.assignRole({
    userId: user.id,
    role: 'super_admin',
    source: 'bootstrap',
    protectedBootstrap: true,
  }, { client });
  const audit = await repositories.audit.insertAuditLog({
    actorUserId: user.id,
    actorType: 'user',
    eventType: 'role.bootstrap.super_admin',
    resourceType: 'user',
    resourceId: user.id,
    metadata: { bootstrapName },
  }, { client });
  await repositories.bootstrap.completeBootstrapState({
    bootstrapName,
    userId: user.id,
    auditLogId: audit.id,
  }, { client });
  return { userId: user.id, role, alreadyCompleted: false };
});

export const disableSuperAdminBootstrap = async (
  bootstrapName = 'initial-super-admin',
) => withTransaction(async client => {
  const state = await bootstrapRepository.findBootstrapState(
    bootstrapName,
    { client, forUpdate: true },
  );
  if (!state || state.status !== 'completed') {
    throw new Error('Only a completed Super Admin bootstrap can be disabled.');
  }
  const audit = await recordAuditEvent({
    actorUserId: state.bootstrap_user_id,
    actorType: 'user',
    eventType: 'role.bootstrap.disabled',
    resourceType: 'bootstrap',
    resourceId: state.bootstrap_user_id,
    metadata: { bootstrapName },
  }, { client });
  const disabled = await bootstrapRepository.disableBootstrapState(bootstrapName, { client });
  return { state: disabled, audit };
});
