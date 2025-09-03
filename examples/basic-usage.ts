/**
 * Example usage of TigerBeetle Deno Port
 * Demonstrates basic accounting operations
 */

import {
  createClient,
  AccountFlags,
  TransferFlags,
  id,
} from '../src/index.ts';

// Example configuration
const config = {
  host: 'localhost',
  port: 3306,
  database: 'tigerbeetle',
  user: 'root',
  password: 'password',
};

async function example() {
  console.log('🐅 TigerBeetle Deno Port Example');
  
  // Create client
  const client = createClient(config);
  
  try {
    // Generate unique IDs
    const aliceAccountId = id();
    const bobAccountId = id();
    const transferId1 = id();
    const transferId2 = id();
    
    console.log('\n📊 Creating accounts...');
    
    // Create accounts
    const accountErrors = await client.createAccounts([
      {
        id: aliceAccountId,
        ledger: 1, // USD ledger
        code: 100, // Asset account type
        flags: AccountFlags.debits_must_not_exceed_credits, // Asset account
        debits_pending: 0n,
        debits_posted: 0n,
        credits_pending: 0n,
        credits_posted: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        reserved: 0,
        timestamp: 0n, // Will be set by the system
      },
      {
        id: bobAccountId,
        ledger: 1, // USD ledger
        code: 200, // Liability account type  
        flags: AccountFlags.credits_must_not_exceed_debits, // Liability account
        debits_pending: 0n,
        debits_posted: 0n,
        credits_pending: 0n,
        credits_posted: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 0,
        reserved: 0,
        timestamp: 0n,
      }
    ]);
    
    if (accountErrors.length > 0) {
      console.error('❌ Account creation errors:', accountErrors);
      return;
    }
    
    console.log('✅ Accounts created successfully');
    console.log(`   Alice account ID: ${aliceAccountId}`);
    console.log(`   Bob account ID: ${bobAccountId}`);
    
    console.log('\n💸 Creating transfers...');
    
    // Transfer $100 from Alice to Bob
    const transferErrors = await client.createTransfers([
      {
        id: transferId1,
        debit_account_id: aliceAccountId, // Alice pays (debit)
        credit_account_id: bobAccountId,  // Bob receives (credit)
        amount: 10000n, // $100.00 in cents
        pending_id: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 1001, // Transaction type: payment
        timeout: 0,
        ledger: 1, // USD ledger
        code: 1,   // Payment code
        flags: TransferFlags.none,
        timestamp: 0n,
      }
    ]);
    
    if (transferErrors.length > 0) {
      console.error('❌ Transfer creation errors:', transferErrors);
      return;
    }
    
    console.log('✅ Transfer completed successfully');
    console.log(`   Transfer ID: ${transferId1}`);
    console.log('   Amount: $100.00');
    
    console.log('\n🔍 Looking up account balances...');
    
    // Look up accounts to see updated balances
    const accounts = await client.lookupAccounts([aliceAccountId, bobAccountId]);
    
    for (const account of accounts) {
      const accountName = account.id === aliceAccountId ? 'Alice' : 'Bob';
      const debitBalance = Number(account.debits_posted - account.credits_posted) / 100;
      const creditBalance = Number(account.credits_posted - account.debits_posted) / 100;
      
      console.log(`   ${accountName} (ID: ${account.id}):`);
      console.log(`     Debits Posted: $${Number(account.debits_posted) / 100}`);
      console.log(`     Credits Posted: $${Number(account.credits_posted) / 100}`);
      
      if (account.flags & AccountFlags.debits_must_not_exceed_credits) {
        console.log(`     Balance (Asset): $${debitBalance}`);
      } else {
        console.log(`     Balance (Liability): $${creditBalance}`);
      }
    }
    
    console.log('\n🔄 Demonstrating pending transfer...');
    
    // Create a pending transfer
    const pendingTransferId = id();
    const pendingErrors = await client.createTransfers([
      {
        id: pendingTransferId,
        debit_account_id: bobAccountId,
        credit_account_id: aliceAccountId,
        amount: 5000n, // $50.00 in cents
        pending_id: 0n,
        user_data_128: 0n,
        user_data_64: 0n,
        user_data_32: 1002, // Transaction type: pending payment
        timeout: 3600, // 1 hour timeout
        ledger: 1,
        code: 2, // Pending payment code
        flags: TransferFlags.pending,
        timestamp: 0n,
      }
    ]);
    
    if (pendingErrors.length > 0) {
      console.error('❌ Pending transfer creation errors:', pendingErrors);
    } else {
      console.log('✅ Pending transfer created');
      console.log(`   Pending Transfer ID: ${pendingTransferId}`);
      
      // Look up balances to show pending amounts
      const accountsWithPending = await client.lookupAccounts([aliceAccountId, bobAccountId]);
      
      for (const account of accountsWithPending) {
        const accountName = account.id === aliceAccountId ? 'Alice' : 'Bob';
        console.log(`   ${accountName}:`);
        console.log(`     Debits Pending: $${Number(account.debits_pending) / 100}`);
        console.log(`     Credits Pending: $${Number(account.credits_pending) / 100}`);
      }
      
      // Post the pending transfer
      console.log('\n✅ Posting pending transfer...');
      const postTransferId = id();
      const postErrors = await client.createTransfers([
        {
          id: postTransferId,
          debit_account_id: bobAccountId,
          credit_account_id: aliceAccountId,
          amount: 5000n, // Same amount
          pending_id: pendingTransferId, // Reference to pending transfer
          user_data_128: 0n,
          user_data_64: 0n,
          user_data_32: 1003,
          timeout: 0,
          ledger: 1,
          code: 2,
          flags: TransferFlags.post_pending_transfer,
          timestamp: 0n,
        }
      ]);
      
      if (postErrors.length > 0) {
        console.error('❌ Post pending transfer errors:', postErrors);
      } else {
        console.log('✅ Pending transfer posted successfully');
      }
    }
    
    console.log('\n📋 Final account balances:');
    
    const finalAccounts = await client.lookupAccounts([aliceAccountId, bobAccountId]);
    
    for (const account of finalAccounts) {
      const accountName = account.id === aliceAccountId ? 'Alice' : 'Bob';
      const debitBalance = Number(account.debits_posted - account.credits_posted) / 100;
      const creditBalance = Number(account.credits_posted - account.debits_posted) / 100;
      
      console.log(`   ${accountName}:`);
      console.log(`     Debits Posted: $${Number(account.debits_posted) / 100}`);
      console.log(`     Credits Posted: $${Number(account.credits_posted) / 100}`);
      console.log(`     Debits Pending: $${Number(account.debits_pending) / 100}`);
      console.log(`     Credits Pending: $${Number(account.credits_pending) / 100}`);
      
      if (account.flags & AccountFlags.debits_must_not_exceed_credits) {
        console.log(`     Balance (Asset): $${debitBalance}`);
      } else {
        console.log(`     Balance (Liability): $${creditBalance}`);
      }
    }
    
    console.log('\n🎉 Example completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.destroy();
  }
}

// Run example if this file is executed directly
if (import.meta.main) {
  example().catch(console.error);
}