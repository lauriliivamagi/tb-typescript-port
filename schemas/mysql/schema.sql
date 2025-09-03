-- TigerBeetle Deno Port MySQL Schema
-- Based on TigerBeetle's Account and Transfer structures

-- Drop existing view(s) first to avoid name conflicts
DROP VIEW IF EXISTS account_balances;

-- Drop existing tables if they exist
DROP TABLE IF EXISTS pending_transfers;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS accounts;

-- Accounts table
-- Maps to TigerBeetle's Account struct
CREATE TABLE accounts (
    -- Primary identifier (u128 in TigerBeetle, stored as DECIMAL(39,0) for exact precision)
    id DECIMAL(39,0) PRIMARY KEY,
    
    -- Balance fields (u128 values)
    debits_pending DECIMAL(39,0) NOT NULL DEFAULT 0,
    debits_posted DECIMAL(39,0) NOT NULL DEFAULT 0,
    credits_pending DECIMAL(39,0) NOT NULL DEFAULT 0,
    credits_posted DECIMAL(39,0) NOT NULL DEFAULT 0,
    
    -- User data fields for application-specific data
    user_data_128 DECIMAL(39,0) NOT NULL DEFAULT 0,
    user_data_64 BIGINT UNSIGNED NOT NULL DEFAULT 0,
    user_data_32 INT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Reserved field
    reserved INT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Ledger partitions accounts by currency/asset type
    ledger INT UNSIGNED NOT NULL,
    
    -- Chart of accounts code (account type)
    code SMALLINT UNSIGNED NOT NULL,
    
    -- Account flags (packed bitfield)
    flags SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Timestamp when account was created (u64, nanoseconds since epoch)
    timestamp BIGINT UNSIGNED NOT NULL DEFAULT 0,
    
    -- MySQL timestamps for tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (id > 0),
    CHECK (id < POWER(2, 128) - 1),
    CHECK (ledger > 0),
    CHECK (code > 0),
    
    -- Indexes for efficient queries
    INDEX idx_ledger (ledger),
    INDEX idx_code (code),
    INDEX idx_user_data_128 (user_data_128),
    INDEX idx_user_data_64 (user_data_64),
    INDEX idx_user_data_32 (user_data_32),
    INDEX idx_timestamp (timestamp),
    INDEX idx_flags (flags)
) ENGINE=InnoDB CHARACTER SET=utf8mb4;

-- Transfers table
-- Maps to TigerBeetle's Transfer struct
CREATE TABLE transfers (
    -- Primary identifier (u128)
    id DECIMAL(39,0) PRIMARY KEY,
    
    -- Account IDs involved in the transfer
    debit_account_id DECIMAL(39,0) NOT NULL,
    credit_account_id DECIMAL(39,0) NOT NULL,
    
    -- Transfer amount (u128)
    amount DECIMAL(39,0) NOT NULL,
    
    -- If this is posting/voiding a pending transfer, the pending transfer ID
    pending_id DECIMAL(39,0) NOT NULL DEFAULT 0,
    
    -- User data fields
    user_data_128 DECIMAL(39,0) NOT NULL DEFAULT 0,
    user_data_64 BIGINT UNSIGNED NOT NULL DEFAULT 0,
    user_data_32 INT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Timeout for pending transfers (seconds)
    timeout INT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Ledger this transfer belongs to
    ledger INT UNSIGNED NOT NULL,
    
    -- Transfer reason/type code
    code SMALLINT UNSIGNED NOT NULL,
    
    -- Transfer flags (packed bitfield)
    flags SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Timestamp when transfer was processed
    timestamp BIGINT UNSIGNED NOT NULL DEFAULT 0,
    
    -- MySQL tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (id > 0),
    CHECK (id < POWER(2, 128) - 1),
    CHECK (debit_account_id > 0),
    CHECK (credit_account_id > 0),
    CHECK (debit_account_id != credit_account_id),
    CHECK (amount > 0),
    CHECK (ledger > 0),
    CHECK (code > 0),
    
    -- Foreign key constraints
    FOREIGN KEY (debit_account_id) REFERENCES accounts(id),
    FOREIGN KEY (credit_account_id) REFERENCES accounts(id),
    
    -- Indexes for efficient queries
    INDEX idx_debit_account (debit_account_id),
    INDEX idx_credit_account (credit_account_id),
    INDEX idx_pending_id (pending_id),
    INDEX idx_ledger (ledger),
    INDEX idx_code (code),
    INDEX idx_user_data_128 (user_data_128),
    INDEX idx_user_data_64 (user_data_64),
    INDEX idx_user_data_32 (user_data_32),
    INDEX idx_timestamp (timestamp),
    INDEX idx_flags (flags),
    
    -- Compound indexes for common query patterns
    INDEX idx_account_timestamp (debit_account_id, timestamp),
    INDEX idx_account_timestamp_credit (credit_account_id, timestamp)
) ENGINE=InnoDB CHARACTER SET=utf8mb4;

-- Historical account balances table
-- Stores snapshots of account balances after each transfer (only for accounts with history flag)
CREATE TABLE account_balances (
    -- The account this balance snapshot belongs to
    account_id DECIMAL(39,0) NOT NULL,
    
    -- Balance fields at this point in time
    debits_pending DECIMAL(39,0) NOT NULL,
    debits_posted DECIMAL(39,0) NOT NULL,
    credits_pending DECIMAL(39,0) NOT NULL,
    credits_posted DECIMAL(39,0) NOT NULL,
    
    -- Timestamp when this balance was recorded (matches transfer timestamp)
    timestamp BIGINT UNSIGNED NOT NULL,
    
    -- MySQL tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (account_id > 0),
    
    -- Foreign key to accounts table
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    
    -- Primary key is account + timestamp (multiple balances per account over time)
    PRIMARY KEY (account_id, timestamp),
    
    -- Indexes for efficient queries
    INDEX idx_timestamp (timestamp),
    INDEX idx_account_timestamp (account_id, timestamp DESC)
) ENGINE=InnoDB CHARACTER SET=utf8mb4;

-- Pending transfers tracking table
-- Tracks the status of two-phase transfers
CREATE TABLE pending_transfers (
    -- The pending transfer ID (same as transfer.id for pending transfers)
    id DECIMAL(39,0) PRIMARY KEY,
    
    -- Current status: 1=pending, 2=posted, 3=voided, 4=expired
    status TINYINT UNSIGNED NOT NULL DEFAULT 1,
    
    -- When this pending transfer expires (nanoseconds since epoch)
    expires_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
    
    -- Timestamp when status was last updated
    timestamp BIGINT UNSIGNED NOT NULL DEFAULT 0,
    
    -- MySQL tracking
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Constraints
    CHECK (status IN (1, 2, 3, 4)), -- pending, posted, voided, expired
    
    -- Foreign key to transfers table
    FOREIGN KEY (id) REFERENCES transfers(id),
    
    -- Indexes
    INDEX idx_status (status),
    INDEX idx_expires_at (expires_at),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB CHARACTER SET=utf8mb4;

-- Views for easier querying

-- Note: renamed to avoid conflicting with the historical balances table name
CREATE VIEW account_balances_view AS
SELECT 
    id,
    ledger,
    code,
    debits_pending,
    debits_posted,
    credits_pending,
    credits_posted,
    (debits_posted - credits_posted) as debit_balance,
    (credits_posted - debits_posted) as credit_balance,
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
DELIMITER //

CREATE TRIGGER transfer_pending_insert 
    AFTER INSERT ON transfers
    FOR EACH ROW
BEGIN
    -- If this is a pending transfer, insert into pending_transfers table
    IF (NEW.flags & 2) = 2 THEN -- TransferFlags.pending
        INSERT INTO pending_transfers (id, status, expires_at, timestamp)
        VALUES (
            NEW.id, 
            1, -- pending status
            CASE 
                WHEN NEW.timeout > 0 THEN NEW.timestamp + (NEW.timeout * 1000000000)
                ELSE 0
            END,
            NEW.timestamp
        );
    END IF;
    
    -- If this is posting a pending transfer, update status
    IF (NEW.flags & 4) = 4 AND NEW.pending_id > 0 THEN -- TransferFlags.post_pending_transfer
        UPDATE pending_transfers 
        SET status = 2, timestamp = NEW.timestamp -- posted status
        WHERE id = NEW.pending_id;
    END IF;
    
    -- If this is voiding a pending transfer, update status
    IF (NEW.flags & 8) = 8 AND NEW.pending_id > 0 THEN -- TransferFlags.void_pending_transfer
        UPDATE pending_transfers 
        SET status = 3, timestamp = NEW.timestamp -- voided status
        WHERE id = NEW.pending_id;
    END IF;
END //

DELIMITER ;

-- Procedure to expire old pending transfers
DELIMITER //

CREATE PROCEDURE ExpirePendingTransfers()
BEGIN
    UPDATE pending_transfers 
    SET status = 4, timestamp = UNIX_TIMESTAMP() * 1000000000 -- expired status
    WHERE status = 1 -- currently pending
      AND expires_at > 0 
      AND expires_at <= UNIX_TIMESTAMP() * 1000000000; -- past expiration time
END //

DELIMITER ;
