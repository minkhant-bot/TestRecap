import { databaseExecutor, firstRow } from './shared.js';

export const findBalanceAccount = async (userId, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT user_id, posted_balance, reserved_balance, version, updated_at
     FROM credit_balance_accounts
     WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const row = firstRow(result);
  return row && {
    userId: row.user_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    availableBalance: BigInt(row.posted_balance) - BigInt(row.reserved_balance),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};

export const setBalanceProjection = async ({
  userId,
  postedBalance,
  reservedBalance,
}, { client }) => {
  if (!client) throw new Error('Balance mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO credit_balance_accounts
      (user_id, posted_balance, reserved_balance)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       posted_balance = EXCLUDED.posted_balance,
       reserved_balance = EXCLUDED.reserved_balance,
       version = credit_balance_accounts.version + 1,
       updated_at = now()
     RETURNING user_id, posted_balance, reserved_balance, version, updated_at`,
    [userId, String(postedBalance), String(reservedBalance)],
  );
  const row = firstRow(result);
  return {
    userId: row.user_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    availableBalance: BigInt(row.posted_balance) - BigInt(row.reserved_balance),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};

export const ensureBalanceAccountForUpdate = async (userId, { client }) => {
  await client.query(
    `INSERT INTO credit_balance_accounts(user_id,posted_balance,reserved_balance)
     VALUES ($1,0,0) ON CONFLICT(user_id) DO NOTHING`,
    [userId],
  );
  return findBalanceAccount(userId, { client, forUpdate: true });
};

export const addPostedCredits = async (userId, amount, { client }) => {
  const result = await client.query(
    `UPDATE credit_balance_accounts
     SET posted_balance=posted_balance+$2,version=version+1,updated_at=now()
     WHERE user_id=$1 AND posted_balance+$2 >= reserved_balance
     RETURNING user_id,posted_balance,reserved_balance,version,updated_at`,
    [userId, String(amount)],
  );
  const row = firstRow(result);
  if (!row) return null;
  return {
    userId: row.user_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    availableBalance: BigInt(row.posted_balance) - BigInt(row.reserved_balance),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};

export const reserveCredits = async (userId, amount, { client }) => {
  const result = await client.query(
    `UPDATE credit_balance_accounts
     SET reserved_balance=reserved_balance+$2,version=version+1,updated_at=now()
     WHERE user_id=$1 AND posted_balance-reserved_balance >= $2
     RETURNING user_id,posted_balance,reserved_balance,version,updated_at`,
    [userId, String(amount)],
  );
  const row = firstRow(result);
  return row && {
    userId: row.user_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    availableBalance: BigInt(row.posted_balance) - BigInt(row.reserved_balance),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};

export const releaseReservedCredits = async (userId, amount, { client }) => {
  const result = await client.query(
    `UPDATE credit_balance_accounts
     SET reserved_balance=reserved_balance-$2,version=version+1,updated_at=now()
     WHERE user_id=$1 AND reserved_balance >= $2
     RETURNING user_id,posted_balance,reserved_balance,version,updated_at`,
    [userId, String(amount)],
  );
  const row = firstRow(result);
  return row && {
    userId: row.user_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    availableBalance: BigInt(row.posted_balance) - BigInt(row.reserved_balance),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};

export const settleReservedCredits = async (userId, amount, { client }) => {
  const result = await client.query(
    `UPDATE credit_balance_accounts
     SET posted_balance=posted_balance-$2,reserved_balance=reserved_balance-$2,
         version=version+1,updated_at=now()
     WHERE user_id=$1 AND posted_balance >= $2 AND reserved_balance >= $2
     RETURNING user_id,posted_balance,reserved_balance,version,updated_at`,
    [userId, String(amount)],
  );
  const row = firstRow(result);
  return row && {
    userId: row.user_id,
    postedBalance: BigInt(row.posted_balance),
    reservedBalance: BigInt(row.reserved_balance),
    availableBalance: BigInt(row.posted_balance) - BigInt(row.reserved_balance),
    version: Number(row.version),
    updatedAt: row.updated_at,
  };
};
