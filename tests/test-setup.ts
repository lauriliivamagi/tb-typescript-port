/**
 * Test setup utilities for TigerBeetle Deno Port
 * Provides database setup and teardown for both MySQL and Turso integration tests
 */

import {
  createTursoTestDatabase,
  destroyTursoTestDatabases,
  getTursoTestConfigFromEnv,
  type TursoTestDatabase,
} from '../src/test-utils/turso-test-setup.ts';
import { createClient as createTigerBeetleClient } from '../src/index.ts';

export interface TestDatabaseSetup {
  /** Database type */
  type: 'mysql' | 'turso';
  /** TigerBeetle client instance */
  client: ReturnType<typeof createTigerBeetleClient>;
  /** Clean up function to call after tests */
  cleanup: () => Promise<void>;
  /** Database configuration info */
  config: Record<string, unknown>;
}

/**
 * Set up a test database based on environment variables
 * Chooses between MySQL and Turso based on TIGERBEETLE_DB_TYPE
 */
export async function setupTestDatabase(): Promise<TestDatabaseSetup> {
  const dbType = Deno.env.get('TIGERBEETLE_DB_TYPE') || 'mysql';
  
  if (dbType === 'turso') {
    return setupTursoTestDatabase();
  } else {
    return setupMySQLTestDatabase();
  }
}

/**
 * Set up a Turso test database
 */
async function setupTursoTestDatabase(): Promise<TestDatabaseSetup> {
  const config = getTursoTestConfigFromEnv();
  const tursoDb = await createTursoTestDatabase(config);
  
  // Set environment variables for the TigerBeetle client
  Deno.env.set('TIGERBEETLE_DB_TYPE', 'turso');
  Deno.env.set('TURSO_DATABASE_URL', tursoDb.url);
  if (config.authToken) {
    Deno.env.set('TURSO_AUTH_TOKEN', config.authToken);
  }
  
  const client = createTigerBeetleClient();
  
  const cleanup = async () => {
    try {
      await client.destroy();
    } catch (error) {
      console.warn('Warning: Error closing TigerBeetle client:', error instanceof Error ? error.message : String(error));
    }
    
    await tursoDb.destroy();
  };
  
  return {
    type: 'turso',
    client,
    cleanup,
    config: {
      url: tursoDb.url,
      name: tursoDb.name,
    },
  };
}

/**
 * Set up a MySQL test database (existing behavior)
 */
function setupMySQLTestDatabase(): TestDatabaseSetup {
  const client = createTigerBeetleClient();
  
  const cleanup = async () => {
    try {
      await client.destroy();
    } catch (error) {
      console.warn('Warning: Error closing TigerBeetle client:', error instanceof Error ? error.message : String(error));
    }
  };
  
  return {
    type: 'mysql',
    client,
    cleanup,
    config: {
      host: Deno.env.get('TB_TEST_HOST') || 'localhost',
      port: parseInt(Deno.env.get('TB_TEST_PORT') || '3306'),
      database: Deno.env.get('TB_TEST_DB') || 'tigerbeetle_test',
      user: Deno.env.get('TB_TEST_USER') || 'root',
      password: Deno.env.get('TB_TEST_PASSWORD') || '',
    },
  };
}

/**
 * Set up multiple test databases for parallel testing
 */
export async function setupMultipleTestDatabases(count: number): Promise<TestDatabaseSetup[]> {
  const dbType = Deno.env.get('TIGERBEETLE_DB_TYPE') || 'mysql';
  
  if (dbType === 'turso') {
    return setupMultipleTursoTestDatabases(count);
  } else {
    // For MySQL, we typically use the same database but different prefixes or test isolation
    return Promise.all(Array.from({ length: count }, () => setupMySQLTestDatabase()));
  }
}

/**
 * Set up multiple Turso test databases
 */
async function setupMultipleTursoTestDatabases(count: number): Promise<TestDatabaseSetup[]> {
  const config = getTursoTestConfigFromEnv();
  const databases: TestDatabaseSetup[] = [];
  
  for (let i = 0; i < count; i++) {
    const dbConfig = {
      ...config,
      databaseName: `test-${i}`,
    };
    
    const tursoDb = await createTursoTestDatabase(dbConfig);
    
    // Create a separate environment for this database
    const originalDbType = Deno.env.get('TIGERBEETLE_DB_TYPE');
    const originalUrl = Deno.env.get('TURSO_DATABASE_URL');
    const originalToken = Deno.env.get('TURSO_AUTH_TOKEN');
    
    Deno.env.set('TIGERBEETLE_DB_TYPE', 'turso');
    Deno.env.set('TURSO_DATABASE_URL', tursoDb.url);
    if (config.authToken) {
      Deno.env.set('TURSO_AUTH_TOKEN', config.authToken);
    }
    
    const client = createTigerBeetleClient();
    
    const cleanup = async () => {
      try {
        await client.destroy();
      } catch (error) {
        console.warn(`Warning: Error closing TigerBeetle client ${i}:`, error instanceof Error ? error.message : String(error));
      }
      
      await tursoDb.destroy();
      
      // Restore original environment variables
      if (originalDbType !== undefined) {
        Deno.env.set('TIGERBEETLE_DB_TYPE', originalDbType);
      } else {
        Deno.env.delete('TIGERBEETLE_DB_TYPE');
      }
      
      if (originalUrl !== undefined) {
        Deno.env.set('TURSO_DATABASE_URL', originalUrl);
      } else {
        Deno.env.delete('TURSO_DATABASE_URL');
      }
      
      if (originalToken !== undefined) {
        Deno.env.set('TURSO_AUTH_TOKEN', originalToken);
      } else {
        Deno.env.delete('TURSO_AUTH_TOKEN');
      }
    };
    
    databases.push({
      type: 'turso',
      client,
      cleanup,
      config: {
        url: tursoDb.url,
        name: tursoDb.name,
      },
    });
  }
  
  return databases;
}

/**
 * Clean up multiple test databases
 */
export async function cleanupTestDatabases(databases: TestDatabaseSetup[]): Promise<void> {
  await Promise.allSettled(databases.map(db => db.cleanup()));
}

/**
 * Check if integration tests should be skipped
 */
export function shouldSkipIntegrationTests(): boolean {
  return !Deno.env.get('TB_INTEGRATION_TESTS');
}

/**
 * Deno test utility that creates and cleans up a test database
 */
export function withTestDatabase(
  name: string,
  testFn: (setup: TestDatabaseSetup) => Promise<void> | void
): void {
  Deno.test({
    name,
    ignore: shouldSkipIntegrationTests(),
    async fn() {
      const setup = await setupTestDatabase();
      
      try {
        await testFn(setup);
      } finally {
        await setup.cleanup();
      }
    },
  });
}

/**
 * Deno test utility for tests that need multiple databases
 */
export function withMultipleTestDatabases(
  name: string,
  count: number,
  testFn: (setups: TestDatabaseSetup[]) => Promise<void> | void
): void {
  Deno.test({
    name,
    ignore: shouldSkipIntegrationTests(),
    async fn() {
      const setups = await setupMultipleTestDatabases(count);
      
      try {
        await testFn(setups);
      } finally {
        await cleanupTestDatabases(setups);
      }
    },
  });
}