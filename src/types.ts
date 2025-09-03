/**
 * TypeScript types and interfaces ported from TigerBeetle Node.js client
 * Based on src/clients/node/src/bindings.ts
 */

export enum AccountFlags {
  none = 0,
  linked = (1 << 0),
  debits_must_not_exceed_credits = (1 << 1),
  credits_must_not_exceed_debits = (1 << 2),
  history = (1 << 3),
  imported = (1 << 4),
  closed = (1 << 5),
}

export enum TransferFlags {
  none = 0,
  linked = (1 << 0),
  pending = (1 << 1),
  post_pending_transfer = (1 << 2),
  void_pending_transfer = (1 << 3),
  balancing_debit = (1 << 4),
  balancing_credit = (1 << 5),
  closing_debit = (1 << 6),
  closing_credit = (1 << 7),
  imported = (1 << 8),
}

export enum AccountFilterFlags {
  none = 0,
  debits = (1 << 0),
  credits = (1 << 1),
  reversed = (1 << 2),
}

export enum QueryFilterFlags {
  none = 0,
  reversed = (1 << 0),
}

export interface Account {
  id: bigint;
  debits_pending: bigint;
  debits_posted: bigint;
  credits_pending: bigint;
  credits_posted: bigint;
  user_data_128: bigint;
  user_data_64: bigint;
  user_data_32: number;
  reserved: number;
  ledger: number;
  code: number;
  flags: number;
  timestamp: bigint;
}

export interface Transfer {
  id: bigint;
  debit_account_id: bigint;
  credit_account_id: bigint;
  amount: bigint;
  pending_id: bigint;
  user_data_128: bigint;
  user_data_64: bigint;
  user_data_32: number;
  timeout: number;
  ledger: number;
  code: number;
  flags: number;
  timestamp: bigint;
}

export enum CreateAccountError {
  ok = 0,
  linked_event_failed = 1,
  linked_event_chain_open = 2,
  imported_event_expected = 22,
  imported_event_not_expected = 23,
  timestamp_must_be_zero = 3,
  imported_event_timestamp_out_of_range = 24,
  imported_event_timestamp_must_not_advance = 25,
  reserved_field = 4,
  reserved_flag = 5,
  id_must_not_be_zero = 6,
  id_must_not_be_int_max = 7,
  exists_with_different_flags = 15,
  exists_with_different_user_data_128 = 16,
  exists_with_different_user_data_64 = 17,
  exists_with_different_user_data_32 = 18,
  exists_with_different_ledger = 19,
  exists_with_different_code = 20,
  exists = 21,
  flags_are_mutually_exclusive = 8,
  debits_pending_must_be_zero = 9,
  debits_posted_must_be_zero = 10,
  credits_pending_must_be_zero = 11,
  credits_posted_must_be_zero = 12,
  ledger_must_not_be_zero = 13,
  code_must_not_be_zero = 14,
  imported_event_timestamp_must_not_regress = 26,
}

export enum CreateTransferError {
  ok = 0,
  linked_event_failed = 1,
  linked_event_chain_open = 2,
  imported_event_expected = 56,
  imported_event_not_expected = 57,
  timestamp_must_be_zero = 3,
  imported_event_timestamp_out_of_range = 58,
  imported_event_timestamp_must_not_advance = 59,
  reserved_flag = 4,
  id_must_not_be_zero = 5,
  id_must_not_be_int_max = 6,
  exists_with_different_flags = 36,
  exists_with_different_pending_id = 40,
  exists_with_different_timeout = 44,
  exists_with_different_debit_account_id = 37,
  exists_with_different_credit_account_id = 38,
  exists_with_different_amount = 39,
  exists_with_different_user_data_128 = 41,
  exists_with_different_user_data_64 = 42,
  exists_with_different_user_data_32 = 43,
  exists_with_different_ledger = 67,
  exists_with_different_code = 45,
  exists = 46,
  id_already_failed = 68,
  flags_are_mutually_exclusive = 7,
  debit_account_id_must_not_be_zero = 8,
  debit_account_id_must_not_be_int_max = 9,
  credit_account_id_must_not_be_zero = 10,
  credit_account_id_must_not_be_int_max = 11,
  accounts_must_be_different = 12,
  pending_id_must_be_zero = 13,
  pending_id_must_not_be_zero = 14,
  pending_id_must_not_be_int_max = 15,
  pending_id_must_be_different = 16,
  timeout_reserved_for_pending_transfer = 17,
  closing_transfer_must_be_pending = 64,
  ledger_must_not_be_zero = 19,
  code_must_not_be_zero = 20,
  debit_account_not_found = 21,
  credit_account_not_found = 22,
  accounts_must_have_the_same_ledger = 23,
  transfer_must_have_the_same_ledger_as_accounts = 24,
  pending_transfer_not_found = 25,
  pending_transfer_not_pending = 26,
  pending_transfer_has_different_debit_account_id = 27,
  pending_transfer_has_different_credit_account_id = 28,
  pending_transfer_has_different_ledger = 29,
  pending_transfer_has_different_code = 30,
  exceeds_pending_transfer_amount = 31,
  pending_transfer_has_different_amount = 32,
  pending_transfer_already_posted = 33,
  pending_transfer_already_voided = 34,
  pending_transfer_expired = 35,
  imported_event_timestamp_must_not_regress = 60,
  imported_event_timestamp_must_postdate_debit_account = 61,
  imported_event_timestamp_must_postdate_credit_account = 62,
  imported_event_timeout_must_be_zero = 63,
  debit_account_already_closed = 65,
  credit_account_already_closed = 66,
  overflows_debits_pending = 47,
  overflows_credits_pending = 48,
  overflows_debits_posted = 49,
  overflows_credits_posted = 50,
  overflows_debits = 51,
  overflows_credits = 52,
  overflows_timeout = 53,
  exceeds_credits = 54,
  exceeds_debits = 55,
}

export interface CreateAccountsError {
  index: number;
  result: CreateAccountError;
}

export interface CreateTransfersError {
  index: number;
  result: CreateTransferError;
}

export interface AccountFilter {
  account_id: bigint;
  user_data_128: bigint;
  user_data_64: bigint;
  user_data_32: number;
  code: number;
  timestamp_min: bigint;
  timestamp_max: bigint;
  limit: number;
  flags: number;
}

export interface QueryFilter {
  user_data_128: bigint;
  user_data_64: bigint;
  user_data_32: number;
  ledger: number;
  code: number;
  timestamp_min: bigint;
  timestamp_max: bigint;
  limit: number;
  flags: number;
}

export interface AccountBalance {
  account_id: bigint;
  debits_pending: bigint;
  debits_posted: bigint;
  credits_pending: bigint;
  credits_posted: bigint;
  timestamp: bigint;
}

export type AccountID = bigint;
export type TransferID = bigint;

export const amount_max: bigint = (2n ** 128n) - 1n;

export enum Operation {
  pulse = 128,
  get_change_events = 137,
  create_accounts = 138,
  create_transfers = 139,
  lookup_accounts = 140,
  lookup_transfers = 141,
  get_account_transfers = 142,
  get_account_balances = 143,
  query_accounts = 144,
  query_transfers = 145,
}

// Database configuration types are now in database/database-interface.ts

export enum TransferPendingStatus {
  none = 0,
  pending = 1,
  posted = 2,
  voided = 3,
  expired = 4,
}