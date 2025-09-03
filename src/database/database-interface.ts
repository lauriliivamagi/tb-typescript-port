/**
 * Abstract database interface for TigerBeetle operations
 * Allows switching between different database implementations (MySQL, Turso, etc.)
 */

import {
  Account,
  Transfer,
  AccountFilter,
  QueryFilter,
  AccountBalance,
  CreateAccountsError,
  CreateTransfersError,
} from '../types.ts';

export interface DatabaseConfig {
  type: 'mysql' | 'turso';
}

export interface MySQLConfig extends DatabaseConfig {
  type: 'mysql';
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

export interface TursoConfig extends DatabaseConfig {
  type: 'turso';
  url: string;
  authToken?: string;
}

export type AnyDatabaseConfig = MySQLConfig | TursoConfig;

/**
 * Abstract interface for database operations
 * All database implementations must implement this interface
 */
export interface IDatabaseInterface {
  /**
   * Connect to the database
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the database
   */
  disconnect(): Promise<void>;

  /**
   * Execute a raw SQL query (for internal use)
   */
  query(sql: string, params?: unknown[]): Promise<unknown[]>;

  /**
   * Create accounts with validation and error handling
   */
  createAccounts(accounts: Account[]): Promise<CreateAccountsError[]>;

  /**
   * Create transfers with full validation and balance updates
   */
  createTransfers(transfers: Transfer[]): Promise<CreateTransfersError[]>;

  /**
   * Lookup a single account by ID
   */
  lookupAccount(id: bigint): Promise<Account | null>;

  /**
   * Lookup multiple accounts by ID
   */
  lookupAccounts(ids: bigint[]): Promise<Account[]>;

  /**
   * Lookup a single transfer by ID
   */
  lookupTransfer(id: bigint): Promise<Transfer | null>;

  /**
   * Lookup multiple transfers by ID
   */
  lookupTransfers(ids: bigint[]): Promise<Transfer[]>;

  /**
   * Get transfers for an account using filter
   */
  getAccountTransfers(filter: AccountFilter): Promise<Transfer[]>;

  /**
   * Query accounts using filter
   */
  queryAccounts(filter: QueryFilter): Promise<Account[]>;

  /**
   * Query transfers using filter
   */
  queryTransfers(filter: QueryFilter): Promise<Transfer[]>;

  /**
   * Get historical account balances for an account using filter
   * Only returns balances for accounts with the history flag set
   */
  getAccountBalances(filter: AccountFilter): Promise<AccountBalance[]>;

  /**
   * Clear all test data from the database
   * WARNING: This will delete all data - only use for testing!
   */
  clearDatabase(): Promise<void>;
}