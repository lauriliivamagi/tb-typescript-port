/**
 * Integration tests for TigerBeetle Deno Port with MySQL database
 * These tests require a running MySQL database with the schema loaded
 * 
 * Run with: deno test --allow-net --allow-env src/integration_test.ts
 * 
 * Prerequisites:
 * 1. MySQL server running
 * 2. Test database created: CREATE DATABASE tigerbeetle_test;
 * 3. Schema loaded: mysql tigerbeetle_test < src/schema.sql
 * 4. Environment variables or config set for connection
 */

import { assertEquals, assertThrows, assert } from '@std/assert';
import {
  createClient,
  Account,
  Transfer,
  TransferFlags,
  AccountFlags,
  AccountFilterFlags,
  QueryFilterFlags,
  CreateAccountError,
  CreateTransferError,
  id,
  amount_max,
} from '../../src/index.ts';

// Integration test configuration
// These should be set via environment variables in real tests
const integrationConfig = {
  host: Deno.env.get('TB_TEST_HOST') || 'localhost',
  port: parseInt(Deno.env.get('TB_TEST_PORT') || '3306'),
  database: Deno.env.get('TB_TEST_DB') || 'tigerbeetle_test',
  user: Deno.env.get('TB_TEST_USER') || 'root',
  password: Deno.env.get('TB_TEST_PASSWORD') || '',
};

const BATCH_MAX = 8189;

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

// Skip integration tests if database is not available
function skipIfNoDatabase(): boolean {
  if (!Deno.env.get('TB_INTEGRATION_TESTS')) {
    console.log('⏭️  Skipping integration tests - set TB_INTEGRATION_TESTS=1 to run');
    return true;
  }
  return false;
}

// Helper function to clean up test data between tests
async function cleanupDatabase(client: ReturnType<typeof createClient>): Promise<void> {
  try {
    await client.clearDatabase();
  } catch (error) {
    // If clearDatabase fails, log but don't fail the test
    console.warn('Warning: Failed to clean database:', error);
  }
}

Deno.test({
  name: 'Integration - Can create and lookup accounts',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Clean up any previous test data
      await cleanupDatabase(client);
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
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Account creation errors',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      const testAccount = createTestAccount();

      // Create account successfully first time
      let errors = await client.createAccounts([testAccount]);
      assertEquals(errors, []);

      // Try to create same account again - should get exists error
      errors = await client.createAccounts([testAccount]);
      assertEquals(errors.length, 1);
      assertEquals(errors[0].index, 0);
      assertEquals(errors[0].result, CreateAccountError.exists);

      // Try to create account with different properties but same ID
      const conflictingAccount = { ...testAccount, code: 999 };
      errors = await client.createAccounts([conflictingAccount]);
      assertEquals(errors.length, 1);
      assertEquals(errors[0].result, CreateAccountError.exists_with_different_code);
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Can create transfers and update balances',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
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
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Two-phase transfer workflow',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Clean up any previous test data
      await cleanupDatabase(client);
      
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
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Void pending transfer',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Clean up any previous test data
      await cleanupDatabase(client);
      
      // Create test accounts
      const accountA = createTestAccount();
      const accountB = createTestAccount({ code: 719 });

      await client.createAccounts([accountA, accountB]);

      // Create a pending transfer
      const pendingTransfer = createTestTransfer(accountA.id, accountB.id, {
        amount: 300n,
        flags: TransferFlags.pending,
        timeout: 3600,
      });

      let errors = await client.createTransfers([pendingTransfer]);
      assertEquals(errors, []);

      // Verify pending balances
      let accounts = await client.lookupAccounts([accountA.id, accountB.id]);
      let accountAState = accounts.find(acc => acc.id === accountA.id)!;
      assertEquals(accountAState.debits_pending, 300n);

      // Void the pending transfer
      const voidTransfer = createTestTransfer(accountA.id, accountB.id, {
        amount: 300n,
        pending_id: pendingTransfer.id,
        flags: TransferFlags.void_pending_transfer,
        timeout: 0,
      });

      errors = await client.createTransfers([voidTransfer]);
      assertEquals(errors, []);

      // Check that pending amounts are cleared
      accounts = await client.lookupAccounts([accountA.id, accountB.id]);
      accountAState = accounts.find(acc => acc.id === accountA.id)!;
      const accountBState = accounts.find(acc => acc.id === accountB.id)!;

      assertEquals(accountAState.debits_pending, 0n);
      assertEquals(accountAState.debits_posted, 0n);
      assertEquals(accountBState.credits_pending, 0n);
      assertEquals(accountBState.credits_posted, 0n);
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Account balance constraints',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
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
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Get account transfers',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Create accounts with history flag
      const accountWithHistory = createTestAccount({
        flags: AccountFlags.history,
      });
      const counterAccount = createTestAccount({ code: 719 });

      await client.createAccounts([accountWithHistory, counterAccount]);

      // Create multiple transfers
      const transfers = [];
      for (let i = 0; i < 5; i++) {
        const transfer = createTestTransfer(
          i % 2 === 0 ? accountWithHistory.id : counterAccount.id,
          i % 2 === 0 ? counterAccount.id : accountWithHistory.id,
          { amount: BigInt((i + 1) * 100) }
        );
        transfers.push(transfer);
      }

      const errors = await client.createTransfers(transfers);
      assertEquals(errors, []);

      // Query all transfers for the account
      const filter = {
        account_id: accountWithHistory.id,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        code: 0,
        timestamp_min: 0n,
        timestamp_max: 0n,
        limit: BATCH_MAX,
        flags: AccountFilterFlags.credits | AccountFilterFlags.debits,
      };

      const accountTransfers = await client.getAccountTransfers(filter);
      assertEquals(accountTransfers.length, 5);

      // Verify transfers are in chronological order
      let lastTimestamp = 0n;
      for (const transfer of accountTransfers) {
        assert(transfer.timestamp > lastTimestamp);
        lastTimestamp = transfer.timestamp;
      }

      // Query only debit transfers
      const debitFilter = {
        ...filter,
        flags: AccountFilterFlags.debits,
      };

      const debitTransfers = await client.getAccountTransfers(debitFilter);
      for (const transfer of debitTransfers) {
        assertEquals(transfer.debit_account_id, accountWithHistory.id);
      }

      // Query only credit transfers
      const creditFilter = {
        ...filter,
        flags: AccountFilterFlags.credits,
      };

      const creditTransfers = await client.getAccountTransfers(creditFilter);
      for (const transfer of creditTransfers) {
        assertEquals(transfer.credit_account_id, accountWithHistory.id);
      }

      // Total debits + credits should equal all transfers
      assertEquals(debitTransfers.length + creditTransfers.length, accountTransfers.length);
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Query accounts and transfers',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Clean up any previous test data to ensure test isolation
      await cleanupDatabase(client);
      // Create accounts with specific user data for querying
      const accounts = [];
      for (let i = 0; i < 10; i++) {
        const account = createTestAccount({
          user_data_128: i % 2 === 0 ? 1000n : 2000n,
          user_data_64: i % 2 === 0 ? 100n : 200n,
          user_data_32: i % 2 === 0 ? 10 : 20,
          code: 999,
        });
        accounts.push(account);
      }

      await client.createAccounts(accounts);

      // Query accounts with specific user_data values
      const queryFilter = {
        user_data_128: 1000n,
        user_data_64: 100n,
        user_data_32: 10,
        ledger: 1,
        code: 999,
        timestamp_min: 0n,
        timestamp_max: 0n,
        limit: BATCH_MAX,
        flags: QueryFilterFlags.none,
      };

      const queryResults = await client.queryAccounts(queryFilter);
      assertEquals(queryResults.length, 5); // Half of the accounts

      // Verify all results match the filter
      for (const account of queryResults) {
        assertEquals(account.user_data_128, queryFilter.user_data_128);
        assertEquals(account.user_data_64, queryFilter.user_data_64);
        assertEquals(account.user_data_32, queryFilter.user_data_32);
        assertEquals(account.ledger, queryFilter.ledger);
        assertEquals(account.code, queryFilter.code);
      }

      // Test reverse order query
      const reverseFilter = {
        ...queryFilter,
        flags: QueryFilterFlags.reversed,
      };

      const reverseResults = await client.queryAccounts(reverseFilter);
      assertEquals(reverseResults.length, 5);

      // Verify reverse chronological order
      let lastTimestamp = (1n << 64n) - 1n; // Max u64
      for (const account of reverseResults) {
        assert(account.timestamp < lastTimestamp);
        lastTimestamp = account.timestamp;
      }
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Transfer errors and validation',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      const accountA = createTestAccount();
      const accountB = createTestAccount({ code: 719 });

      await client.createAccounts([accountA, accountB]);

      // Test various transfer errors
      const testCases = [
        {
          description: 'accounts must be different',
          transfer: createTestTransfer(accountA.id, accountA.id), // Same account
          expectedError: CreateTransferError.accounts_must_be_different,
        },
        {
          description: 'debit account not found',
          transfer: createTestTransfer(999999n, accountB.id), // Non-existent account
          expectedError: CreateTransferError.debit_account_not_found,
        },
        {
          description: 'credit account not found',
          transfer: createTestTransfer(accountA.id, 999999n), // Non-existent account
          expectedError: CreateTransferError.credit_account_not_found,
        },
      ];

      for (const testCase of testCases) {
        const errors = await client.createTransfers([testCase.transfer]);
        assertEquals(errors.length, 1, `Failed for: ${testCase.description}`);
        assertEquals(errors[0].result, testCase.expectedError, `Wrong error for: ${testCase.description}`);
      }

      // Test duplicate transfer
      const validTransfer = createTestTransfer(accountA.id, accountB.id);
      
      let errors = await client.createTransfers([validTransfer]);
      assertEquals(errors, []);

      // Try to create same transfer again
      errors = await client.createTransfers([validTransfer]);
      assertEquals(errors.length, 1);
      assertEquals(errors[0].result, CreateTransferError.exists);
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Batch operations',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Create multiple accounts in a batch
      const batchSize = 50;
      const accounts = [];
      for (let i = 0; i < batchSize; i++) {
        accounts.push(createTestAccount({ code: 100 + i }));
      }

      const accountErrors = await client.createAccounts(accounts);
      assertEquals(accountErrors, []);

      // Create multiple transfers in a batch
      const transfers = [];
      for (let i = 0; i < batchSize - 1; i++) {
        transfers.push(createTestTransfer(accounts[i].id, accounts[i + 1].id, {
          amount: BigInt((i + 1) * 10),
        }));
      }

      const transferErrors = await client.createTransfers(transfers);
      assertEquals(transferErrors, []);

      // Lookup all accounts and verify they exist
      const accountIds = accounts.map(acc => acc.id);
      const lookedUpAccounts = await client.lookupAccounts(accountIds);
      assertEquals(lookedUpAccounts.length, batchSize);

      // Lookup all transfers and verify they exist
      const transferIds = transfers.map(t => t.id);
      const lookedUpTransfers = await client.lookupTransfers(transferIds);
      assertEquals(lookedUpTransfers.length, transfers.length);
    } finally {
      await client.destroy();
    }
  }
});

Deno.test({
  name: 'Integration - Zero-length operations',
  ignore: skipIfNoDatabase(),
  async fn() {
    const client = createClient(); // Use environment variables for database selection
    
    try {
      // Test empty batch operations
      assertEquals(await client.createAccounts([]), []);
      assertEquals(await client.createTransfers([]), []);
      assertEquals(await client.lookupAccounts([]), []);
      assertEquals(await client.lookupTransfers([]), []);
    } finally {
      await client.destroy();
    }
  }
});

console.log('🔗 Integration tests ready - set TB_INTEGRATION_TESTS=1 to run with database');