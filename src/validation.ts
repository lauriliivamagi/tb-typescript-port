/**
 * Core accounting validation logic
 * Based on TigerBeetle's state machine validation rules
 */

import {
  Account,
  Transfer,
  AccountFlags,
  TransferFlags,
  CreateAccountError,
  CreateTransferError,
  TransferPendingStatus,
  amount_max
} from './types.ts';
import { isValidId } from './id.ts';

/**
 * Validate an account for creation
 * Based on TigerBeetle's account validation rules
 */
export function validateAccount(account: Account): CreateAccountError {
  // ID validation
  if (account.id === 0n) {
    return CreateAccountError.id_must_not_be_zero;
  }
  if (account.id >= (2n ** 128n) - 1n) {
    return CreateAccountError.id_must_not_be_int_max;
  }

  // Timestamp must be zero (TigerBeetle sets this)
  if (account.timestamp !== 0n) {
    return CreateAccountError.timestamp_must_be_zero;
  }

  // Reserved field must be zero
  if (account.reserved !== 0) {
    return CreateAccountError.reserved_field;
  }

  // Ledger validation
  if (account.ledger === 0) {
    return CreateAccountError.ledger_must_not_be_zero;
  }

  // Code validation
  if (account.code === 0) {
    return CreateAccountError.code_must_not_be_zero;
  }

  // Balance fields must be zero for new accounts
  if (account.debits_pending !== 0n) {
    return CreateAccountError.debits_pending_must_be_zero;
  }
  if (account.debits_posted !== 0n) {
    return CreateAccountError.debits_posted_must_be_zero;
  }
  if (account.credits_pending !== 0n) {
    return CreateAccountError.credits_pending_must_be_zero;
  }
  if (account.credits_posted !== 0n) {
    return CreateAccountError.credits_posted_must_be_zero;
  }

  // Flag validation
  const flags = account.flags;
  
  // Check for reserved flags (bits not defined in AccountFlags)
  const validFlagsMask = 
    AccountFlags.linked |
    AccountFlags.debits_must_not_exceed_credits |
    AccountFlags.credits_must_not_exceed_debits |
    AccountFlags.history |
    AccountFlags.imported |
    AccountFlags.closed;
  
  if ((flags & ~validFlagsMask) !== 0) {
    return CreateAccountError.reserved_flag;
  }

  // Check mutually exclusive flags
  if ((flags & AccountFlags.debits_must_not_exceed_credits) && 
      (flags & AccountFlags.credits_must_not_exceed_debits)) {
    return CreateAccountError.flags_are_mutually_exclusive;
  }

  return CreateAccountError.ok;
}

/**
 * Validate account exists with same properties
 * Returns error if account exists but with different properties
 */
export function validateAccountExists(existing: Account, new_account: Account): CreateAccountError {
  if (existing.flags !== new_account.flags) {
    return CreateAccountError.exists_with_different_flags;
  }
  if (existing.user_data_128 !== new_account.user_data_128) {
    return CreateAccountError.exists_with_different_user_data_128;
  }
  if (existing.user_data_64 !== new_account.user_data_64) {
    return CreateAccountError.exists_with_different_user_data_64;
  }
  if (existing.user_data_32 !== new_account.user_data_32) {
    return CreateAccountError.exists_with_different_user_data_32;
  }
  if (existing.ledger !== new_account.ledger) {
    return CreateAccountError.exists_with_different_ledger;
  }
  if (existing.code !== new_account.code) {
    return CreateAccountError.exists_with_different_code;
  }
  
  return CreateAccountError.exists; // Same account, no error beyond existence
}

/**
 * Validate a transfer for creation
 */
export function validateTransfer(transfer: Transfer): CreateTransferError {
  // ID validation
  if (transfer.id === 0n) {
    return CreateTransferError.id_must_not_be_zero;
  }
  if (transfer.id >= (2n ** 128n) - 1n) {
    return CreateTransferError.id_must_not_be_int_max;
  }

  // Timestamp must be zero (TigerBeetle sets this)
  if (transfer.timestamp !== 0n) {
    return CreateTransferError.timestamp_must_be_zero;
  }

  // Account ID validation
  if (transfer.debit_account_id === 0n) {
    return CreateTransferError.debit_account_id_must_not_be_zero;
  }
  if (transfer.debit_account_id >= (2n ** 128n) - 1n) {
    return CreateTransferError.debit_account_id_must_not_be_int_max;
  }
  if (transfer.credit_account_id === 0n) {
    return CreateTransferError.credit_account_id_must_not_be_zero;
  }
  if (transfer.credit_account_id >= (2n ** 128n) - 1n) {
    return CreateTransferError.credit_account_id_must_not_be_int_max;
  }

  // Accounts must be different
  if (transfer.debit_account_id === transfer.credit_account_id) {
    return CreateTransferError.accounts_must_be_different;
  }

  // Amount must be positive (TigerBeetle allows 0 amounts in some cases, but we'll be strict)
  if (transfer.amount === 0n) {
    // Note: TigerBeetle deprecated the amount_must_not_be_zero error but we'll enforce it
    return CreateTransferError.exists; // Using exists as a catch-all for now
  }
  if (transfer.amount > amount_max) {
    return CreateTransferError.overflows_debits; // Amount too large
  }

  // Ledger validation
  if (transfer.ledger === 0) {
    return CreateTransferError.ledger_must_not_be_zero;
  }

  // Code validation
  if (transfer.code === 0) {
    return CreateTransferError.code_must_not_be_zero;
  }

  // Flag validation
  const flags = transfer.flags;
  
  // Check for reserved flags
  const validFlagsMask = 
    TransferFlags.linked |
    TransferFlags.pending |
    TransferFlags.post_pending_transfer |
    TransferFlags.void_pending_transfer |
    TransferFlags.balancing_debit |
    TransferFlags.balancing_credit |
    TransferFlags.closing_debit |
    TransferFlags.closing_credit |
    TransferFlags.imported;
  
  if ((flags & ~validFlagsMask) !== 0) {
    return CreateTransferError.reserved_flag;
  }

  // Check mutually exclusive flags
  const pendingFlags = TransferFlags.pending | TransferFlags.post_pending_transfer | TransferFlags.void_pending_transfer;
  const pendingFlagsSet = flags & pendingFlags;
  if (pendingFlagsSet !== 0 && (pendingFlagsSet & (pendingFlagsSet - 1)) !== 0) {
    return CreateTransferError.flags_are_mutually_exclusive;
  }

  const balancingFlags = TransferFlags.balancing_debit | TransferFlags.balancing_credit;
  if ((flags & balancingFlags) === balancingFlags) {
    return CreateTransferError.flags_are_mutually_exclusive;
  }

  const closingFlags = TransferFlags.closing_debit | TransferFlags.closing_credit;
  if ((flags & closingFlags) === closingFlags) {
    return CreateTransferError.flags_are_mutually_exclusive;
  }

  // Pending ID validation
  if (flags & TransferFlags.pending) {
    if (transfer.pending_id !== 0n) {
      return CreateTransferError.pending_id_must_be_zero;
    }
  } else if (flags & (TransferFlags.post_pending_transfer | TransferFlags.void_pending_transfer)) {
    if (transfer.pending_id === 0n) {
      return CreateTransferError.pending_id_must_not_be_zero;
    }
    if (transfer.pending_id >= (2n ** 128n) - 1n) {
      return CreateTransferError.pending_id_must_not_be_int_max;
    }
    if (transfer.pending_id === transfer.id) {
      return CreateTransferError.pending_id_must_be_different;
    }
  } else {
    if (transfer.pending_id !== 0n) {
      return CreateTransferError.pending_id_must_be_zero;
    }
  }

  // Timeout validation
  if (flags & TransferFlags.pending) {
    // Pending transfers can have timeouts
    if (transfer.timeout > 0 && transfer.timeout > (2 ** 32 - 1)) {
      return CreateTransferError.overflows_timeout;
    }
  } else {
    // Non-pending transfers should not have timeouts
    if (transfer.timeout !== 0) {
      return CreateTransferError.timeout_reserved_for_pending_transfer;
    }
  }

  return CreateTransferError.ok;
}

/**
 * Validate transfer exists with same properties
 */
export function validateTransferExists(existing: Transfer, new_transfer: Transfer): CreateTransferError {
  if (existing.flags !== new_transfer.flags) {
    return CreateTransferError.exists_with_different_flags;
  }
  if (existing.debit_account_id !== new_transfer.debit_account_id) {
    return CreateTransferError.exists_with_different_debit_account_id;
  }
  if (existing.credit_account_id !== new_transfer.credit_account_id) {
    return CreateTransferError.exists_with_different_credit_account_id;
  }
  if (existing.amount !== new_transfer.amount) {
    return CreateTransferError.exists_with_different_amount;
  }
  if (existing.pending_id !== new_transfer.pending_id) {
    return CreateTransferError.exists_with_different_pending_id;
  }
  if (existing.user_data_128 !== new_transfer.user_data_128) {
    return CreateTransferError.exists_with_different_user_data_128;
  }
  if (existing.user_data_64 !== new_transfer.user_data_64) {
    return CreateTransferError.exists_with_different_user_data_64;
  }
  if (existing.user_data_32 !== new_transfer.user_data_32) {
    return CreateTransferError.exists_with_different_user_data_32;
  }
  if (existing.timeout !== new_transfer.timeout) {
    return CreateTransferError.exists_with_different_timeout;
  }
  if (existing.ledger !== new_transfer.ledger) {
    return CreateTransferError.exists_with_different_ledger;
  }
  if (existing.code !== new_transfer.code) {
    return CreateTransferError.exists_with_different_code;
  }
  
  return CreateTransferError.exists;
}

/**
 * Validate transfer against account constraints
 */
export function validateTransferAccounts(
  transfer: Transfer, 
  debitAccount: Account, 
  creditAccount: Account,
  pendingTransfer?: Transfer,
  pendingStatus?: TransferPendingStatus
): CreateTransferError {
  // Accounts must exist
  if (!debitAccount) {
    return CreateTransferError.debit_account_not_found;
  }
  if (!creditAccount) {
    return CreateTransferError.credit_account_not_found;
  }

  // Accounts must be on same ledger
  if (debitAccount.ledger !== creditAccount.ledger) {
    return CreateTransferError.accounts_must_have_the_same_ledger;
  }

  // Transfer must be on same ledger as accounts
  if (transfer.ledger !== debitAccount.ledger) {
    return CreateTransferError.transfer_must_have_the_same_ledger_as_accounts;
  }

  // Check if accounts are closed
  if (debitAccount.flags & AccountFlags.closed) {
    return CreateTransferError.debit_account_already_closed;
  }
  if (creditAccount.flags & AccountFlags.closed) {
    return CreateTransferError.credit_account_already_closed;
  }

  // Validate pending transfer if this is posting/voiding
  if (transfer.flags & (TransferFlags.post_pending_transfer | TransferFlags.void_pending_transfer)) {
    if (!pendingTransfer) {
      return CreateTransferError.pending_transfer_not_found;
    }

    if (!pendingStatus || pendingStatus !== TransferPendingStatus.pending) {
      return CreateTransferError.pending_transfer_not_pending;
    }

    // Validate pending transfer properties
    if (pendingTransfer.debit_account_id !== transfer.debit_account_id) {
      return CreateTransferError.pending_transfer_has_different_debit_account_id;
    }
    if (pendingTransfer.credit_account_id !== transfer.credit_account_id) {
      return CreateTransferError.pending_transfer_has_different_credit_account_id;
    }
    if (pendingTransfer.ledger !== transfer.ledger) {
      return CreateTransferError.pending_transfer_has_different_ledger;
    }
    if (pendingTransfer.code !== transfer.code) {
      return CreateTransferError.pending_transfer_has_different_code;
    }

    // For posting, validate amount
    if (transfer.flags & TransferFlags.post_pending_transfer) {
      if (transfer.amount > pendingTransfer.amount) {
        return CreateTransferError.exceeds_pending_transfer_amount;
      }
    }
    // For voiding, amount must match exactly
    else if (transfer.flags & TransferFlags.void_pending_transfer) {
      if (transfer.amount !== pendingTransfer.amount) {
        return CreateTransferError.pending_transfer_has_different_amount;
      }
    }
  }

  // Check balance constraints
  if (!canDebitAccount(debitAccount, transfer.amount)) {
    return CreateTransferError.exceeds_credits;
  }
  if (!canCreditAccount(creditAccount, transfer.amount)) {
    return CreateTransferError.exceeds_debits;
  }

  return CreateTransferError.ok;
}

/**
 * Check if account can be debited by the given amount
 */
export function canDebitAccount(account: Account, amount: bigint): boolean {
  // Check if debiting would violate debits_must_not_exceed_credits constraint
  if (account.flags & AccountFlags.debits_must_not_exceed_credits) {
    const newDebits = account.debits_posted + amount;
    return newDebits <= account.credits_posted;
  }
  return true;
}

/**
 * Check if account can be credited by the given amount
 */
export function canCreditAccount(account: Account, amount: bigint): boolean {
  // Check if crediting would violate credits_must_not_exceed_debits constraint
  if (account.flags & AccountFlags.credits_must_not_exceed_debits) {
    const newCredits = account.credits_posted + amount;
    return newCredits <= account.debits_posted;
  }
  return true;
}

/**
 * Check for arithmetic overflow in account balances
 */
export function wouldOverflowAccount(account: Account, debitAmount: bigint, creditAmount: bigint): CreateTransferError | null {
  const maxU128 = (2n ** 128n) - 1n;
  
  if (account.debits_posted + debitAmount > maxU128) {
    return CreateTransferError.overflows_debits_posted;
  }
  if (account.credits_posted + creditAmount > maxU128) {
    return CreateTransferError.overflows_credits_posted;
  }
  if (account.debits_posted + account.debits_pending + debitAmount > maxU128) {
    return CreateTransferError.overflows_debits;
  }
  if (account.credits_posted + account.credits_pending + creditAmount > maxU128) {
    return CreateTransferError.overflows_credits;
  }
  
  return null;
}