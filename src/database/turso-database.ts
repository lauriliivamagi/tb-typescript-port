/**
 * Turso/SQLite database implementation for TigerBeetle port
 * Implements IDatabaseInterface using libSQL client for Turso Cloud or local SQLite
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
import { IDatabaseInterface, TursoConfig } from './database-interface.ts';

// Turso/libSQL client
import { createClient, Client, Transaction } from '@libsql/client';

export class TursoDatabase implements IDatabaseInterface {
  private config: TursoConfig;
  private client: Client | undefined;

  constructor(config: TursoConfig) {
    this.config = config;
  }

  /**
   * Connect to Turso database
   */
  async connect(): Promise<void> {
    try {
      const clientConfig: { url: string; authToken?: string } = {
        url: this.config.url,
      };
      
      // Only add authToken if it's provided (for remote Turso)
      if (this.config.authToken) {
        clientConfig.authToken = this.config.authToken;
      }
      
      this.client = createClient(clientConfig);
      
      // Enable foreign key constraints for SQLite
      await this.query('PRAGMA foreign_keys = ON');
      
      // For local development, initialize schema if needed
      if (this.config.url.includes('127.0.0.1') || this.config.url.includes('localhost')) {
        await this.initializeSchemaIfNeeded();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to connect to Turso: ${errorMsg}`);
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
   * Initialize database schema if tables don't exist (for local development)
   */
  private async initializeSchemaIfNeeded(): Promise<void> {
    try {
      // Check if accounts table exists
      await this.query("SELECT 1 FROM accounts LIMIT 1");
    } catch (error) {
      // If table doesn't exist, create the schema
      console.log('Initializing local Turso database schema...');
      await this.createSchema();
    }
  }

  /**
   * Create the full database schema
   */
  private async createSchema(): Promise<void> {
    const schemaSQL = `
      -- Drop existing tables if they exist (for clean slate)
      DROP TABLE IF EXISTS pending_transfers;
      DROP TABLE IF EXISTS account_balances;
      DROP TABLE IF EXISTS transfers;
      DROP TABLE IF EXISTS accounts;

      -- Accounts table
      CREATE TABLE accounts (
          id TEXT PRIMARY KEY,
          debits_pending TEXT NOT NULL DEFAULT '0',
          debits_posted TEXT NOT NULL DEFAULT '0',
          credits_pending TEXT NOT NULL DEFAULT '0',
          credits_posted TEXT NOT NULL DEFAULT '0',
          user_data_128 TEXT NOT NULL DEFAULT '0',
          user_data_64 TEXT NOT NULL DEFAULT '0',
          user_data_32 INTEGER NOT NULL DEFAULT 0,
          reserved INTEGER NOT NULL DEFAULT 0,
          ledger INTEGER NOT NULL,
          code INTEGER NOT NULL,
          flags INTEGER NOT NULL DEFAULT 0,
          timestamp TEXT NOT NULL DEFAULT '0',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          CHECK (CAST(id AS INTEGER) > 0),
          CHECK (ledger > 0),
          CHECK (code > 0)
      );

      -- Transfers table
      CREATE TABLE transfers (
          id TEXT PRIMARY KEY,
          debit_account_id TEXT NOT NULL,
          credit_account_id TEXT NOT NULL,
          amount TEXT NOT NULL,
          pending_id TEXT NOT NULL DEFAULT '0',
          user_data_128 TEXT NOT NULL DEFAULT '0',
          user_data_64 TEXT NOT NULL DEFAULT '0',
          user_data_32 INTEGER NOT NULL DEFAULT 0,
          timeout INTEGER NOT NULL DEFAULT 0,
          ledger INTEGER NOT NULL,
          code INTEGER NOT NULL,
          flags INTEGER NOT NULL DEFAULT 0,
          timestamp TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          CHECK (CAST(id AS INTEGER) > 0),
          CHECK (CAST(amount AS INTEGER) >= 0),
          CHECK (ledger > 0),
          CHECK (code > 0),
          FOREIGN KEY (debit_account_id) REFERENCES accounts(id),
          FOREIGN KEY (credit_account_id) REFERENCES accounts(id)
      );

      -- Account balances history table
      CREATE TABLE account_balances (
          account_id TEXT NOT NULL,
          debits_pending TEXT NOT NULL DEFAULT '0',
          debits_posted TEXT NOT NULL DEFAULT '0',
          credits_pending TEXT NOT NULL DEFAULT '0',
          credits_posted TEXT NOT NULL DEFAULT '0',
          timestamp TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (account_id, timestamp),
          FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      -- Pending transfers status table
      CREATE TABLE pending_transfers (
          id TEXT PRIMARY KEY,
          status INTEGER NOT NULL DEFAULT 0,
          timeout_timestamp TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (id) REFERENCES transfers(id)
      );

      -- Indexes for performance
      CREATE INDEX idx_accounts_ledger_code ON accounts(ledger, code);
      CREATE INDEX idx_transfers_debit_account ON transfers(debit_account_id);
      CREATE INDEX idx_transfers_credit_account ON transfers(credit_account_id);
      CREATE INDEX idx_transfers_ledger_code ON transfers(ledger, code);
      CREATE INDEX idx_transfers_timestamp ON transfers(timestamp);
      CREATE INDEX idx_account_balances_timestamp ON account_balances(timestamp);
    `;

    // Execute schema creation in parts (SQLite doesn't support multiple statements well)
    const statements = schemaSQL.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      if (statement.trim()) {
        await this.query(statement.trim());
      }
    }
    
    console.log('Local Turso database schema initialized successfully!');
  }

  /**
   * Execute a SQL query
   */
  async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    if (!this.client) throw new Error('Not connected');
    
    try {
      const result = await this.client.execute({
        sql,
        args: params as any[], // libSQL client accepts various types
      });
      
      return result.rows || [];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Query failed: ${errorMsg}`);
    }
  }

  /**
   * Create accounts with validation and error handling
   * Uses libSQL transaction API for proper transaction management
   */
  async createAccounts(accounts: Account[]): Promise<CreateAccountsError[]> {
    if (!this.client) throw new Error('Not connected');
    
    const errors: CreateAccountsError[] = [];
    let lastTimestamp = 0n;

    // Use libSQL transaction API instead of raw SQL commands
    const tx = await this.client.transaction('write');
    
    try {
      for (let i = 0; i < accounts.length; i++) {
        const account = { ...accounts[i] };

        // Validate account (inputs must have timestamp = 0n)
        const validationError = validateAccount(account);
        if (validationError !== CreateAccountError.ok) {
          errors.push({ index: i, result: validationError });
          continue;
        }

        // Check if account already exists (use transaction context)
        const existingAccount = await this.lookupAccountInTransaction(tx, account.id);
        if (existingAccount) {
          const existsError = validateAccountExists(existingAccount, account);
          errors.push({ index: i, result: existsError });
          continue;
        }

        // Compute a monotonically increasing timestamp per account
        let currentTime = BigInt(Date.now()) * 1_000_000n;
        if (currentTime <= lastTimestamp) currentTime = lastTimestamp + 1n;
        lastTimestamp = currentTime;

        // Insert account using libSQL transaction execute
        try {
          await tx.execute({
            sql: `
              INSERT INTO accounts (
                id, debits_pending, debits_posted, credits_pending, credits_posted,
                user_data_128, user_data_64, user_data_32, reserved, ledger, code, flags, timestamp
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            args: [
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
            ]
          });
        } catch (error) {
          // Handle database constraint violations
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (errorMsg.includes('UNIQUE constraint failed')) {
            errors.push({ index: i, result: CreateAccountError.exists });
          } else {
            throw error;
          }
        }
      }

      // Commit using libSQL transaction API
      await tx.commit();
    } catch (error) {
      // Rollback using libSQL transaction API
      await tx.rollback();
      throw error;
    }

    return errors;
  }

  /**
   * Create transfers with full validation and balance updates
   * Uses libSQL transaction API for proper transaction management
   */
  async createTransfers(transfers: Transfer[]): Promise<CreateTransfersError[]> {
    if (!this.client) throw new Error('Not connected');
    
    const errors: CreateTransfersError[] = [];
    let lastTimestamp = 0n;

    // Use libSQL transaction API instead of raw SQL commands
    const tx = await this.client.transaction('write');

    try {
      for (let i = 0; i < transfers.length; i++) {
        const transfer = { ...transfers[i] };

        // Basic validation (inputs must have timestamp = 0n)
        const validationError = validateTransfer(transfer);
        if (validationError !== CreateTransferError.ok) {
          errors.push({ index: i, result: validationError });
          continue;
        }

        // Check if transfer already exists (use transaction context)
        const existingTransfer = await this.lookupTransferInTransaction(tx, transfer.id);
        if (existingTransfer) {
          const existsError = validateTransferExists(existingTransfer, transfer);
          errors.push({ index: i, result: existsError });
          continue;
        }

        // Load accounts (use transaction context)
        const debitAccount = await this.lookupAccountInTransaction(tx, transfer.debit_account_id);
        const creditAccount = await this.lookupAccountInTransaction(tx, transfer.credit_account_id);

        // Load pending transfer if needed (use transaction context)
        let pendingTransfer: Transfer | null = null;
        let pendingStatus: TransferPendingStatus | null = null;

        if (transfer.flags & (TransferFlags.post_pending_transfer | TransferFlags.void_pending_transfer)) {
          pendingTransfer = await this.lookupTransferInTransaction(tx, transfer.pending_id);
          if (pendingTransfer) {
            const statusResult = await tx.execute({
              sql: 'SELECT status FROM pending_transfers WHERE id = ?',
              args: [transfer.pending_id.toString()]
            });
            pendingStatus = statusResult.rows.length > 0 ? (statusResult.rows[0] as any).status : null;
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

        // Insert transfer using libSQL transaction execute
        await tx.execute({
          sql: `
            INSERT INTO transfers (
              id, debit_account_id, credit_account_id, amount, pending_id,
              user_data_128, user_data_64, user_data_32, timeout, ledger, code, flags, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [
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
          ]
        });

        // Track pending transfers in the status table
        if (transfer.flags & TransferFlags.pending) {
          // Calculate expiration timestamp if timeout is set
          const expiresAt = transfer.timeout > 0 
            ? (transfer.timestamp + BigInt(transfer.timeout * 1_000_000_000)).toString() // Convert seconds to nanoseconds
            : '0';
            
          await tx.execute({
            sql: `INSERT INTO pending_transfers (id, status, expires_at, timestamp) VALUES (?, ?, ?, ?)`,
            args: [
              transfer.id.toString(),
              1, // TransferPendingStatus.pending
              expiresAt,
              transfer.timestamp.toString()
            ]
          });
        }

        // Update pending transfer status for post/void operations
        if (transfer.flags & TransferFlags.post_pending_transfer) {
          await tx.execute({
            sql: `UPDATE pending_transfers SET status = ?, timestamp = ? WHERE id = ?`,
            args: [
              2, // TransferPendingStatus.posted
              transfer.timestamp.toString(),
              transfer.pending_id.toString()
            ]
          });
        }

        if (transfer.flags & TransferFlags.void_pending_transfer) {
          await tx.execute({
            sql: `UPDATE pending_transfers SET status = ?, timestamp = ? WHERE id = ?`,
            args: [
              3, // TransferPendingStatus.voided
              transfer.timestamp.toString(),
              transfer.pending_id.toString()
            ]
          });
        }

        // Update account balances using transaction context
        await this.updateAccountBalancesInTransaction(tx, transfer);
      }

      // Commit using libSQL transaction API
      await tx.commit();
    } catch (error) {
      // Rollback using libSQL transaction API
      await tx.rollback();
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
   * Update account balances within a transaction context
   * Transaction-aware version of updateAccountBalances
   */
  private async updateAccountBalancesInTransaction(tx: Transaction, transfer: Transfer): Promise<void> {
    // Get the accounts to check if they have history flag
    const debitAccount = await this.lookupAccountInTransaction(tx, transfer.debit_account_id);
    const creditAccount = await this.lookupAccountInTransaction(tx, transfer.credit_account_id);
    
    if (transfer.flags & TransferFlags.pending) {
      // Pending transfer - update pending balances
      await tx.execute({
        sql: `UPDATE accounts SET debits_pending = debits_pending + ? WHERE id = ?`,
        args: [transfer.amount.toString(), transfer.debit_account_id.toString()]
      });

      await tx.execute({
        sql: `UPDATE accounts SET credits_pending = credits_pending + ? WHERE id = ?`,
        args: [transfer.amount.toString(), transfer.credit_account_id.toString()]
      });

    } else if (transfer.flags & TransferFlags.post_pending_transfer) {
      // Posting pending transfer - move from pending to posted
      await tx.execute({
        sql: `
          UPDATE accounts 
          SET 
            debits_pending = debits_pending - ?,
            debits_posted = debits_posted + ?
          WHERE id = ?
        `,
        args: [
          transfer.amount.toString(),
          transfer.amount.toString(),
          transfer.debit_account_id.toString()
        ]
      });

      await tx.execute({
        sql: `
          UPDATE accounts 
          SET 
            credits_pending = credits_pending - ?,
            credits_posted = credits_posted + ?
          WHERE id = ?
        `,
        args: [
          transfer.amount.toString(),
          transfer.amount.toString(),
          transfer.credit_account_id.toString()
        ]
      });

    } else if (transfer.flags & TransferFlags.void_pending_transfer) {
      // Voiding pending transfer - remove from pending balances
      await tx.execute({
        sql: `UPDATE accounts SET debits_pending = debits_pending - ? WHERE id = ?`,
        args: [transfer.amount.toString(), transfer.debit_account_id.toString()]
      });

      await tx.execute({
        sql: `UPDATE accounts SET credits_pending = credits_pending - ? WHERE id = ?`,
        args: [transfer.amount.toString(), transfer.credit_account_id.toString()]
      });

    } else {
      // Regular transfer - update posted balances
      await tx.execute({
        sql: `UPDATE accounts SET debits_posted = debits_posted + ? WHERE id = ?`,
        args: [transfer.amount.toString(), transfer.debit_account_id.toString()]
      });

      await tx.execute({
        sql: `UPDATE accounts SET credits_posted = credits_posted + ? WHERE id = ?`,
        args: [transfer.amount.toString(), transfer.credit_account_id.toString()]
      });
    }

    // Record historical balances for accounts with history flag
    // Note: For simplicity, we skip history recording in transactions for now
    // This would require a transaction-aware version of recordAccountBalance
    if (debitAccount && (debitAccount.flags & AccountFlags.history)) {
      await this.recordAccountBalanceInTransaction(tx, transfer.debit_account_id, transfer.timestamp);
    }
    if (creditAccount && (creditAccount.flags & AccountFlags.history)) {
      await this.recordAccountBalanceInTransaction(tx, transfer.credit_account_id, transfer.timestamp);
    }
  }

  /**
   * Record a historical balance snapshot for an account within a transaction
   */
  private async recordAccountBalanceInTransaction(tx: Transaction, accountId: bigint, timestamp: bigint): Promise<void> {
    // Get current account balance from transaction context
    const account = await this.lookupAccountInTransaction(tx, accountId);
    if (!account) return;

    // Insert balance snapshot using SQLite's UPSERT (INSERT OR REPLACE)
    await tx.execute({
      sql: `
        INSERT OR REPLACE INTO account_balances (
          account_id, debits_pending, debits_posted, credits_pending, credits_posted, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        accountId.toString(),
        account.debits_pending.toString(),
        account.debits_posted.toString(),
        account.credits_pending.toString(),
        account.credits_posted.toString(),
        timestamp.toString(),
      ]
    });
  }

  /**
   * Record a historical balance snapshot for an account
   */
  private async recordAccountBalance(accountId: bigint, timestamp: bigint): Promise<void> {
    // Get current account balance
    const account = await this.lookupAccount(accountId);
    if (!account) return;

    // Insert balance snapshot using SQLite's UPSERT (INSERT OR REPLACE)
    await this.query(`
      INSERT OR REPLACE INTO account_balances (
        account_id, debits_pending, debits_posted, credits_pending, credits_posted, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?)
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
   * Convert a SQLite row to an Account object
   */
  private rowToAccount(row: any): Account {
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
   * Convert a SQLite row to a Transfer object
   */
  private rowToTransfer(row: any): Transfer {
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
   * Lookup a single account by ID
   */
  async lookupAccount(id: bigint): Promise<Account | null> {
    const results = await this.query('SELECT * FROM accounts WHERE id = ?', [id.toString()]);
    
    if (results.length === 0) return null;

    return this.rowToAccount(results[0]);
  }

  /**
   * Lookup a single account by ID within a transaction context
   */
  private async lookupAccountInTransaction(tx: Transaction, id: bigint): Promise<Account | null> {
    const result = await tx.execute({
      sql: 'SELECT * FROM accounts WHERE id = ?',
      args: [id.toString()]
    });
    
    if (result.rows.length === 0) return null;

    return this.rowToAccount(result.rows[0]);
  }

  /**
   * Lookup a single transfer by ID within a transaction context
   */
  private async lookupTransferInTransaction(tx: Transaction, id: bigint): Promise<Transfer | null> {
    const result = await tx.execute({
      sql: 'SELECT * FROM transfers WHERE id = ?',
      args: [id.toString()]
    });
    
    if (result.rows.length === 0) return null;

    return this.rowToTransfer(result.rows[0]);
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

    return results.map(row => this.rowToAccount(row));
  }

  /**
   * Lookup a single transfer by ID
   */
  async lookupTransfer(id: bigint): Promise<Transfer | null> {
    const results = await this.query('SELECT * FROM transfers WHERE id = ?', [id.toString()]);
    
    if (results.length === 0) return null;

    return this.rowToTransfer(results[0]);
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

    return results.map(row => this.rowToTransfer(row));
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
    return results.map(row => this.rowToTransfer(row));
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
    return results.map(row => this.rowToAccount(row));
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
    return results.map(row => this.rowToTransfer(row));
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

    // Order matters due to foreign key constraints
    await this.query('DELETE FROM pending_transfers');
    await this.query('DELETE FROM account_balances');
    await this.query('DELETE FROM transfers');
    await this.query('DELETE FROM accounts');
  }
}