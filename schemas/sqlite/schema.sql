-- TigerBeetle Deno Port SQLite Schema
-- Based on TigerBeetle's Account and Transfer structures
-- Converted from MySQL schema to be SQLite/libSQL compatible

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Drop existing view(s) first to avoid name conflicts
DROP VIEW IF EXISTS account_balances_view;
DROP VIEW IF EXISTS account_transactions;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS pending_transfers;
DROP TABLE IF EXISTS account_balances;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS accounts;

-- Accounts table
-- Maps to TigerBeetle's Account struct
CREATE TABLE accounts (
    -- Primary identifier (u128 in TigerBeetle, stored as TEXT for SQLite)
    id TEXT PRIMARY KEY,
    
    -- Balance fields (u128 values stored as TEXT)
    debits_pending TEXT NOT NULL DEFAULT '0',
    debits_posted TEXT NOT NULL DEFAULT '0',
    credits_pending TEXT NOT NULL DEFAULT '0',
    credits_posted TEXT NOT NULL DEFAULT '0',
    
    -- User data fields for application-specific data
    user_data_128 TEXT NOT NULL DEFAULT '0',
    user_data_64 TEXT NOT NULL DEFAULT '0',
    user_data_32 INTEGER NOT NULL DEFAULT 0,
    
    -- Reserved field
    reserved INTEGER NOT NULL DEFAULT 0,
    
    -- Ledger partitions accounts by currency/asset type
    ledger INTEGER NOT NULL,
    
    -- Chart of accounts code (account type)
    code INTEGER NOT NULL,
    
    -- Account flags (packed bitfield)
    flags INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamp when account was created (u64, nanoseconds since epoch)
    timestamp TEXT NOT NULL DEFAULT '0',
    
    -- SQLite timestamps for tracking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (CAST(id AS INTEGER) > 0),
    CHECK (ledger > 0),
    CHECK (code > 0)
);

-- Indexes for efficient queries on accounts
CREATE INDEX idx_accounts_ledger ON accounts(ledger);
CREATE INDEX idx_accounts_code ON accounts(code);
CREATE INDEX idx_accounts_user_data_128 ON accounts(user_data_128);
CREATE INDEX idx_accounts_user_data_64 ON accounts(user_data_64);
CREATE INDEX idx_accounts_user_data_32 ON accounts(user_data_32);
CREATE INDEX idx_accounts_timestamp ON accounts(timestamp);
CREATE INDEX idx_accounts_flags ON accounts(flags);

-- Transfers table
-- Maps to TigerBeetle's Transfer struct
CREATE TABLE transfers (
    -- Primary identifier (u128 stored as TEXT)
    id TEXT PRIMARY KEY,
    
    -- Account IDs involved in the transfer
    debit_account_id TEXT NOT NULL,
    credit_account_id TEXT NOT NULL,
    
    -- Transfer amount (u128 stored as TEXT)
    amount TEXT NOT NULL,
    
    -- If this is posting/voiding a pending transfer, the pending transfer ID
    pending_id TEXT NOT NULL DEFAULT '0',
    
    -- User data fields
    user_data_128 TEXT NOT NULL DEFAULT '0',
    user_data_64 TEXT NOT NULL DEFAULT '0',
    user_data_32 INTEGER NOT NULL DEFAULT 0,
    
    -- Timeout for pending transfers (seconds)
    timeout INTEGER NOT NULL DEFAULT 0,
    
    -- Ledger this transfer belongs to
    ledger INTEGER NOT NULL,
    
    -- Transfer reason/type code
    code INTEGER NOT NULL,
    
    -- Transfer flags (packed bitfield)
    flags INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamp when transfer was processed
    timestamp TEXT NOT NULL DEFAULT '0',
    
    -- SQLite tracking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (CAST(id AS INTEGER) > 0),
    CHECK (CAST(debit_account_id AS INTEGER) > 0),
    CHECK (CAST(credit_account_id AS INTEGER) > 0),
    CHECK (debit_account_id != credit_account_id),
    CHECK (CAST(amount AS INTEGER) > 0),
    CHECK (ledger > 0),
    CHECK (code > 0),
    
    -- Foreign key constraints
    FOREIGN KEY (debit_account_id) REFERENCES accounts(id),
    FOREIGN KEY (credit_account_id) REFERENCES accounts(id)
);

-- Indexes for efficient queries on transfers
CREATE INDEX idx_transfers_debit_account ON transfers(debit_account_id);
CREATE INDEX idx_transfers_credit_account ON transfers(credit_account_id);
CREATE INDEX idx_transfers_pending_id ON transfers(pending_id);
CREATE INDEX idx_transfers_ledger ON transfers(ledger);
CREATE INDEX idx_transfers_code ON transfers(code);
CREATE INDEX idx_transfers_user_data_128 ON transfers(user_data_128);
CREATE INDEX idx_transfers_user_data_64 ON transfers(user_data_64);
CREATE INDEX idx_transfers_user_data_32 ON transfers(user_data_32);
CREATE INDEX idx_transfers_timestamp ON transfers(timestamp);
CREATE INDEX idx_transfers_flags ON transfers(flags);

-- Compound indexes for common query patterns
CREATE INDEX idx_transfers_account_timestamp ON transfers(debit_account_id, timestamp);
CREATE INDEX idx_transfers_account_timestamp_credit ON transfers(credit_account_id, timestamp);

-- Historical account balances table
-- Stores snapshots of account balances after each transfer (only for accounts with history flag)
CREATE TABLE account_balances (
    -- The account this balance snapshot belongs to
    account_id TEXT NOT NULL,
    
    -- Balance fields at this point in time
    debits_pending TEXT NOT NULL,
    debits_posted TEXT NOT NULL,
    credits_pending TEXT NOT NULL,
    credits_posted TEXT NOT NULL,
    
    -- Timestamp when this balance was recorded (matches transfer timestamp)
    timestamp TEXT NOT NULL,
    
    -- SQLite tracking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (CAST(account_id AS INTEGER) > 0),
    
    -- Foreign key to accounts table
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    
    -- Primary key is account + timestamp (multiple balances per account over time)
    PRIMARY KEY (account_id, timestamp)
);

-- Indexes for efficient queries on account balances
CREATE INDEX idx_account_balances_timestamp ON account_balances(timestamp);
CREATE INDEX idx_account_balances_account_timestamp ON account_balances(account_id, timestamp DESC);

-- Pending transfers tracking table
-- Tracks the status of two-phase transfers
CREATE TABLE pending_transfers (
    -- The pending transfer ID (same as transfer.id for pending transfers)
    id TEXT PRIMARY KEY,
    
    -- Current status: 1=pending, 2=posted, 3=voided, 4=expired
    status INTEGER NOT NULL DEFAULT 1,
    
    -- When this pending transfer expires (nanoseconds since epoch)
    expires_at TEXT NOT NULL DEFAULT '0',
    
    -- Timestamp when status was last updated
    timestamp TEXT NOT NULL DEFAULT '0',
    
    -- SQLite tracking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (status IN (1, 2, 3, 4)), -- pending, posted, voided, expired
    
    -- Foreign key to transfers table
    FOREIGN KEY (id) REFERENCES transfers(id)
);

-- Indexes on pending transfers
CREATE INDEX idx_pending_transfers_status ON pending_transfers(status);
CREATE INDEX idx_pending_transfers_expires_at ON pending_transfers(expires_at);
CREATE INDEX idx_pending_transfers_timestamp ON pending_transfers(timestamp);

-- Views for easier querying

-- Account balances view (renamed to avoid conflicting with the historical balances table name)
CREATE VIEW account_balances_view AS
SELECT 
    id,
    ledger,
    code,
    debits_pending,
    debits_posted,
    credits_pending,
    credits_posted,
    (CAST(debits_posted AS INTEGER) - CAST(credits_posted AS INTEGER)) as debit_balance,
    (CAST(credits_posted AS INTEGER) - CAST(debits_posted AS INTEGER)) as credit_balance,
    timestamp
FROM accounts;

-- All account transactions view
CREATE VIEW account_transactions AS
SELECT 
    t.id,
    t.debit_account_id as account_id,
    'debit' as transaction_type,
    t.amount,
    t.ledger,
    t.code,
    t.flags,
    t.timestamp,
    t.user_data_128,
    t.user_data_64,
    t.user_data_32
FROM transfers t
UNION ALL
SELECT 
    t.id,
    t.credit_account_id as account_id,
    'credit' as transaction_type,
    t.amount,
    t.ledger,
    t.code,
    t.flags,
    t.timestamp,
    t.user_data_128,
    t.user_data_64,
    t.user_data_32
FROM transfers t;

-- Trigger to automatically manage pending_transfers table
CREATE TRIGGER transfer_pending_insert 
    AFTER INSERT ON transfers
    FOR EACH ROW
    WHEN (NEW.flags & 2) = 2 -- TransferFlags.pending
BEGIN
    INSERT INTO pending_transfers (id, status, expires_at, timestamp)
    VALUES (
        NEW.id, 
        1, -- pending status
        CASE 
            WHEN NEW.timeout > 0 THEN CAST(NEW.timestamp AS INTEGER) + (NEW.timeout * 1000000000)
            ELSE 0
        END,
        NEW.timestamp
    );
END;

-- Trigger to update pending transfer status when posting
CREATE TRIGGER transfer_post_pending_update
    AFTER INSERT ON transfers
    FOR EACH ROW
    WHEN (NEW.flags & 4) = 4 AND CAST(NEW.pending_id AS INTEGER) > 0 -- TransferFlags.post_pending_transfer
BEGIN
    UPDATE pending_transfers 
    SET status = 2, timestamp = NEW.timestamp -- posted status
    WHERE id = NEW.pending_id;
END;

-- Trigger to update pending transfer status when voiding
CREATE TRIGGER transfer_void_pending_update
    AFTER INSERT ON transfers
    FOR EACH ROW
    WHEN (NEW.flags & 8) = 8 AND CAST(NEW.pending_id AS INTEGER) > 0 -- TransferFlags.void_pending_transfer
BEGIN
    UPDATE pending_transfers 
    SET status = 3, timestamp = NEW.timestamp -- voided status
    WHERE id = NEW.pending_id;
END;

-- Note: SQLite doesn't have stored procedures, so the ExpirePendingTransfers functionality
-- would need to be implemented in application code. Here's the equivalent SQL for reference:
--
-- UPDATE pending_transfers 
-- SET status = 4, timestamp = strftime('%s', 'now') * 1000000000 -- expired status
-- WHERE status = 1 -- currently pending
--   AND CAST(expires_at AS INTEGER) > 0 
--   AND CAST(expires_at AS INTEGER) <= strftime('%s', 'now') * 1000000000; -- past expiration time