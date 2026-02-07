// src/consumers/onBatchReady.ts

/**
 * Batch Ready Consumer
 * 
 * When a merchant's intent threshold is hit, this consumer executes
 * the on-chain batch settlement via the BatchSettler contract.
 * 
 * Flow:
 * 1. Read from "intent-hit" stream
 * 2. Aggregate merchants ready for settlement (could batch multiple)
 * 3. Call BatchSettler.executeBatch() on-chain
 * 4. Update Yellow Network (mark credits as settled)
 * 5. Update database (mark payments as settled)
 * 6. Acknowledge message
 */

import { ethers } from 'ethers';
import { 
  redis, 
  readStream, 
  ackMessage, 
  publishEvent, 
  STREAMS,
  createConsumerGroup 
} from '../config/redis.js';
import { env } from '../config/env.js';
import {
  PaymentPoolABI_Interface,
  BatchSettlerABI_Interface,
  PAYMENT_POOL_ADDRESS,
  BATCH_SETTLER_ADDRESS,
} from '../config/contracts.js';
import { prisma } from '../services/database.js';
import { 
  getLiFiQuote, 
  executeLiFiQuote,
  getUSDCAddress,
  getDAIAddress 
} from '../services/lifi.js';

// ─── Contract Setup ──────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(env.ARC_RPC_URL);

// Need a signer to send transactions
const wallet = new ethers.Wallet(env.DEPLOYER_PRIVATE_KEY, provider);

const paymentPool = new ethers.Contract(
  PAYMENT_POOL_ADDRESS,
  PaymentPoolABI_Interface,
  provider // Read-only
);

const batchSettler = new ethers.Contract(
  BATCH_SETTLER_ADDRESS,
  BatchSettlerABI_Interface,
  wallet // Needs to send transactions
);

// ─── Consumer Configuration ──────────────────────────────────────────────────

const CONSUMER_GROUP = 'batch-executors';
const CONSUMER_NAME = `batch-executor-${process.pid}`;

// ─── Batch Settlement Logic ──────────────────────────────────────────────────

interface SettlementRequest {
  merchant: string;
  token: string;
  balance: string;
  intent: {
    speed: string;
    targetToken: string;
  };
  timestamp: number;
}

/**
 * Execute a batch settlement on-chain.
 * 
 * @param request - Settlement request from intent-hit stream
 */
async function executeBatchSettlement(request: SettlementRequest): Promise<void> {
  const { merchant, token, balance, intent } = request;

  console.log(`⚙️  Executing batch settlement for merchant ${merchant}`);
  console.log(`   Token: ${token}`);
  console.log(`   Balance: ${ethers.formatUnits(balance, 6)} USDC`);
  console.log(`   Target token: ${intent.targetToken}`);

  // ─── Step 1: Verify balance on-chain ────────────────────────────────────

  let actualBalance: bigint;
  
  try {
    actualBalance = await paymentPool.getMerchantBalance(merchant, token);
    
    console.log(`   ✅ Verified on-chain balance: ${ethers.formatUnits(actualBalance, 6)} USDC`);
    
    if (actualBalance === 0n) {
      console.log(`   ⚠️  Balance is zero, skipping settlement`);
      return;
    }
  } catch (error) {
    console.error(`   ❌ Failed to verify balance:`, error);
    throw error;
  }

// ─── Step 2: Prepare batch data ─────────────────────────────────────────

// Create Settlement struct
const settlements = [{
  merchant: merchant,
  token: token,
  amount: actualBalance,
  recipient: merchant  // Send to merchant's wallet
}];

// Generate batch ID (timestamp-based)
const batchId = ethers.id(`batch-${Date.now()}`);
const totalGasSaved = 0; // We can estimate this later

console.log(`   📦 Batch prepared:`);
console.log(`      Batch ID: ${batchId}`);
console.log(`      Merchants: 1`);
console.log(`      Total amount: ${ethers.formatUnits(actualBalance, 6)} USDC`);

// ─── Step 3: Execute batch settlement ───────────────────────────────────

let tx: ethers.TransactionResponse;

try {
  console.log(`   📤 Sending executeBatch transaction...`);
  
  // Call BatchSettler.executeBatch(batchId, settlements[], totalGasSaved)
  tx = await batchSettler.executeBatch(batchId, settlements, totalGasSaved);
    
    console.log(`   ⏳ Transaction sent: ${tx.hash}`);
    console.log(`   ⏳ Waiting for confirmation...`);
    
    // Wait for transaction to be mined
    const receipt = await tx.wait();
    
    if (!receipt) {
      console.error(`   ❌ Transaction was not mined`);
      throw new Error('Transaction was not mined');
    }
    
    if (receipt.status === 1) {
      console.log(`   ✅ Transaction confirmed!`);
      console.log(`      Block: ${receipt.blockNumber}`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
    } else {
      console.error(`   ❌ Transaction failed (status: ${receipt.status})`);
      throw new Error('Transaction reverted');
    }
  } catch (error: any) {
    console.error(`   ❌ Failed to execute batch:`, error.message);
    
    // Parse revert reason if available
    if (error.reason) {
      console.error(`      Revert reason: ${error.reason}`);
    }
    
    throw error;
  }

 // ─── Step 3.5: Cross-Chain Routing (if needed) ──────────────────────────

/**
 * If merchant wants to receive in a different token/chain,
 * use Li.Fi to get REAL routing quotes and show what would happen.
 * 
 * For demo: We'll check if merchant wants a different chain
 * and show real Li.Fi routing data.
 */

// Example: Check if merchant wants funds on a different chain
// In production, this would come from merchant preferences in IntentVault
const MERCHANT_PREFERENCES: { [merchant: string]: { chain: number; token: string } } = {
  '0x172b7952b0f711b8b372410e81d51dcba7d4bb02': { 
    chain: 42161, // Arbitrum
    token: getUSDCAddress(42161) // USDC on Arbitrum
  }
};

const merchantPref = MERCHANT_PREFERENCES[merchant.toLowerCase()];

if (merchantPref) {
  console.log(`   🌉 Merchant wants different chain/token`);
  console.log(`      Target: Chain ${merchantPref.chain}`);
  console.log(`      Fetching REAL Li.Fi quote...`);
  
  try {
    // Get REAL quote from Li.Fi API
    const quote = await getLiFiQuote({
      fromChainId: 137, // Polygon (example - Arc not supported by Li.Fi yet)
      toChainId: merchantPref.chain,
      fromToken: getUSDCAddress(137), // USDC on Polygon
      toToken: merchantPref.token,
      fromAmount: actualBalance.toString(),
      fromAddress: merchant,
    });
    
    // Simulate execution based on real quote
    const lifiResult = await executeLiFiQuote(quote);
    
    console.log(`   ✅ Li.Fi routing complete`);
    console.log(`      Real quote from Li.Fi API`);
    console.log(`      Bridge: ${lifiResult.bridge}`);
    console.log(`      Output: ${ethers.formatUnits(lifiResult.outputAmount, 6)} USDC`);
    console.log(`      Gas cost: $${lifiResult.gasUsed}`);
    
  } catch (error: any) {
    console.error(`   ❌ Li.Fi routing failed:`, error.message);
    console.log(`   ⚠️  Merchant received original token instead`);
  }
} else {
  console.log(`   ℹ️  Merchant accepting settlement token (no cross-chain routing needed)`);
}

  // ─── Step 4: Update Yellow Network ──────────────────────────────────────

/**
 * Notify Yellow Network that on-chain settlement is complete.
 * 
 * In production:
 * - Yellow Network's off-chain state is reconciled with on-chain settlement
 * - This closes the liquidity loop (off-chain credit → on-chain settlement)
 * 
 * Demo mode:
 * - This is currently mocked for demonstration
 */
console.log(`    [MOCK] Updating Yellow Network for merchant ${merchant}`);
console.log(`    [MOCK] Amount: ${ethers.formatUnits(actualBalance, 6)} USDC`);
console.log(`    [MOCK] TxHash: ${tx.hash}`);

  try {
    await mockUpdateYellowSettlement(merchant, actualBalance, tx.hash);
    console.log(`   ✅ Yellow Network updated`);
  } catch (error) {
    console.error(`   ❌ Failed to update Yellow:`, error);
    // Don't throw - settlement succeeded, Yellow update can be retried
  }

  // ─── Step 5: Update database ────────────────────────────────────────────

  try {
    await updateDatabaseSettlement(merchant, token, actualBalance, tx.hash, batchId);
    console.log(`   ✅ Database updated`);
  } catch (error) {
    console.error(`   ❌ Failed to update database:`, error);
    // Don't throw - settlement succeeded, DB update can be retried
  }

  console.log(`✅ Batch settlement complete for merchant ${merchant}`);
}

// ─── Mock Functions ──────────────────────────────────────────────────────────

/**
 * Mock function to update Yellow Network after settlement.
 * 
 * TODO: Replace with actual Yellow SDK call:
 * 
 * await yellowClient.markAsSettled({
 *   merchantId: merchant,
 *   amount: amount,
 *   txHash: txHash,
 *   chainId: 5042002, // Arc testnet
 * });
 */
async function mockUpdateYellowSettlement(
  merchant: string,
  amount: bigint,
  txHash: string
): Promise<void> {
  console.log(`    [MOCK] Updating Yellow Network for merchant ${merchant}`);
  console.log(`    [MOCK] Amount: ${ethers.formatUnits(amount, 6)} USDC`);
  console.log(`    [MOCK] TxHash: ${txHash}`);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Update database after settlement using Prisma.
 */
async function updateDatabaseSettlement(
  merchant: string,
  token: string,
  amount: bigint,
  txHash: string,
  batchId: string
): Promise<void> {
  // Update all unsettled payments for this merchant
  const result = await prisma.payment.updateMany({
    where: {
      merchant,
      token,
      settled: false,
    },
    data: {
      settled: true,
      settlementTxHash: txHash,
      settledAt: new Date(),
      batchId,
    },
  });
  
  console.log(`   ✅ Database updated: ${result.count} payment(s) marked as settled`);
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

/**
 * Main consumer loop.
 * 
 * Reads from the "intent-hit" stream and executes batch settlements.
 */
export async function startBatchExecutor(): Promise<void> {
  console.log('🚀 Starting batch executor consumer...');
  console.log(`   Consumer name: ${CONSUMER_NAME}`);
  console.log(`   Consumer group: ${CONSUMER_GROUP}`);
  console.log(`   Signer address: ${wallet.address}`);

  // Create consumer group if it doesn't exist
  await createConsumerGroup(STREAMS.INTENT_HIT, CONSUMER_GROUP);

  // Start consuming
  while (true) {
    try {
      // Read messages from the "intent-hit" stream
      const messages = await readStream(
        STREAMS.INTENT_HIT,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        '>', // Only new messages
        5    // Smaller batch size (settlements are slower)
      );

      // Process each message
      for (const message of messages) {
        try {
          // Execute the batch settlement
          await executeBatchSettlement(message.data);

          // Acknowledge the message
          await ackMessage(STREAMS.INTENT_HIT, CONSUMER_GROUP, message.id);
        } catch (error) {
          console.error(`Failed to process settlement ${message.id}:`, error);
          // Don't ack - message stays in pending for retry
          
          // Add exponential backoff to avoid hammering the blockchain
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      // readStream blocks for up to 5 seconds if no messages
    } catch (error) {
      console.error('Error in consumer loop:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

export async function stopBatchExecutor(): Promise<void> {
  console.log('🛑 Stopping batch executor...');
  // In production, wait for current transactions to complete
}

process.on('SIGTERM', stopBatchExecutor);
process.on('SIGINT', stopBatchExecutor);