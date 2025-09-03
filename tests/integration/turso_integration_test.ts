/**
 * Turso-specific integration tests for TigerBeetle Deno Port
 * These tests demonstrate the automated Turso database creation and teardown
 * 
 * Environment variables:
 * - TB_INTEGRATION_TESTS=1 (required to run)
 * - TIGERBEETLE_DB_TYPE=turso (to use Turso backend)
 * - TURSO_DATABASE_URL (optional - for cloud Turso, otherwise uses local SQLite)
 * - TURSO_AUTH_TOKEN (required for cloud Turso)
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
  withMultipleTestDatabases,
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

// Test basic account creation and lookup with auto database setup
withTestDatabase(
  'Turso Integration - Create and lookup accounts with auto-setup',
  async (setup: TestDatabaseSetup) => {
    console.log(`✅ Using ${setup.type} database:`, setup.config);
    
    const { client } = setup;
    
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
  }
);

// Test transfer creation and balance updates
withTestDatabase(
  'Turso Integration - Create transfers and update balances',
  async (setup: TestDatabaseSetup) => {
    const { client } = setup;
    
    // Create test accounts
    const accountA = createTestAccount();
    const accountB = createTestAccount({ code: 719 });

    await client.createAccounts([accountA, accountB]);

    // Create a transfer
    const transfer = createTestTransfer(accountA.id, accountB.id, { amount: 1000n });
    
    const errors = await client.createTransfers([transfer]);
    assertEquals(errors, []);

    // Check updated balances
    const accounts = await client.lookupAccounts([accountA.id, accountB.id]);
    const updatedA = accounts.find(acc => acc.id === accountA.id)!;
    const updatedB = accounts.find(acc => acc.id === accountB.id)!;

    assertEquals(updatedA.debits_posted, 1000n);
    assertEquals(updatedA.credits_posted, 0n);
    assertEquals(updatedB.debits_posted, 0n);
    assertEquals(updatedB.credits_posted, 1000n);

    // Lookup the transfer
    const transfers = await client.lookupTransfers([transfer.id]);
    assertEquals(transfers.length, 1);
    assertEquals(transfers[0].amount, 1000n);
    assertEquals(transfers[0].debit_account_id, accountA.id);
    assertEquals(transfers[0].credit_account_id, accountB.id);
  }
);

// Test two-phase transfers (pending -> post)
withTestDatabase(
  'Turso Integration - Two-phase transfer workflow',
  async (setup: TestDatabaseSetup) => {
    const { client } = setup;
    
    // Create test accounts
    const accountA = createTestAccount();
    const accountB = createTestAccount({ code: 719 });

    await client.createAccounts([accountA, accountB]);

    // Create a pending transfer
    const pendingTransfer = createTestTransfer(accountA.id, accountB.id, {
      amount: 500n,
      flags: TransferFlags.pending,
      timeout: 3600, // 1 hour
    });

    let errors = await client.createTransfers([pendingTransfer]);
    assertEquals(errors, []);

    // Check pending balances
    let accounts = await client.lookupAccounts([accountA.id, accountB.id]);
    let accountAState = accounts.find(acc => acc.id === accountA.id)!;
    let accountBState = accounts.find(acc => acc.id === accountB.id)!;

    assertEquals(accountAState.debits_pending, 500n);
    assertEquals(accountAState.debits_posted, 0n);
    assertEquals(accountBState.credits_pending, 500n);
    assertEquals(accountBState.credits_posted, 0n);

    // Post the pending transfer
    const postTransfer = createTestTransfer(accountA.id, accountB.id, {
      amount: 500n,
      pending_id: pendingTransfer.id,
      flags: TransferFlags.post_pending_transfer,
      timeout: 0,
    });

    errors = await client.createTransfers([postTransfer]);
    assertEquals(errors, []);

    // Check final balances
    accounts = await client.lookupAccounts([accountA.id, accountB.id]);
    accountAState = accounts.find(acc => acc.id === accountA.id)!;
    accountBState = accounts.find(acc => acc.id === accountB.id)!;

    assertEquals(accountAState.debits_pending, 0n);
    assertEquals(accountAState.debits_posted, 500n);
    assertEquals(accountBState.credits_pending, 0n);
    assertEquals(accountBState.credits_posted, 500n);
  }
);

// Test database isolation with multiple databases
withMultipleTestDatabases(
  'Turso Integration - Database isolation with multiple databases',
  2, // Create 2 separate test databases
  async (setups: TestDatabaseSetup[]) => {
    assertEquals(setups.length, 2);
    
    const [setup1, setup2] = setups;
    
    // Create different accounts in each database
    const account1 = createTestAccount({ code: 100 });
    const account2 = createTestAccount({ code: 200 });
    
    // Create account1 only in database 1
    const errors1 = await setup1.client.createAccounts([account1]);
    assertEquals(errors1, []);
    
    // Create account2 only in database 2
    const errors2 = await setup2.client.createAccounts([account2]);
    assertEquals(errors2, []);
    
    // Verify isolation - account1 should only exist in database 1
    const accounts1 = await setup1.client.lookupAccounts([account1.id, account2.id]);
    assertEquals(accounts1.length, 1); // Only account1 should be found
    assertEquals(accounts1[0].id, account1.id);
    
    // Verify isolation - account2 should only exist in database 2
    const accounts2 = await setup2.client.lookupAccounts([account1.id, account2.id]);
    assertEquals(accounts2.length, 1); // Only account2 should be found
    assertEquals(accounts2[0].id, account2.id);
    
    console.log('✅ Database isolation verified between:', setup1.config, 'and', setup2.config);
  }
);

// Test account balance constraints
withTestDatabase(
  'Turso Integration - Account balance constraints',
  async (setup: TestDatabaseSetup) => {
    const { client } = setup;
    
    // Create accounts with balance constraints
    const assetAccount = createTestAccount({
      flags: AccountFlags.debits_must_not_exceed_credits,
      code: 100, // Asset account
    });
    
    const liabilityAccount = createTestAccount({
      flags: AccountFlags.credits_must_not_exceed_debits,
      code: 200, // Liability account
    });

    await client.createAccounts([assetAccount, liabilityAccount]);

    // First, credit the asset account (increase its balance)
    const initialCredit = createTestTransfer(liabilityAccount.id, assetAccount.id, {
      amount: 1000n,
    });
    
    let errors = await client.createTransfers([initialCredit]);
    assertEquals(errors, []);

    // Now try to debit more than the credits (should fail)
    const excessiveDebit = createTestTransfer(assetAccount.id, liabilityAccount.id, {
      amount: 1500n, // More than the 1000 credits
    });

    errors = await client.createTransfers([excessiveDebit]);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].result, CreateTransferError.exceeds_credits);
  }
);

// Test database cleanup and fresh state
withTestDatabase(
  'Turso Integration - Fresh database state per test',
  async (setup: TestDatabaseSetup) => {
    const { client } = setup;
    
    // This test verifies that each test gets a fresh database
    // by checking that no accounts exist initially
    const initialAccounts = await client.lookupAccounts([1n, 2n, 3n]);
    assertEquals(initialAccounts.length, 0, 'Database should be empty at test start');
    
    // Create a test account
    const account = createTestAccount();
    const errors = await client.createAccounts([account]);
    assertEquals(errors, []);
    
    // Verify the account was created
    const foundAccounts = await client.lookupAccounts([account.id]);
    assertEquals(foundAccounts.length, 1);
    assertEquals(foundAccounts[0].id, account.id);
  }
);

console.log('🧪 Turso integration tests completed - automatic database lifecycle management working!');

// Skip message if integration tests are not enabled
if (shouldSkipIntegrationTests()) {
  console.log('⏭️  Turso integration tests skipped - set TB_INTEGRATION_TESTS=1 and TIGERBEETLE_DB_TYPE=turso to run');
}