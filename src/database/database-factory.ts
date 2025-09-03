/**
 * Database factory for creating appropriate database instances
 * Based on environment variables and configuration
 */

import { IDatabaseInterface, AnyDatabaseConfig, MySQLConfig, TursoConfig } from './database-interface.ts';
import { MySQLDatabase } from './mysql-database.ts';
import { TursoDatabase } from './turso-database.ts';

/**
 * Create a database instance based on configuration
 */
export function createDatabase(config: AnyDatabaseConfig): IDatabaseInterface {
  switch (config.type) {
    case 'mysql':
      return new MySQLDatabase(config);
    case 'turso':
      return new TursoDatabase(config);
    default:
      throw new Error(`Unknown database type: ${(config as any).type}`);
  }
}

/**
 * Create database configuration from environment variables
 * Supports both explicit configuration and environment-based detection
 */
export function createDatabaseConfigFromEnv(): AnyDatabaseConfig {
  const dbType = Deno.env.get('TIGERBEETLE_DB_TYPE') || 'mysql'; // Default to MySQL for backward compatibility
  
  switch (dbType) {
    case 'mysql':
      return createMySQLConfigFromEnv();
    case 'turso':
      return createTursoConfigFromEnv();
    default:
      throw new Error(`Unknown TIGERBEETLE_DB_TYPE: ${dbType}. Supported values: mysql, turso`);
  }
}

/**
 * Create MySQL configuration from environment variables
 * Uses existing TB_TEST_* variables for backward compatibility
 */
function createMySQLConfigFromEnv(): MySQLConfig {
  return {
    type: 'mysql',
    host: Deno.env.get('TB_TEST_HOST') || 'localhost',
    port: Deno.env.get('TB_TEST_PORT') ? parseInt(Deno.env.get('TB_TEST_PORT')!) : 3306,
    database: Deno.env.get('TB_TEST_DB') || 'tigerbeetle_test',
    user: Deno.env.get('TB_TEST_USER') || 'root',
    password: Deno.env.get('TB_TEST_PASSWORD') || '',
  };
}

/**
 * Create Turso configuration from environment variables
 */
function createTursoConfigFromEnv(): TursoConfig {
  const url = Deno.env.get('TURSO_DATABASE_URL');
  const authToken = Deno.env.get('TURSO_AUTH_TOKEN');
  
  if (!url) {
    throw new Error('TURSO_DATABASE_URL environment variable is required for Turso database');
  }
  
  // For local development (http://127.0.0.1), auth token is optional
  if (!authToken && !url?.startsWith('http://127.0.0.1') && !url?.startsWith('http://localhost')) {
    throw new Error('TURSO_AUTH_TOKEN environment variable is required for Turso database');
  }
  
  const config: TursoConfig = {
    type: 'turso',
    url,
  };
  
  if (authToken) {
    config.authToken = authToken;
  }
  
  return config;
}

/**
 * Create a database instance from environment variables
 * This is the main entry point for most applications
 */
export function createDatabaseFromEnv(): IDatabaseInterface {
  const config = createDatabaseConfigFromEnv();
  return createDatabase(config);
}