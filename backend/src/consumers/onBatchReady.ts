// src/consumers/onBatchReady.ts

/**
 * Batch Ready Consumer
 * 
 * When a merchant's intent threshold is hit, this consumer executes
 * the on-chain batch settlement via the BatchSettler contract.
 * 
 * Settlement routing:
 * - Same-token (USDC→USDC): BatchSettler direct transfer from PaymentPool
 * - Cross-token on Arc (USDC→EURC): BatchSettler routes through Uniswap V4 Hook
 * - Cross-chain non-USDC (fallback): Li.Fi SDK for routing quotes
 * 
 * Flow:
 * 1. Read from "intent-hit" stream
 * 2. Verify on-chain balance
 * 3. Call BatchSettler.executeBatch() on-chain
 * 4. Update database (mark payments as settled)
 * 5. Acknowledge message
 */

import { ethers } from 'ethers';
import {
  readStream,
  ackMessage,
  STREAMS,
  createConsumerGroup,
} from '../config/redis.js';
import { env } from '../config/env.js';
import {
  PaymentPoolABI_Interface,
  BatchSettlerABI_Interface,
  PAYMENT_POOL_ADDRESS,
  BATCH_SETTLER_ADDRESS,
} from '../config/contracts.js';
import { prisma } from '../services/database.js';

// ─── Contract Setup ──────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(env.ARC_RPC_URL);
const wallet = new ethers.Wallet(env.DEPLOYER_PRIVATE_KEY, provider);

const paymentPool = new ethers.Contract(
  PAYMENT_POOL_ADDRESS,
  PaymentPoolABI_Interface,
  provider
);

const batchSettler = new ethers.Contract(
  BATCH_SETTLER_ADDRESS,
  BatchSettlerABI_Interface,
  wallet
);

// ─── Consumer Configuration ──────────────────────────────────────────────────

const CONSUMER_GROUP = 'batch-executors';
const CONSUMER_NAME = `batch-executor-${process.pid}`;

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Settlement Logic ────────────────────────────────────────────────────────

/**
 * Execute a batch settlement on-chain.
 * 
 * The BatchSettler contract handles routing:
 * - Same-token: direct PaymentPool.withdraw() to merchant
 * - Cross-token: routes through Uniswap V4 pool with PaymentSettlementHook
 *   (dynamic batch-size-dependent fees, atomic swap + settlement)
 */
export async function executeBatchSettlement(request: SettlementRequest): Promise<void> {
  const { merchant, token, balance, intent } = request;

  console.log(`⚙️  Executing batch settlement for merchant ${merchant}`);
  console.log(`   Token: ${token}`);
  console.log(`   Balance: ${ethers.formatUnits(balance, 6)}`);
  console.log(`   Target token: ${intent.targetToken}`);

  // ─── Step 1: Verify balance on-chain ─────────────────────────────────────

  let actualBalance: bigint;

  try {
    actualBalance = await paymentPool.getMerchantBalance(merchant, token);
    console.log(`   ✅ Verified on-chain balance: ${ethers.formatUnits(actualBalance, 6)}`);

    if (actualBalance === 0n) {
      console.log(`   ⚠️  Balance is zero, skipping settlement`);
      return;
    }
  } catch (error) {
    console.error(`   ❌ Failed to verify balance:`, error);
    throw error;
  }

  // ─── Step 2: Calculate expected fee ──────────────────────────────────────

  let feeBasisPoints: bigint;

  try {
    feeBasisPoints = await batchSettler.feeBasisPoints();
  } catch {
    console.log(`   ⚠️  Could not read fee config, assuming 0`);
    feeBasisPoints = 0n;
  }

  const fee = feeBasisPoints > 0n ? (actualBalance * feeBasisPoints) / 10000n : 0n;
  const netAmount = actualBalance - fee;

  console.log(`   💰 Gross: ${ethers.formatUnits(actualBalance, 6)} | Fee: ${ethers.formatUnits(fee, 6)} | Net: ${ethers.formatUnits(netAmount, 6)}`);

  // ─── Step 3: Prepare and execute batch ───────────────────────────────────

  // Determine if this is same-token or cross-token
  const isCrossToken = intent.targetToken.toLowerCase() !== token.toLowerCase()
    && intent.targetToken !== ethers.ZeroAddress;

  const settlements = [{
    merchant,
    token,
    amount: actualBalance,
    recipient: merchant,
    outputToken: isCrossToken ? intent.targetToken : token,
  }];

  const batchId = ethers.id(`batch-${merchant}-${Date.now()}`);

  console.log(`   📦 Batch ID: ${batchId.slice(0, 10)}...`);
  console.log(`   📦 Type: ${isCrossToken ? 'cross-token (V4 Hook)' : 'same-token (direct)'}`);

  // ─── Step 3.5: Dry-run validation ────────────────────────────────────────

  try {
    const [valid, errorIndex, reason] = await batchSettler.validateBatch(settlements);
    if (!valid) {
      const reasonStr = reason.toString();

      if (reasonStr.includes('no intent') || reasonStr.includes('NoIntent')) {
        console.log(`   ⚠️  Merchant has no on-chain intent — settlement deferred`);
        console.log(`   ℹ️  Funds safe in PaymentPool (${ethers.formatUnits(balance, 6)} USDC)`);
        console.log(`   ℹ️  Merchant must call IntentVault.setIntent() to enable settlement`);
        return;
      }

      console.error(`   ❌ Batch validation failed at index ${errorIndex}: ${reason}`);
      return;
    }
    console.log(`   ✅ Batch pre-validated`);
  } catch {
    console.log(`   ⚠️  Validation unavailable, proceeding`);
  }

  // ─── Step 4: Execute on-chain ────────────────────────────────────────────

  let tx: ethers.TransactionResponse;

  try {
    console.log(`   📤 Sending executeBatch transaction...`);
    tx = await batchSettler.executeBatch(batchId, settlements, 0);
    console.log(`   ⏳ Tx sent: ${tx.hash}`);

    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      throw new Error(`Transaction reverted: ${tx.hash}`);
    }

    console.log(`   ✅ Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);
  } catch (error: any) {
    console.error(`   ❌ executeBatch failed: ${error.message}`);

    // Parse custom errors
    if (error.data) {
      try {
        const iface = new ethers.Interface(BatchSettlerABI_Interface);
        const decoded = iface.parseError(error.data);
        if (decoded) {
          console.error(`      Contract error: ${decoded.name}`, decoded.args);
        }
      } catch {}
    }

    throw error;
  }

  // ─── Step 5: Update database ─────────────────────────────────────────────

  try {
    const result = await prisma.payment.updateMany({
      where: { merchant, token, settled: false },
      data: {
        settled: true,
        settlementTxHash: tx.hash,
        settledAt: new Date(),
        batchId,
        settlementAmount: netAmount.toString(),
        settlementFee: fee.toString(),
      },
    });

    console.log(`   ✅ ${result.count} payment(s) marked as settled`);
  } catch (error) {
    console.error(`   ❌ DB update failed (settlement succeeded on-chain):`, error);
    // Don't throw — on-chain settlement is done, DB can be retried
  }

  console.log(`✅ Settlement complete for ${merchant}`);
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

export async function startBatchExecutor(): Promise<void> {
  console.log('🚀 Starting batch executor consumer...');
  console.log(`   Consumer name: ${CONSUMER_NAME}`);
  console.log(`   Consumer group: ${CONSUMER_GROUP}`);
  console.log(`   Signer address: ${wallet.address}`);

  await createConsumerGroup(STREAMS.INTENT_HIT, CONSUMER_GROUP);

  while (!shouldStop) {
    try {
      const messages = await readStream(
        STREAMS.INTENT_HIT,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        '>',
        5
      );

      for (const message of messages) {
        try {
          await executeBatchSettlement(message.data);
          await ackMessage(STREAMS.INTENT_HIT, CONSUMER_GROUP, message.id);
        } catch (error) {
          console.error(`Failed to process settlement ${message.id}:`, error);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    } catch (error) {
      console.error('Error in consumer loop:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

let shouldStop = false;

export async function stopBatchExecutor(): Promise<void> {
  console.log('🛑 Stopping batch executor...');
  shouldStop = true;
}