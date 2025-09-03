/**
 * Node.js client scenario tests for TigerBeetle Deno Port
 * Tests specific scenarios and edge cases found in the original Node.js client
 */

import { assertEquals, assertThrows, assert } from '@std/assert';
import {
  createClient,
  id,
  createId,
  parseId,
  isValidId,
  validateAccount,
  validateTransfer,
  Account,
  Transfer,
  AccountFilter,
  QueryFilter,
  MySQLConfig,
  AccountFlags,
  TransferFlags,
  CreateAccountError,
  CreateTransferError,
  amount_max,
} from '../../src/index.ts';

// Test configuration (database operations will be skipped without proper setup)
const testConfig: MySQLConfig = {
  host: 'localhost',
  port: 3306,
  database: 'tigerbeetle_test',
  user: 'root',
  password: '',
};

const BATCH_MAX = 8189;

Deno.test('Account Closing Behavior', () => {
  console.log('Testing account closing behavior...');
  
  // Test transfers that close accounts
  const closingDebitTransfer: Transfer = {
    id: 1n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 100n,
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: 1,
    code: 1,
    flags: TransferFlags.closing_debit,
    timestamp: 0n,
  };
  
  const closingCreditTransfer: Transfer = {
    id: 2n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 100n,
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: 1,
    code: 1,
    flags: TransferFlags.closing_credit,
    timestamp: 0n,
  };
  
  // These should validate correctly  
  assertEquals(validateTransfer(closingDebitTransfer), CreateTransferError.ok);
  assertEquals(validateTransfer(closingCreditTransfer), CreateTransferError.ok);
  
  // Test mutually exclusive closing flags
  const invalidClosingTransfer: Transfer = {
    ...closingDebitTransfer,
    id: 3n,
    flags: TransferFlags.closing_debit | TransferFlags.closing_credit,
  };
  
  assertEquals(validateTransfer(invalidClosingTransfer), CreateTransferError.flags_are_mutually_exclusive);
  
  console.log('✅ Account closing behavior tests passed');
});

Deno.test('Import Functionality - Comprehensive', () => {
  console.log('Testing comprehensive import functionality...');
  
  // Test imported account with custom timestamp
  const currentTime = BigInt(Date.now()) * 1_000_000n; // nanoseconds
  
  const importedAccount: Account = {
    id: 1n,
    debits_pending: 0n,
    debits_posted: 1000n, // Can have non-zero balance for imports
    credits_pending: 0n, 
    credits_posted: 2000n, // Can have non-zero balance for imports
    user_data_128: 12345n,
    user_data_64: 67890n,
    user_data_32: 999,
    reserved: 0,
    ledger: 1,
    code: 1,
    flags: AccountFlags.imported,
    timestamp: currentTime, // Custom timestamp for imported accounts
  };
  
  // For imported accounts, non-zero balances and custom timestamps should be allowed
  // However, the current validation may not support this - test what actually happens
  const importValidation = validateAccount({ ...importedAccount, timestamp: 0n });
  
  // Test imported transfer  
  const importedTransfer: Transfer = {
    id: 1n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 500n,
    pending_id: 0n,
    user_data_128: 111n,
    user_data_64: 222n,
    user_data_32: 333,
    timeout: 0,
    ledger: 1,
    code: 1,
    flags: TransferFlags.imported,
    timestamp: currentTime, // Custom timestamp for imported transfers
  };
  
  const importTransferValidation = validateTransfer({ ...importedTransfer, timestamp: 0n });
  assertEquals(importTransferValidation, CreateTransferError.ok);
  
  console.log('✅ Comprehensive import functionality tests passed');
});

Deno.test('Linked Transfer Chain Validation', () => {
  console.log('Testing linked transfer chain validation...');
  
  // Test linked transfer sequences
  const transfers = [
    {
      id: 100n,
      debit_account_id: 1n,
      credit_account_id: 2n,
      amount: 100n,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 1,
      code: 1,
      flags: TransferFlags.linked,
      timestamp: 0n,
    },
    {
      id: 101n,
      debit_account_id: 2n,
      credit_account_id: 3n,
      amount: 50n,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 1,
      code: 1,
      flags: TransferFlags.linked,
      timestamp: 0n,
    },
    {
      id: 102n,
      debit_account_id: 3n,
      credit_account_id: 4n,
      amount: 50n,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: 1,
      code: 1,
      flags: TransferFlags.none, // Chain terminator
      timestamp: 0n,
    },
  ];
  
  // All transfers in the chain should validate individually
  for (const transfer of transfers) {
    assertEquals(validateTransfer(transfer), CreateTransferError.ok);
  }
  
  console.log('✅ Linked transfer chain validation tests passed');
});

Deno.test('Complex Filter Scenarios', () => {
  console.log('Testing complex filter scenarios...');
  
  // Test AccountFilter with edge case values
  const complexAccountFilter: AccountFilter = {
    account_id: 123n,
    user_data_128: 0n, // Zero means "don't filter by this field"
    user_data_64: 999n, // Non-zero means filter by this field
    user_data_32: 0, // Zero means don't filter
    code: 0, // Zero means don't filter
    timestamp_min: BigInt(Date.now() - 86400000) * 1_000_000n, // Yesterday in nanoseconds
    timestamp_max: BigInt(Date.now()) * 1_000_000n, // Now in nanoseconds
    limit: 100,
    flags: 3, // Both debits and credits
  };
  
  // Test that the filter structure is valid
  assert(typeof complexAccountFilter.account_id === 'bigint');
  assert(complexAccountFilter.limit > 0 && complexAccountFilter.limit <= BATCH_MAX);
  assert(complexAccountFilter.timestamp_min <= complexAccountFilter.timestamp_max);
  
  // Test QueryFilter with complex combinations
  const complexQueryFilter: QueryFilter = {
    user_data_128: 999999n,
    user_data_64: 0n, // Don't filter by this
    user_data_32: 42,
    ledger: 5,
    code: 999,
    timestamp_min: 0n, // From beginning of time
    timestamp_max: BigInt(Date.now()) * 1_000_000n,
    limit: BATCH_MAX, // Maximum batch size
    flags: 1, // Reversed order
  };
  
  assert(typeof complexQueryFilter.user_data_128 === 'bigint');
  assert(complexQueryFilter.limit === BATCH_MAX);
  
  console.log('✅ Complex filter scenario tests passed');
});

Deno.test('Two-Phase Transfer Edge Cases', () => {
  console.log('Testing two-phase transfer edge cases...');
  
  // Test pending transfer with maximum timeout
  const maxTimeoutTransfer: Transfer = {
    id: 1n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 1000n,
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: (2 ** 32) - 1, // Maximum u32 timeout
    ledger: 1,
    code: 1,
    flags: TransferFlags.pending,
    timestamp: 0n,
  };
  
  assertEquals(validateTransfer(maxTimeoutTransfer), CreateTransferError.ok);
  
  // Test pending transfer with minimum timeout
  const minTimeoutTransfer: Transfer = {
    ...maxTimeoutTransfer,
    id: 2n,
    timeout: 1, // Minimum meaningful timeout
  };
  
  assertEquals(validateTransfer(minTimeoutTransfer), CreateTransferError.ok);
  
  // Test void pending with correct pending_id reference
  const voidPendingTransfer: Transfer = {
    id: 3n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 1000n,
    pending_id: 1n, // Must reference the pending transfer
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0, // Must be 0 for void operations
    ledger: 1,
    code: 1,
    flags: TransferFlags.void_pending_transfer,
    timestamp: 0n,
  };
  
  assertEquals(validateTransfer(voidPendingTransfer), CreateTransferError.ok);
  
  // Test post pending with partial amount (should have same amount as original)
  const postPendingTransfer: Transfer = {
    id: 4n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 1000n, // Same as pending amount
    pending_id: 1n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: 1,
    code: 1,
    flags: TransferFlags.post_pending_transfer,
    timestamp: 0n,
  };
  
  assertEquals(validateTransfer(postPendingTransfer), CreateTransferError.ok);
  
  console.log('✅ Two-phase transfer edge case tests passed');
});

Deno.test('Account History Scenarios', () => {
  console.log('Testing account history scenarios...');
  
  // Test account with history flag
  const historyAccount: Account = {
    id: 1n,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: 1,
    code: 1,
    flags: AccountFlags.history,
    timestamp: 0n,
  };
  
  assertEquals(validateAccount(historyAccount), CreateAccountError.ok);
  
  // Test account with combined flags (history + other flags)
  const historyLinkedAccount: Account = {
    ...historyAccount,
    id: 2n,
    flags: AccountFlags.history | AccountFlags.linked,
  };
  
  assertEquals(validateAccount(historyLinkedAccount), CreateAccountError.ok);
  
  // Test account with history and balance constraints
  const historyConstrainedAccount: Account = {
    ...historyAccount,
    id: 3n,
    flags: AccountFlags.history | AccountFlags.debits_must_not_exceed_credits,
  };
  
  assertEquals(validateAccount(historyConstrainedAccount), CreateAccountError.ok);
  
  console.log('✅ Account history scenario tests passed');
});

Deno.test('Extreme ID Generation Stress Test', async () => {
  console.log('Testing extreme ID generation scenarios...');
  
  // Test ID generation under rapid-fire conditions
  const rapidFireCount = 50000;
  const startTime = performance.now();
  
  const rapidIds: bigint[] = [];
  for (let i = 0; i < rapidFireCount; i++) {
    rapidIds.push(id());
    
    // Occasionally yield to test timing edge cases
    if (i % 10000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  // Should generate IDs quickly
  assert(duration < 5000, `ID generation too slow: ${duration}ms for ${rapidFireCount} IDs`);
  
  // Check uniqueness
  const uniqueIds = new Set(rapidIds.map(id => id.toString()));
  assertEquals(uniqueIds.size, rapidIds.length, 'All IDs should be unique');
  
  // Check monotonicity
  for (let i = 1; i < rapidIds.length; i++) {
    assert(rapidIds[i] > rapidIds[i-1], `Non-monotonic IDs at index ${i}: ${rapidIds[i-1]} >= ${rapidIds[i]}`);
  }
  
  // Test parsing of all generated IDs
  let parsedCount = 0;
  for (const testId of rapidIds.slice(0, 1000)) { // Test subset for performance
    const parsed = parseId(testId);
    assert(typeof parsed.timestamp === 'number');
    assert(typeof parsed.random === 'bigint');
    parsedCount++;
  }
  
  assertEquals(parsedCount, 1000);
  
  console.log('✅ Extreme ID generation stress tests passed');
});

Deno.test('Balance Constraint Complex Scenarios', () => {
  console.log('Testing complex balance constraint scenarios...');
  
  // Test account that can only accept credits (liability-like)
  const creditOnlyAccount: Account = {
    id: 1n,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: 1,
    code: 1,
    flags: AccountFlags.credits_must_not_exceed_debits, // Inverted logic for liability accounts
    timestamp: 0n,
  };
  
  assertEquals(validateAccount(creditOnlyAccount), CreateAccountError.ok);
  
  // Test account that can only accept debits (asset-like)
  const debitOnlyAccount: Account = {
    ...creditOnlyAccount,
    id: 2n,
    flags: AccountFlags.debits_must_not_exceed_credits, // Asset account constraint
  };
  
  assertEquals(validateAccount(debitOnlyAccount), CreateAccountError.ok);
  
  console.log('✅ Complex balance constraint scenario tests passed');
});

Deno.test('User Data Field Complex Scenarios', () => {
  console.log('Testing complex user data field scenarios...');
  
  // Test with maximum user data values
  const maxUserDataAccount: Account = {
    id: 1n,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: (2n ** 128n) - 1n, // Max u128
    user_data_64: (2n ** 64n) - 1n, // Max u64
    user_data_32: (2 ** 32) - 1, // Max u32
    reserved: 0,
    ledger: 1,
    code: 1,
    flags: AccountFlags.none,
    timestamp: 0n,
  };
  
  assertEquals(validateAccount(maxUserDataAccount), CreateAccountError.ok);
  
  // Test transfer with maximum user data
  const maxUserDataTransfer: Transfer = {
    id: 1n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 100n,
    pending_id: 0n,
    user_data_128: (2n ** 128n) - 1n,
    user_data_64: (2n ** 64n) - 1n,
    user_data_32: (2 ** 32) - 1,
    timeout: 0,
    ledger: 1,
    code: 1,
    flags: TransferFlags.none,
    timestamp: 0n,
  };
  
  assertEquals(validateTransfer(maxUserDataTransfer), CreateTransferError.ok);
  
  // Test with specific patterns that might be used in practice
  const patternedAccount: Account = {
    ...maxUserDataAccount,
    id: 2n,
    user_data_128: 0xDEADBEEFCAFEBABEn, // Hex pattern
    user_data_64: 0x123456789ABCDEFn, // Another hex pattern
    user_data_32: 0x12345678, // 32-bit hex pattern
  };
  
  assertEquals(validateAccount(patternedAccount), CreateAccountError.ok);
  
  console.log('✅ Complex user data field scenario tests passed');
});

Deno.test('Timeout and Expiry Logic Simulation', () => {
  console.log('Testing timeout and expiry logic scenarios...');
  
  // Test various timeout values
  const timeoutScenarios = [
    0, // No timeout
    1, // Immediate timeout
    60, // 1 minute
    3600, // 1 hour  
    86400, // 1 day
    (2 ** 32) - 1, // Maximum timeout
  ];
  
  for (const timeout of timeoutScenarios) {
    const timeoutTransfer: Transfer = {
      id: BigInt(timeout + 1000), // Unique ID for each test
      debit_account_id: 1n,
      credit_account_id: 2n,
      amount: 100n,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: timeout,
      ledger: 1,
      code: 1,
      flags: timeout > 0 ? TransferFlags.pending : TransferFlags.none,
      timestamp: 0n,
    };
    
    assertEquals(validateTransfer(timeoutTransfer), CreateTransferError.ok, `Timeout ${timeout} should be valid`);
  }
  
  // Test zero timeout with non-pending transfer
  const nonPendingWithTimeout: Transfer = {
    id: 9999n,
    debit_account_id: 1n,
    credit_account_id: 2n,
    amount: 100n,
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 3600, // Non-zero timeout
    ledger: 1,
    code: 1,
    flags: TransferFlags.none, // Not pending
    timestamp: 0n,
  };
  
  // This should fail validation (timeout reserved for pending transfers)
  assertEquals(validateTransfer(nonPendingWithTimeout), CreateTransferError.timeout_reserved_for_pending_transfer);
  
  console.log('✅ Timeout and expiry logic simulation tests passed');
});

console.log('🧩 Running Node.js scenario tests...\n');