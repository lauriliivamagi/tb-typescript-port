/**
 * TigerBeetle Deno Port - Main Entry Point
 * 
 * A TypeScript/Deno implementation of TigerBeetle's core accounting functionality
 * using MySQL as the storage backend.
 */

// Re-export all types and enums
export * from './types.ts';

// Export client creation function and config types
export { createClient } from './client.ts';
export type { Client, LegacyMySQLConfig } from './client.ts';

// Export database configuration types
export type { MySQLConfig, TursoConfig, AnyDatabaseConfig } from './database/index.ts';

// Export ID utilities
export { id, parseId, createId, isValidId } from './id.ts';

// Export validation functions for advanced usage
export {
  validateAccount,
  validateTransfer,
  canDebitAccount,
  canCreditAccount,
} from './validation.ts';

// Export database class for direct usage
export { TigerBeetleDatabase } from './database.ts';

// Constants
export const VERSION = '0.1.0';