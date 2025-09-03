/**
 * TigerBeetle-compatible client API
 * Provides the same interface as the Node.js client
 */

import {
  Account,
  Transfer,
  AccountID,
  TransferID,
  AccountFilter,
  QueryFilter,
  AccountBalance,
  CreateAccountsError,
  CreateTransfersError,
} from './types.ts';
import { TigerBeetleDatabase } from './database.ts';
import { AnyDatabaseConfig, MySQLConfig, createDatabase } from './database/index.ts';

// Legacy MySQL config for backward compatibility (without type field)
export interface LegacyMySQLConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
}

export interface Client {
  createAccounts: (batch: Account[]) => Promise<CreateAccountsError[]>;
  createTransfers: (batch: Transfer[]) => Promise<CreateTransfersError[]>;
  lookupAccounts: (batch: AccountID[]) => Promise<Account[]>;
  lookupTransfers: (batch: TransferID[]) => Promise<Transfer[]>;
  getAccountTransfers: (filter: AccountFilter) => Promise<Transfer[]>;
  getAccountBalances: (filter: AccountFilter) => Promise<AccountBalance[]>;
  queryAccounts: (filter: QueryFilter) => Promise<Account[]>;
  queryTransfers: (filter: QueryFilter) => Promise<Transfer[]>;
  clearDatabase: () => Promise<void>;
  destroy: () => Promise<void>;
}

/**
 * Create a TigerBeetle client with database configuration
 * Supports both MySQL and Turso backends
 * Maintains backward compatibility with legacy MySQL configs
 */
export function createClient(config?: AnyDatabaseConfig | LegacyMySQLConfig): Client {
  let dbConfig: AnyDatabaseConfig | undefined;
  
  if (config) {
    // Check if this is a legacy MySQL config (missing 'type' field)
    if (!('type' in config)) {
      // Convert legacy config to new format
      dbConfig = {
        type: 'mysql' as const,
        ...config
      } as MySQLConfig;
    } else {
      dbConfig = config;
    }
  }
  
  const database = dbConfig ? 
    new TigerBeetleDatabase(createDatabase(dbConfig)) :
    new TigerBeetleDatabase(); // Uses environment variables
  let isConnected = false;
  let isDestroyed = false;

  const ensureConnected = async () => {
    if (isDestroyed) {
      throw new Error('Client was destroyed');
    }
    if (!isConnected) {
      await database.connect();
      isConnected = true;
    }
  };

  return {
    async createAccounts(batch: Account[]): Promise<CreateAccountsError[]> {
      await ensureConnected();
      return database.createAccounts(batch);
    },

    async createTransfers(batch: Transfer[]): Promise<CreateTransfersError[]> {
      await ensureConnected();
      return database.createTransfers(batch);
    },

    async lookupAccounts(batch: AccountID[]): Promise<Account[]> {
      await ensureConnected();
      return database.lookupAccounts(batch);
    },

    async lookupTransfers(batch: TransferID[]): Promise<Transfer[]> {
      await ensureConnected();
      return database.lookupTransfers(batch);
    },

    async getAccountTransfers(filter: AccountFilter): Promise<Transfer[]> {
      await ensureConnected();
      return database.getAccountTransfers(filter);
    },

    async getAccountBalances(filter: AccountFilter): Promise<AccountBalance[]> {
      await ensureConnected();
      return database.getAccountBalances(filter);
    },

    async queryAccounts(filter: QueryFilter): Promise<Account[]> {
      await ensureConnected();
      return database.queryAccounts(filter);
    },

    async queryTransfers(filter: QueryFilter): Promise<Transfer[]> {
      await ensureConnected();
      return database.queryTransfers(filter);
    },

    async clearDatabase(): Promise<void> {
      await ensureConnected();
      return database.clearDatabase();
    },

    async destroy(): Promise<void> {
      if (isDestroyed) return;
      
      isDestroyed = true;
      if (isConnected) {
        await database.disconnect();
        isConnected = false;
      }
    },
  };
}