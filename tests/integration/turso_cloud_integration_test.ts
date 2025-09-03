/**
 * Turso Cloud Integration Tests for TigerBeetle Deno Port
 * These tests demonstrate automated Turso cloud database creation and teardown
 * 
 * To run these tests, you need:
 * 1. Turso CLI installed and authenticated: `turso auth login`
 * 2. Environment variables:
 *    - TB_INTEGRATION_TESTS=1 (required to run)
 *    - TIGERBEETLE_DB_TYPE=turso (to use Turso backend)
 *    - TURSO_DATABASE_URL (your base Turso org URL, e.g., libsql://myorg.turso.io)
 *    - TURSO_AUTH_TOKEN (your Turso auth token)
 * 
 * Example usage:
 * ```bash
 * # Set up your Turso auth (one time)
 * turso auth login
 * 
 * # Get your auth token
 * export TURSO_AUTH_TOKEN=$(turso auth token)
 * 
 * # Set your database URL (replace with your org)
 * export TURSO_DATABASE_URL=libsql://myorg.turso.io
 * 
 * # Run the tests
 * TB_INTEGRATION_TESTS=1 TIGERBEETLE_DB_TYPE=turso deno task test:turso:cloud
 * ```
 */

import { assertEquals, assert } from '@std/assert';
import {
  Account,
  Transfer,
  TransferFlags,
  AccountFlags,
  CreateAccountError,
  CreateTransferError,
  id,
} from '../../src/index.ts';
import {
  withTestDatabase,
  shouldSkipIntegrationTests,
  type TestDatabaseSetup,
} from '../test-setup.ts';

// Helper to generate unique test accounts
function createTestAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: id(),
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: 1,
    code: 718,
    flags: 0,
    timestamp: 0n,
    ...overrides,
  };
}

// Helper to generate unique test transfers
function createTestTransfer(debitAccountId: bigint, creditAccountId: bigint, overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: id(),
    debit_account_id: debitAccountId,
    credit_account_id: creditAccountId,
    amount: 100n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    pending_id: 0n,
    timeout: 0,
    ledger: 1,
    code: 1,
    flags: 0,
    timestamp: 0n,
    ...overrides,
  };
}

// Skip if not configured for Turso cloud testing
function skipIfNoTursoCloud(): boolean {
  if (shouldSkipIntegrationTests()) {
    return true;
  }
  
  if (!Deno.env.get('TURSO_DATABASE_URL') || !Deno.env.get('TURSO_AUTH_TOKEN')) {
    console.log('⏭️  Skipping Turso cloud tests - set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
    return true;
  }
  
  return false;
}

// Test basic account creation and lookup with Turso cloud database auto-setup
Deno.test({
  name: 'Turso Cloud - Create and lookup accounts with auto database creation',
  ignore: skipIfNoTursoCloud(),
  async fn() {
    const testDb = await setupTestDatabase();
    
    try {
      console.log(`✅ Using ${testDb.type} database:`, testDb.config);
      
      const { client } = testDb;
      
      // Create test accounts
      const accountA = createTestAccount();
      const accountB = createTestAccount({ code: 719 });

      const errors = await client.createAccounts([accountA, accountB]);
      assertEquals(errors, []);

      // Lookup accounts
      const accounts = await client.lookupAccounts([accountA.id, accountB.id]);
      assertEquals(accounts.length, 2);

      const retrievedA = accounts.find(acc => acc.id === accountA.id)!;
      const retrievedB = accounts.find(acc => acc.id === accountB.id)!;

      // Verify account properties
      assertEquals(retrievedA.ledger, accountA.ledger);
      assertEquals(retrievedA.code, accountA.code);
      assertEquals(retrievedA.debits_posted, 0n);
      assertEquals(retrievedA.credits_posted, 0n);
      assert(retrievedA.timestamp > 0n);

      assertEquals(retrievedB.ledger, accountB.ledger);
      assertEquals(retrievedB.code, accountB.code);
      
      console.log('✅ Turso cloud integration test passed - database automatically created and destroyed');
    } finally {
      await testDb.cleanup();
    }
  }
});

// Import setup function (would normally use withTestDatabase helper, but demonstrating manual setup)
import { setupTestDatabase } from '../test-setup.ts';

console.log('🌩️ Turso cloud integration tests available - requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');

if (skipIfNoTursoCloud()) {
  console.log(`
🌩️ Turso Cloud Testing Setup Instructions:

1. Install Turso CLI:
   curl -sSfL https://get.tur.so/install.sh | bash

2. Authenticate:
   turso auth login

3. Set environment variables:
   export TURSO_AUTH_TOKEN=\$(turso auth token)
   export TURSO_DATABASE_URL=libsql://YOUR_ORG.turso.io

4. Run the tests:
   TB_INTEGRATION_TESTS=1 TIGERBEETLE_DB_TYPE=turso deno task test:turso:cloud

The test suite will automatically:
- Create temporary Turso databases with random names
- Load the TigerBeetle schema
- Run integration tests
- Clean up databases after completion
`);
}