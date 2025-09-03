/**
 * Turso Test Database Setup Utilities
 * Provides programmatic database creation and teardown for integration testing
 */

import { createClient, Client } from '@libsql/client';

export interface TursoTestConfig {
  /** Base URL for the Turso database (without random suffix) */
  baseUrl?: string | undefined;
  /** Authentication token for Turso */
  authToken?: string | undefined;
  /** Whether to use a random database name suffix for isolation */
  useRandomSuffix?: boolean | undefined;
  /** Custom database name (if not using random suffix) */
  databaseName?: string | undefined;
}

export interface TursoTestDatabase {
  /** Database URL for connecting to the test database */
  url: string;
  /** Database name */
  name: string;
  /** Client instance for database operations */
  client: Client;
  /** Function to destroy this test database */
  destroy: () => Promise<void>;
}

/**
 * Create a temporary Turso database for testing
 * Uses Turso CLI commands to create and manage databases
 */
export async function createTursoTestDatabase(config: TursoTestConfig = {}): Promise<TursoTestDatabase> {
  const {
    baseUrl,
    authToken,
    useRandomSuffix = true,
    databaseName,
  } = config;

  // Generate database name
  const suffix = useRandomSuffix ? `-${Date.now()}-${Math.random().toString(36).substring(2, 8)}` : '';
  const dbName = databaseName ? `${databaseName}${suffix}` : `tb-test${suffix}`;

  let dbUrl: string;
  let shouldDestroyDatabase = false;

  // Check if we should create a Turso cloud database or use local SQLite
  if (baseUrl || authToken) {
    // Use Turso cloud database
    try {
      // Create database using Turso CLI
      const createCommand = new Deno.Command('turso', {
        args: ['db', 'create', dbName, '--wait'],
        stderr: 'piped',
        stdout: 'piped',
      });
      
      const createResult = await createCommand.output();
      
      if (!createResult.success) {
        const errorText = new TextDecoder().decode(createResult.stderr);
        throw new Error(`Failed to create Turso database: ${errorText}`);
      }

      shouldDestroyDatabase = true;

      // Get database URL
      const showCommand = new Deno.Command('turso', {
        args: ['db', 'show', dbName, '--url'],
        stderr: 'piped',
        stdout: 'piped',
      });

      const showResult = await showCommand.output();
      
      if (!showResult.success) {
        const errorText = new TextDecoder().decode(showResult.stderr);
        throw new Error(`Failed to get database URL: ${errorText}`);
      }

      dbUrl = new TextDecoder().decode(showResult.stdout).trim();
    } catch (error) {
      throw new Error(`Failed to create Turso test database: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // For local testing without Turso cloud, skip database creation
    // and let the caller handle the database setup through existing mechanisms
    throw new Error('Local Turso testing requires either TURSO_DATABASE_URL to be set to a valid Turso cloud database, or you can use the existing MySQL-based tests instead.');
  }

  // Create client connection
  const clientConfig: { url: string; authToken?: string } = { url: dbUrl };
  if (authToken) {
    clientConfig.authToken = authToken;
  }

  const client = createClient(clientConfig);

  // Load schema
  await loadTursoSchema(client);

  // Create destroy function
  const destroy = async (): Promise<void> => {
    try {
      // Close client connection
      client.close();

      if (shouldDestroyDatabase) {
        // Destroy Turso cloud database
        const destroyCommand = new Deno.Command('turso', {
          args: ['db', 'destroy', dbName, '--yes'],
          stderr: 'piped',
          stdout: 'piped',
        });

        const destroyResult = await destroyCommand.output();
        
        if (!destroyResult.success) {
          const errorText = new TextDecoder().decode(destroyResult.stderr);
          console.warn(`Warning: Failed to destroy Turso database ${dbName}: ${errorText}`);
        }
      } else {
        // For in-memory SQLite, no cleanup needed (automatically destroyed when client closes)
        // Nothing to do here
      }
    } catch (error) {
      console.warn(`Warning: Error during test database cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    url: dbUrl,
    name: dbName,
    client,
    destroy,
  };
}

/**
 * Load the TigerBeetle schema into a Turso database
 */
async function loadTursoSchema(client: Client): Promise<void> {
  // Read the SQLite schema file - try multiple possible paths
  let schemaContent: string;
  const possiblePaths = [
    './schemas/sqlite/schema.sql',
    '../../schemas/sqlite/schema.sql',
    '../../../schemas/sqlite/schema.sql',
    // From test directory
    '../schemas/sqlite/schema.sql',
    // Relative to project root
    'schemas/sqlite/schema.sql',
  ];
  
  let lastError: Error | null = null;
  
  for (const path of possiblePaths) {
    try {
      schemaContent = await Deno.readTextFile(path);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
  }
  
  if (!schemaContent!) {
    throw new Error(`Could not load schema file from any of the attempted paths: ${possiblePaths.join(', ')}. Last error: ${lastError?.message}`);
  }

  // Split schema into individual statements
  const statements = schemaContent
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

  // Execute each statement
  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await client.execute(statement);
      } catch (error) {
        console.warn(`Warning: Schema statement failed: ${statement.substring(0, 50)}... Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

/**
 * Create multiple test databases for parallel testing
 */
export async function createTursoTestDatabases(count: number, config: TursoTestConfig = {}): Promise<TursoTestDatabase[]> {
  const databases: TursoTestDatabase[] = [];
  
  for (let i = 0; i < count; i++) {
    const dbConfig: TursoTestConfig = {
      ...config,
      databaseName: config.databaseName ? `${config.databaseName}-${i}` : undefined,
    };
    
    const db = await createTursoTestDatabase(dbConfig);
    databases.push(db);
  }

  return databases;
}

/**
 * Clean up multiple test databases
 */
export async function destroyTursoTestDatabases(databases: TursoTestDatabase[]): Promise<void> {
  await Promise.allSettled(databases.map(db => db.destroy()));
}

/**
 * Helper to get Turso test configuration from environment variables
 */
export function getTursoTestConfigFromEnv(): TursoTestConfig {
  return {
    baseUrl: Deno.env.get('TURSO_DATABASE_URL') || undefined,
    authToken: Deno.env.get('TURSO_AUTH_TOKEN') || undefined,
    useRandomSuffix: true,
    databaseName: undefined,
  };
}