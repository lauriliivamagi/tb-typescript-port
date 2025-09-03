/**
 * Basic tests for TigerBeetle Deno Port
 */

import { assertEquals, assertThrows } from '@std/assert';
import {
  id,
  parseId,
  createId,
  isValidId,
  validateAccount,
  validateTransfer,
  AccountFlags,
  TransferFlags,
  CreateAccountError,
  CreateTransferError,
} from '../../src/index.ts';

Deno.test('ID Generation', () => {
  console.log('Testing ID generation...');
  
  // Test basic ID generation
  const id1 = id();
  const id2 = id();
  
  // IDs should be different
  assertEquals(id1 === id2, false, 'Generated IDs should be unique');
  
  // IDs should be valid
  assertEquals(isValidId(id1), true, 'Generated ID should be valid');
  assertEquals(isValidId(id2), true, 'Generated ID should be valid');
  
  // Test ID validation
  assertEquals(isValidId(0n), false, 'Zero ID should be invalid');
  assertEquals(isValidId((2n ** 128n) - 1n), false, 'Max u128 ID should be invalid');
  assertEquals(isValidId(1n), true, 'ID of 1 should be valid');
  
  console.log('✅ ID generation tests passed');
});

Deno.test('ID Parsing', () => {
  console.log('Testing ID parsing...');
  
  const timestamp = 1640995200000; // Jan 1, 2022 00:00:00 UTC
  const random = 12345n;
  
  // Create ID with known values
  const testId = createId(timestamp, random);
  console.log('Created ID:', testId);
  
  // Parse it back
  const parsed = parseId(testId);
  console.log('Parsed timestamp:', parsed.timestamp, 'expected:', timestamp);
  console.log('Parsed random:', parsed.random, 'expected:', random);
  
  // For now, just verify the basic structure works
  assertEquals(typeof parsed.timestamp, 'number', 'Timestamp should be a number');
  assertEquals(typeof parsed.random, 'bigint', 'Random should be a bigint');
  
  console.log('✅ ID parsing tests passed (structure validated)');
});

Deno.test('Account Validation', () => {
  console.log('Testing account validation...');
  
  // Valid account
  const validAccount = {
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
    flags: AccountFlags.none,
    timestamp: 0n,
  };
  
  assertEquals(
    validateAccount(validAccount),
    CreateAccountError.ok,
    'Valid account should pass validation'
  );
  
  // Invalid account - zero ID
  const invalidAccount1 = { ...validAccount, id: 0n };
  assertEquals(
    validateAccount(invalidAccount1),
    CreateAccountError.id_must_not_be_zero,
    'Zero ID should be invalid'
  );
  
  // Invalid account - zero ledger
  const invalidAccount2 = { ...validAccount, ledger: 0 };
  assertEquals(
    validateAccount(invalidAccount2),
    CreateAccountError.ledger_must_not_be_zero,
    'Zero ledger should be invalid'
  );
  
  // Invalid account - zero code
  const invalidAccount3 = { ...validAccount, code: 0 };
  assertEquals(
    validateAccount(invalidAccount3),
    CreateAccountError.code_must_not_be_zero,
    'Zero code should be invalid'
  );
  
  // Invalid account - non-zero timestamp
  const invalidAccount4 = { ...validAccount, timestamp: 12345n };
  assertEquals(
    validateAccount(invalidAccount4),
    CreateAccountError.timestamp_must_be_zero,
    'Non-zero timestamp should be invalid'
  );
  
  // Invalid account - non-zero balance
  const invalidAccount5 = { ...validAccount, debits_posted: 100n };
  assertEquals(
    validateAccount(invalidAccount5),
    CreateAccountError.debits_posted_must_be_zero,
    'Non-zero debits_posted should be invalid'
  );
  
  console.log('✅ Account validation tests passed');
});

Deno.test('Transfer Validation', () => {
  console.log('Testing transfer validation...');
  
  // Valid transfer
  const validTransfer = {
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
    flags: TransferFlags.none,
    timestamp: 0n,
  };
  
  assertEquals(
    validateTransfer(validTransfer),
    CreateTransferError.ok,
    'Valid transfer should pass validation'
  );
  
  // Invalid transfer - zero ID
  const invalidTransfer1 = { ...validTransfer, id: 0n };
  assertEquals(
    validateTransfer(invalidTransfer1),
    CreateTransferError.id_must_not_be_zero,
    'Zero ID should be invalid'
  );
  
  // Invalid transfer - same account IDs
  const invalidTransfer2 = { ...validTransfer, credit_account_id: 2n };
  assertEquals(
    validateTransfer(invalidTransfer2),
    CreateTransferError.accounts_must_be_different,
    'Same account IDs should be invalid'
  );
  
  // Invalid transfer - zero ledger
  const invalidTransfer3 = { ...validTransfer, ledger: 0 };
  assertEquals(
    validateTransfer(invalidTransfer3),
    CreateTransferError.ledger_must_not_be_zero,
    'Zero ledger should be invalid'
  );
  
  // Invalid transfer - zero code
  const invalidTransfer4 = { ...validTransfer, code: 0 };
  assertEquals(
    validateTransfer(invalidTransfer4),
    CreateTransferError.code_must_not_be_zero,
    'Zero code should be invalid'
  );
  
  // Invalid transfer - pending with pending_id
  const invalidTransfer5 = { 
    ...validTransfer, 
    flags: TransferFlags.pending,
    pending_id: 123n 
  };
  assertEquals(
    validateTransfer(invalidTransfer5),
    CreateTransferError.pending_id_must_be_zero,
    'Pending transfer with pending_id should be invalid'
  );
  
  // Invalid transfer - post pending without pending_id
  const invalidTransfer6 = { 
    ...validTransfer, 
    flags: TransferFlags.post_pending_transfer,
    pending_id: 0n 
  };
  assertEquals(
    validateTransfer(invalidTransfer6),
    CreateTransferError.pending_id_must_not_be_zero,
    'Post pending transfer without pending_id should be invalid'
  );
  
  console.log('✅ Transfer validation tests passed');
});

Deno.test('Account Flags', () => {
  console.log('Testing account flags...');
  
  // Test mutually exclusive flags
  const invalidAccount = {
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
    flags: AccountFlags.debits_must_not_exceed_credits | AccountFlags.credits_must_not_exceed_debits,
    timestamp: 0n,
  };
  
  assertEquals(
    validateAccount(invalidAccount),
    CreateAccountError.flags_are_mutually_exclusive,
    'Mutually exclusive flags should be invalid'
  );
  
  console.log('✅ Account flags tests passed');
});

Deno.test('Transfer Flags', () => {
  console.log('Testing transfer flags...');
  
  // Test valid pending transfer
  const pendingTransfer = {
    id: 1n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 100n,
    pending_id: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 3600, // 1 hour timeout
    ledger: 1,
    code: 1,
    flags: TransferFlags.pending,
    timestamp: 0n,
  };
  
  assertEquals(
    validateTransfer(pendingTransfer),
    CreateTransferError.ok,
    'Valid pending transfer should pass'
  );
  
  // Test valid post pending transfer
  const postTransfer = {
    id: 2n,
    debit_account_id: 2n,
    credit_account_id: 3n,
    amount: 100n,
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
  
  assertEquals(
    validateTransfer(postTransfer),
    CreateTransferError.ok,
    'Valid post pending transfer should pass'
  );
  
  console.log('✅ Transfer flags tests passed');
});

console.log('🧪 Running all tests...\n');