/**
 * Database factory and main TigerBeetle database interface
 * Provides database operations with support for multiple database backends (MySQL, Turso)
 */

import { IDatabaseInterface, createDatabaseFromEnv } from './database/index.ts';

/**
 * TigerBeetleDatabase - Main database class that delegates to the appropriate implementation
 * Maintains backward compatibility with existing code while supporting multiple database backends
 */
export class TigerBeetleDatabase implements IDatabaseInterface {
  private database: IDatabaseInterface;

  constructor(database?: IDatabaseInterface) {
    // If no database is provided, create one from environment variables
    this.database = database || createDatabaseFromEnv();
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    return this.database.connect();
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    return this.database.disconnect();
  }

  /**
   * Execute a raw SQL query (for internal use)
   */
  async query(sql: string, params?: unknown[]): Promise<unknown[]> {
    return this.database.query(sql, params);
  }

  /**
   * Create accounts with validation and error handling
   */
  async createAccounts(accounts: import('./types.ts').Account[]): Promise<import('./types.ts').CreateAccountsError[]> {
    return this.database.createAccounts(accounts);
  }

  /**
   * Create transfers with full validation and balance updates
   */
  async createTransfers(transfers: import('./types.ts').Transfer[]): Promise<import('./types.ts').CreateTransfersError[]> {
    return this.database.createTransfers(transfers);
  }

  /**
   * Lookup a single account by ID
   */
  async lookupAccount(id: bigint): Promise<import('./types.ts').Account | null> {
    return this.database.lookupAccount(id);
  }

  /**
   * Lookup multiple accounts by ID
   */
  async lookupAccounts(ids: bigint[]): Promise<import('./types.ts').Account[]> {
    return this.database.lookupAccounts(ids);
  }

  /**
   * Lookup a single transfer by ID
   */
  async lookupTransfer(id: bigint): Promise<import('./types.ts').Transfer | null> {
    return this.database.lookupTransfer(id);
  }

  /**
   * Lookup multiple transfers by ID
   */
  async lookupTransfers(ids: bigint[]): Promise<import('./types.ts').Transfer[]> {
    return this.database.lookupTransfers(ids);
  }

  /**
   * Get transfers for an account using filter
   */
  async getAccountTransfers(filter: import('./types.ts').AccountFilter): Promise<import('./types.ts').Transfer[]> {
    return this.database.getAccountTransfers(filter);
  }

  /**
   * Query accounts using filter
   */
  async queryAccounts(filter: import('./types.ts').QueryFilter): Promise<import('./types.ts').Account[]> {
    return this.database.queryAccounts(filter);
  }

  /**
   * Query transfers using filter
   */
  async queryTransfers(filter: import('./types.ts').QueryFilter): Promise<import('./types.ts').Transfer[]> {
    return this.database.queryTransfers(filter);
  }

  /**
   * Get historical account balances for an account using filter
   * Only returns balances for accounts with the history flag set
   */
  async getAccountBalances(filter: import('./types.ts').AccountFilter): Promise<import('./types.ts').AccountBalance[]> {
    return this.database.getAccountBalances(filter);
  }

  /**
   * Clear all test data from the database
   * WARNING: This will delete all data - only use for testing!
   */
  async clearDatabase(): Promise<void> {
    return this.database.clearDatabase();
  }
}

/**
 * Create a TigerBeetle database instance from environment variables
 * This is the main entry point for most applications
 */
export function createTigerBeetleDatabase(): TigerBeetleDatabase {
  return new TigerBeetleDatabase();
}