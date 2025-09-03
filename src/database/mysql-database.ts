/**
 * MySQL database implementation for TigerBeetle port
 * Refactored from the original database.ts to implement IDatabaseInterface
 */

import {
  Account,
  Transfer,
  AccountFilter,
  QueryFilter,
  AccountBalance,
  TransferPendingStatus,
  TransferFlags,
  AccountFlags,
  CreateAccountError,
  CreateTransferError,
  CreateAccountsError,
  CreateTransfersError,
} from '../types.ts';
import {
  validateAccount,
  validateAccountExists,
  validateTransfer,
  validateTransferExists,
  validateTransferAccounts,
  wouldOverflowAccount,
} from '../validation.ts';
import { IDatabaseInterface, MySQLConfig } from './database-interface.ts';

// Deno MySQL client
import { Client as MySQLClient } from 'https://deno.land/x/mysql@v2.12.1/mod.ts';

export class MySQLDatabase implements IDatabaseInterface {
  private config: MySQLConfig;
  private client: MySQLClient | undefined;

  constructor(config: MySQLConfig) {
    this.config = {
      port: 3306,
      ...config,
    };
  }

  /**
   * Connect to MySQL database
   */
  async connect(): Promise<void> {
    try {
      this.client = await new MySQLClient().connect({
        hostname: this.config.host,
        port: this.config.port ?? 3306,
        username: this.config.user,
        db: this.config.database,
        password: this.config.password,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to connect to MySQL: ${errorMsg}`);
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
  }

  /**
   * Execute a SQL query (simplified implementation)
   */
  async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    if (!this.client) throw new Error('Not connected');
    const isSelect = /^\s*SELECT/i.test(sql);
    if (isSelect) {
      // Use query() for SELECTs to ensure proper result shaping with params
      const rows = await this.client.query(sql, params as any[]);
      return Array.isArray(rows) ? (rows as unknown[]) : [];
    } else {
      await this.client.execute(sql, params as any[]);
      return [];
    }
  }

  /**
   * Create accounts with validation and error handling
   */
  async createAccounts(accounts: Account[]): Promise<CreateAccountsError[]> {
    const errors: CreateAccountsError[] = [];
    let lastTimestamp = 0n;

    // Begin transaction
    await this.query('START TRANSACTION');
    
    try {
      for (let i = 0; i < accounts.length; i++) {
        const account = { ...accounts[i] };

        // Validate account (inputs must have timestamp = 0n)
        const validationError = validateAccount(account);
        if (validationError !== CreateAccountError.ok) {
          errors.push({ index: i, result: validationError });
          continue;
        }

        // Check if account already exists
        const existingAccount = await this.lookupAccount(account.id);
        if (existingAccount) {
          const existsError = validateAccountExists(existingAccount, account);
          errors.push({ index: i, result: existsError });
          continue;
        }

        // Compute a monotonically increasing timestamp per account
        let currentTime = BigInt(Date.now()) * 1_000_000n;
        if (currentTime <= lastTimestamp) currentTime = lastTimestamp + 1n;
        lastTimestamp = currentTime;

        // Insert account (assign system timestamp at insert time)
        try {
          await this.query(`
            INSERT INTO accounts (
              id, debits_pending, debits_posted, credits_pending, credits_posted,
              user_data_128, user_data_64, user_data_32, reserved, ledger, code, flags, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            account.id.toString(),
            account.debits_pending.toString(),
            account.debits_posted.toString(),
            account.credits_pending.toString(),
            account.credits_posted.toString(),
            account.user_data_128.toString(),
            account.user_data_64.toString(),
            account.user_data_32,
            account.reserved,
            account.ledger,
            account.code,
            account.flags,
            currentTime.toString(),
          ]);
        } catch (error) {
          // Handle database constraint violations
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (errorMsg.includes('Duplicate entry')) {
            errors.push({ index: i, result: CreateAccountError.exists });
          } else {
            throw error;
          }
        }
      }

      await this.query('COMMIT');
    } catch (error) {
      await this.query('ROLLBACK');
      throw error;
    }

    return errors;
  }

  /**
   * Create transfers with full validation and balance updates
   */
  async createTransfers(transfers: Transfer[]): Promise<CreateTransfersError[]> {
    const errors: CreateTransfersError[] = [];
    let lastTimestamp = 0n;

    await this.query('START TRANSACTION');

    try {
      for (let i = 0; i < transfers.length; i++) {
        const transfer = { ...transfers[i] };

        // Basic validation (inputs must have timestamp = 0n)
        const validationError = validateTransfer(transfer);
        if (validationError !== CreateTransferError.ok) {
          errors.push({ index: i, result: validationError });
          continue;
        }

        // Check if transfer already exists
        const existingTransfer = await this.lookupTransfer(transfer.id);
        if (existingTransfer) {
          const existsError = validateTransferExists(existingTransfer, transfer);
          errors.push({ index: i, result: existsError });
          continue;
        }

        // Load accounts
        const debitAccount = await this.lookupAccount(transfer.debit_account_id);
        const creditAccount = await this.lookupAccount(transfer.credit_account_id);

        // Load pending transfer if needed
        let pendingTransfer: Transfer | null = null;
        let pendingStatus: TransferPendingStatus | null = null;

        if (transfer.flags & (TransferFlags.post_pending_transfer | TransferFlags.void_pending_transfer)) {
          pendingTransfer = await this.lookupTransfer(transfer.pending_id);
          if (pendingTransfer) {
            const statusResult = await this.query(
              'SELECT status FROM pending_transfers WHERE id = ?',
              [transfer.pending_id.toString()]
            );
            pendingStatus = statusResult.length > 0 ? (statusResult[0] as any).status : null;
          }
        }

        // For balancing transfers, clamp the amount before validation so constraints are respected
        if (transfer.flags & (TransferFlags.balancing_debit | TransferFlags.balancing_credit)) {
          if (debitAccount && creditAccount) {
            const clampedAmount = this.calculateBalancingAmount(transfer, debitAccount, creditAccount);
            if (clampedAmount === 0n) {
              // Nothing to do if no amount can be balanced; skip without error
              continue;
            }
            transfer.amount = clampedAmount;
          }
          // If accounts are missing, let validation below report not_found
        }

        // Validate against accounts and pending transfer
        const accountValidationError = validateTransferAccounts(
          transfer,
          debitAccount!,
          creditAccount!,
          pendingTransfer || undefined,
          pendingStatus || undefined
        );
        if (accountValidationError !== CreateTransferError.ok) {
          errors.push({ index: i, result: accountValidationError });
          continue;
        }

        // Check for overflow
        const debitAmount = transfer.flags & TransferFlags.pending ? 0n : transfer.amount;
        const creditAmount = debitAmount;
        const pendingDebitAmount = transfer.flags & TransferFlags.pending ? transfer.amount : 0n;
        const pendingCreditAmount = pendingDebitAmount;

        const debitOverflow = wouldOverflowAccount(debitAccount!, debitAmount, 0n);
        if (debitOverflow) {
          errors.push({ index: i, result: debitOverflow });
          continue;
        }

        const creditOverflow = wouldOverflowAccount(creditAccount!, 0n, creditAmount);
        if (creditOverflow) {
          errors.push({ index: i, result: creditOverflow });
          continue;
        }

        // Assign a monotonically increasing timestamp after validation
        let currentTime = BigInt(Date.now()) * 1_000_000n;
        if (currentTime <= lastTimestamp) currentTime = lastTimestamp + 1n;
        lastTimestamp = currentTime;
        transfer.timestamp = currentTime;

        // Insert transfer
        await this.query(`
          INSERT INTO transfers (
            id, debit_account_id, credit_account_id, amount, pending_id,
            user_data_128, user_data_64, user_data_32, timeout, ledger, code, flags, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          transfer.id.toString(),
          transfer.debit_account_id.toString(),
          transfer.credit_account_id.toString(),
          transfer.amount.toString(),
          transfer.pending_id.toString(),
          transfer.user_data_128.toString(),
          transfer.user_data_64.toString(),
          transfer.user_data_32,
          transfer.timeout,
          transfer.ledger,
          transfer.code,
          transfer.flags,
          transfer.timestamp.toString(),
        ]);

        // Update account balances
        await this.updateAccountBalances(transfer);
      }

      await this.query('COMMIT');
    } catch (error) {
      await this.query('ROLLBACK');
      throw error;
    }

    return errors;
  }

  /**
   * Calculate actual amount for balancing transfers
   * Based on TigerBeetle's balancing transfer logic
   */
  private calculateBalancingAmount(transfer: Transfer, debitAccount: Account, creditAccount: Account): bigint {
    if (transfer.flags & TransferFlags.balancing_debit) {
      // For balancing debits, use as much as available from the debit account
      // respecting account constraints
      const maxDebitAmount = this.getMaxDebitAmount(debitAccount);
      return maxDebitAmount < transfer.amount ? maxDebitAmount : transfer.amount;
    }
    
    if (transfer.flags & TransferFlags.balancing_credit) {
      // For balancing credits, use as much as can be accepted by the credit account
      // respecting account constraints
      const maxCreditAmount = this.getMaxCreditAmount(creditAccount);
      return maxCreditAmount < transfer.amount ? maxCreditAmount : transfer.amount;
    }

    return transfer.amount;
  }

  /**
   * Get maximum amount that can be debited from an account
   */
  private getMaxDebitAmount(account: Account): bigint {
    if (account.flags & AccountFlags.debits_must_not_exceed_credits) {
      // Can only debit up to the credit balance
      const availableBalance = account.credits_posted - account.debits_posted;
      return availableBalance > 0n ? availableBalance : 0n;
    }
    // If no constraint, use a reasonable maximum (could be customized)
    return 2n ** 63n - 1n; // Max safe integer equivalent
  }

  /**
   * Get maximum amount that can be credited to an account
   */
  private getMaxCreditAmount(account: Account): bigint {
    if (account.flags & AccountFlags.credits_must_not_exceed_debits) {
      // Can only credit up to the debit balance
      const availableBalance = account.debits_posted - account.credits_posted;
      return availableBalance > 0n ? availableBalance : 0n;
    }
    // If no constraint, use a reasonable maximum
    return 2n ** 63n - 1n; // Max safe integer equivalent
  }

  /**
   * Update account balances based on transfer
   */
  private async updateAccountBalances(transfer: Transfer): Promise<void> {
    // Get the accounts to check if they have history flag
    const debitAccount = await this.lookupAccount(transfer.debit_account_id);
    const creditAccount = await this.lookupAccount(transfer.credit_account_id);
    if (transfer.flags & TransferFlags.pending) {
      // Pending transfer - update pending balances
      await this.query(`
        UPDATE accounts 
        SET debits_pending = debits_pending + ? 
        WHERE id = ?
      `, [transfer.amount.toString(), transfer.debit_account_id.toString()]);

      await this.query(`
        UPDATE accounts 
        SET credits_pending = credits_pending + ? 
        WHERE id = ?
      `, [transfer.amount.toString(), transfer.credit_account_id.toString()]);

    } else if (transfer.flags & TransferFlags.post_pending_transfer) {
      // Posting pending transfer - move from pending to posted
      await this.query(`
        UPDATE accounts 
        SET 
          debits_pending = debits_pending - ?,
          debits_posted = debits_posted + ?
        WHERE id = ?
      `, [
        transfer.amount.toString(),
        transfer.amount.toString(),
        transfer.debit_account_id.toString()
      ]);

      await this.query(`
        UPDATE accounts 
        SET 
          credits_pending = credits_pending - ?,
          credits_posted = credits_posted + ?
        WHERE id = ?
      `, [
        transfer.amount.toString(),
        transfer.amount.toString(),
        transfer.credit_account_id.toString()
      ]);

    } else if (transfer.flags & TransferFlags.void_pending_transfer) {
      // Voiding pending transfer - remove from pending balances
      await this.query(`
        UPDATE accounts 
        SET debits_pending = debits_pending - ? 
        WHERE id = ?
      `, [transfer.amount.toString(), transfer.debit_account_id.toString()]);

      await this.query(`
        UPDATE accounts 
        SET credits_pending = credits_pending - ? 
        WHERE id = ?
      `, [transfer.amount.toString(), transfer.credit_account_id.toString()]);

    } else {
      // Regular transfer - update posted balances
      await this.query(`
        UPDATE accounts 
        SET debits_posted = debits_posted + ? 
        WHERE id = ?
      `, [transfer.amount.toString(), transfer.debit_account_id.toString()]);

      await this.query(`
        UPDATE accounts 
        SET credits_posted = credits_posted + ? 
        WHERE id = ?
      `, [transfer.amount.toString(), transfer.credit_account_id.toString()]);
    }

    // Record historical balances for accounts with history flag
    if (debitAccount && (debitAccount.flags & AccountFlags.history)) {
      await this.recordAccountBalance(transfer.debit_account_id, transfer.timestamp);
    }
    if (creditAccount && (creditAccount.flags & AccountFlags.history)) {
      await this.recordAccountBalance(transfer.credit_account_id, transfer.timestamp);
    }
  }

  /**
   * Record a historical balance snapshot for an account
   */
  private async recordAccountBalance(accountId: bigint, timestamp: bigint): Promise<void> {
    // Get current account balance
    const account = await this.lookupAccount(accountId);
    if (!account) return;

    // Insert balance snapshot
    await this.query(`
      INSERT INTO account_balances (
        account_id, debits_pending, debits_posted, credits_pending, credits_posted, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        debits_pending = VALUES(debits_pending),
        debits_posted = VALUES(debits_posted),
        credits_pending = VALUES(credits_pending),
        credits_posted = VALUES(credits_posted)
    `, [
      accountId.toString(),
      account.debits_pending.toString(),
      account.debits_posted.toString(),
      account.credits_pending.toString(),
      account.credits_posted.toString(),
      timestamp.toString()
    ]);
  }

  /**
   * Lookup a single account by ID
   */
  async lookupAccount(id: bigint): Promise<Account | null> {
    const results = await this.query('SELECT * FROM accounts WHERE id = ?', [id.toString()]);
    
    if (results.length === 0) return null;

    const row = results[0] as any;
    return {
      id: BigInt(row.id),
      debits_pending: BigInt(row.debits_pending),
      debits_posted: BigInt(row.debits_posted),
      credits_pending: BigInt(row.credits_pending),
      credits_posted: BigInt(row.credits_posted),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      reserved: row.reserved,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    };
  }

  /**
   * Lookup multiple accounts by ID
   */
  async lookupAccounts(ids: bigint[]): Promise<Account[]> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const results = await this.query(
      `SELECT * FROM accounts WHERE id IN (${placeholders}) ORDER BY id`,
      ids.map(id => id.toString())
    );

    return results.map((row: any) => ({
      id: BigInt(row.id),
      debits_pending: BigInt(row.debits_pending),
      debits_posted: BigInt(row.debits_posted),
      credits_pending: BigInt(row.credits_pending),
      credits_posted: BigInt(row.credits_posted),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      reserved: row.reserved,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    }));
  }

  /**
   * Lookup a single transfer by ID
   */
  async lookupTransfer(id: bigint): Promise<Transfer | null> {
    const results = await this.query('SELECT * FROM transfers WHERE id = ?', [id.toString()]);
    
    if (results.length === 0) return null;

    const row = results[0] as any;
    return {
      id: BigInt(row.id),
      debit_account_id: BigInt(row.debit_account_id),
      credit_account_id: BigInt(row.credit_account_id),
      amount: BigInt(row.amount),
      pending_id: BigInt(row.pending_id),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      timeout: row.timeout,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    };
  }

  /**
   * Lookup multiple transfers by ID
   */
  async lookupTransfers(ids: bigint[]): Promise<Transfer[]> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const results = await this.query(
      `SELECT * FROM transfers WHERE id IN (${placeholders}) ORDER BY id`,
      ids.map(id => id.toString())
    );

    return results.map((row: any) => ({
      id: BigInt(row.id),
      debit_account_id: BigInt(row.debit_account_id),
      credit_account_id: BigInt(row.credit_account_id),
      amount: BigInt(row.amount),
      pending_id: BigInt(row.pending_id),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      timeout: row.timeout,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    }));
  }

  /**
   * Get transfers for an account using filter
   */
  async getAccountTransfers(filter: AccountFilter): Promise<Transfer[]> {
    const conditions: string[] = [];
    const params: string[] = [];

    // Account condition (debits, credits, or both)
    const wantDebits = (filter.flags & 1) !== 0;
    const wantCredits = (filter.flags & 2) !== 0;
    if (wantDebits && wantCredits) {
      conditions.push('(debit_account_id = ? OR credit_account_id = ?)');
      params.push(filter.account_id.toString(), filter.account_id.toString());
    } else if (wantDebits) {
      conditions.push('debit_account_id = ?');
      params.push(filter.account_id.toString());
    } else if (wantCredits) {
      conditions.push('credit_account_id = ?');
      params.push(filter.account_id.toString());
    } else {
      // Default to both if no flags specified
      conditions.push('(debit_account_id = ? OR credit_account_id = ?)');
      params.push(filter.account_id.toString(), filter.account_id.toString());
    }

    // Optional filters
    if (filter.user_data_128 !== 0n) {
      conditions.push('user_data_128 = ?');
      params.push(filter.user_data_128.toString());
    }
    if (filter.user_data_64 !== 0n) {
      conditions.push('user_data_64 = ?');
      params.push(filter.user_data_64.toString());
    }
    if (filter.user_data_32 !== 0) {
      conditions.push('user_data_32 = ?');
      params.push(filter.user_data_32.toString());
    }
    if (filter.code !== 0) {
      conditions.push('code = ?');
      params.push(filter.code.toString());
    }
    if (filter.timestamp_min !== 0n) {
      conditions.push('timestamp >= ?');
      params.push(filter.timestamp_min.toString());
    }
    if (filter.timestamp_max !== 0n) {
      conditions.push('timestamp <= ?');
      params.push(filter.timestamp_max.toString());
    }

    const orderDirection = (filter.flags & 4) ? 'DESC' : 'ASC'; // reversed flag
    const sql = `
      SELECT * FROM transfers 
      WHERE ${conditions.join(' AND ')} 
      ORDER BY timestamp ${orderDirection}
      LIMIT ${filter.limit}
    `;

    const results = await this.query(sql, params);
    return results.map((row: any) => ({
      id: BigInt(row.id),
      debit_account_id: BigInt(row.debit_account_id),
      credit_account_id: BigInt(row.credit_account_id),
      amount: BigInt(row.amount),
      pending_id: BigInt(row.pending_id),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      timeout: row.timeout,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    }));
  }

  /**
   * Query accounts using filter
   */
  async queryAccounts(filter: QueryFilter): Promise<Account[]> {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filter.user_data_128 !== 0n) {
      conditions.push('user_data_128 = ?');
      params.push(filter.user_data_128.toString());
    }
    if (filter.user_data_64 !== 0n) {
      conditions.push('user_data_64 = ?');
      params.push(filter.user_data_64.toString());
    }
    if (filter.user_data_32 !== 0) {
      conditions.push('user_data_32 = ?');
      params.push(filter.user_data_32.toString());
    }
    if (filter.ledger !== 0) {
      conditions.push('ledger = ?');
      params.push(filter.ledger.toString());
    }
    if (filter.code !== 0) {
      conditions.push('code = ?');
      params.push(filter.code.toString());
    }
    if (filter.timestamp_min !== 0n) {
      conditions.push('timestamp >= ?');
      params.push(filter.timestamp_min.toString());
    }
    if (filter.timestamp_max !== 0n) {
      conditions.push('timestamp <= ?');
      params.push(filter.timestamp_max.toString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderDirection = (filter.flags & 1) ? 'DESC' : 'ASC'; // reversed flag
    
    const sql = `SELECT * FROM accounts ${whereClause} ORDER BY timestamp ${orderDirection} LIMIT ${filter.limit}`;

    const results = await this.query(sql, params);
    return results.map((row: any) => ({
      id: BigInt(row.id),
      debits_pending: BigInt(row.debits_pending),
      debits_posted: BigInt(row.debits_posted),
      credits_pending: BigInt(row.credits_pending),
      credits_posted: BigInt(row.credits_posted),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      reserved: row.reserved,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    }));
  }

  /**
   * Query transfers using filter
   */
  async queryTransfers(filter: QueryFilter): Promise<Transfer[]> {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filter.user_data_128 !== 0n) {
      conditions.push('user_data_128 = ?');
      params.push(filter.user_data_128.toString());
    }
    if (filter.user_data_64 !== 0n) {
      conditions.push('user_data_64 = ?');
      params.push(filter.user_data_64.toString());
    }
    if (filter.user_data_32 !== 0) {
      conditions.push('user_data_32 = ?');
      params.push(filter.user_data_32.toString());
    }
    if (filter.ledger !== 0) {
      conditions.push('ledger = ?');
      params.push(filter.ledger.toString());
    }
    if (filter.code !== 0) {
      conditions.push('code = ?');
      params.push(filter.code.toString());
    }
    if (filter.timestamp_min !== 0n) {
      conditions.push('timestamp >= ?');
      params.push(filter.timestamp_min.toString());
    }
    if (filter.timestamp_max !== 0n) {
      conditions.push('timestamp <= ?');
      params.push(filter.timestamp_max.toString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderDirection = (filter.flags & 1) ? 'DESC' : 'ASC'; // reversed flag
    
    const sql = `SELECT * FROM transfers ${whereClause} ORDER BY timestamp ${orderDirection} LIMIT ${filter.limit}`;

    const results = await this.query(sql, params);
    return results.map((row: any) => ({
      id: BigInt(row.id),
      debit_account_id: BigInt(row.debit_account_id),
      credit_account_id: BigInt(row.credit_account_id),
      amount: BigInt(row.amount),
      pending_id: BigInt(row.pending_id),
      user_data_128: BigInt(row.user_data_128),
      user_data_64: BigInt(row.user_data_64),
      user_data_32: row.user_data_32,
      timeout: row.timeout,
      ledger: row.ledger,
      code: row.code,
      flags: row.flags,
      timestamp: BigInt(row.timestamp),
    }));
  }

  /**
   * Get historical account balances for an account using filter
   * Only returns balances for accounts with the history flag set
   */
  async getAccountBalances(filter: AccountFilter): Promise<AccountBalance[]> {
    // First check if the account has the history flag
    const account = await this.lookupAccount(filter.account_id);
    if (!account || !(account.flags & AccountFlags.history)) {
      return []; // No historical balances for accounts without history flag
    }

    const conditions: string[] = ['account_id = ?'];
    const params: string[] = [filter.account_id.toString()];

    // Optional filters - only apply timestamp filters for balances
    if (filter.timestamp_min !== 0n) {
      conditions.push('timestamp >= ?');
      params.push(filter.timestamp_min.toString());
    }
    if (filter.timestamp_max !== 0n) {
      conditions.push('timestamp <= ?');
      params.push(filter.timestamp_max.toString());
    }

    const orderDirection = (filter.flags & 4) ? 'DESC' : 'ASC'; // reversed flag
    const sql = `
      SELECT * FROM account_balances 
      WHERE ${conditions.join(' AND ')} 
      ORDER BY timestamp ${orderDirection}
      LIMIT ${filter.limit}
    `;

    const results = await this.query(sql, params);
    return results.map((row: any) => ({
      account_id: BigInt(row.account_id),
      debits_pending: BigInt(row.debits_pending),
      debits_posted: BigInt(row.debits_posted),
      credits_pending: BigInt(row.credits_pending),
      credits_posted: BigInt(row.credits_posted),
      timestamp: BigInt(row.timestamp),
    }));
  }

  /**
   * Clear all test data from the database
   * WARNING: This will delete all data - only use for testing!
   */
  async clearDatabase(): Promise<void> {
    if (Deno.env.get('NODE_ENV') === 'production') {
      throw new Error('clearDatabase() is not allowed in production environment');
    }

    // Disable foreign key checks temporarily for MySQL
    await this.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      // Order matters due to foreign key constraints, but we disabled them temporarily
      await this.query('DELETE FROM pending_transfers');
      await this.query('DELETE FROM account_balances');
      await this.query('DELETE FROM transfers');
      await this.query('DELETE FROM accounts');
    } finally {
      // Re-enable foreign key checks
      await this.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  }
}