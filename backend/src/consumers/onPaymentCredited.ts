// src/consumers/onPaymentCredited.ts

/**
 * Payment Credited Consumer
 * 
 * After a merchant is credited via Yellow, this consumer checks
 * if their settlement intent threshold has been hit.
 * 
 * Flow:
 * 1. Read merchant's intent from IntentVault contract
 * 2. Check merchant's current balance from PaymentPool contract
 * 3. Evaluate if settlement should happen based on intent type:
 *    - IMMEDIATE: Always settle
 *    - STANDARD: Settle if maxWaitTimeSeconds has passed
 *    - DEFERRED: Settle if balance >= minBatchAmount
 * 4. If threshold hit, publish to "batch-ready" stream
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
  IntentVaultABI_Interface,
  PAYMENT_POOL_ADDRESS,
  INTENT_VAULT_ADDRESS,
} from '../config/contracts.js';

// ─── Contract Setup ──────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(env.ARC_RPC_URL);

const paymentPool = new ethers.Contract(
  PAYMENT_POOL_ADDRESS,
  PaymentPoolABI_Interface,
  provider
);

const intentVault = new ethers.Contract(
  INTENT_VAULT_ADDRESS,
  IntentVaultABI_Interface,
  provider
);

// ─── Consumer Configuration ──────────────────────────────────────────────────

const CONSUMER_GROUP = 'intent-checkers';
const CONSUMER_NAME = `intent-checker-${process.pid}`;

// ─── Intent Types (from IntentVault.sol) ─────────────────────────────────────

enum SettlementSpeed {
  IMMEDIATE = 0,
  STANDARD = 1,
  DEFERRED = 2,
}

interface MerchantIntent {
  speed: SettlementSpeed;
  minBatchAmount: bigint;
  maxWaitTimeSeconds: bigint;
  targetToken: string;
  exists: boolean;
}

// ─── Consumer Logic ──────────────────────────────────────────────────────────

/**
 * Check if a merchant's intent threshold has been hit.
 * 
 * @param creditedData - Payment credited event data
 */
async function checkIntent(creditedData: any): Promise<void> {
  const { merchant, token, amount, paymentId, creditedAt } = creditedData;

  console.log(`🔍 Checking intent for merchant ${merchant}`);

  // ─── Step 1: Get merchant's intent from IntentVault ─────────────────────

  let intent: MerchantIntent;
  
  try {
    const result = await intentVault.getIntent(merchant);
    
    intent = {
      speed: Number(result.speed),
      minBatchAmount: result.minBatchAmount,
      maxWaitTimeSeconds: result.maxWaitTimeSeconds,
      targetToken: result.targetToken,
      exists: result.exists,
    };

    console.log(`  📋 Intent retrieved:`, {
      speed: SettlementSpeed[intent.speed],
      minBatchAmount: ethers.formatUnits(intent.minBatchAmount, 6),
      maxWaitTimeSeconds: intent.maxWaitTimeSeconds.toString(),
    });
  } catch (error) {
    console.error(`  ❌ Failed to get intent for merchant ${merchant}:`, error);
    throw error;
  }

  // If merchant has no intent set, skip
  if (!intent.exists) {
    console.log(`  ⏭️  Merchant has no intent set, skipping`);
    return;
  }

  // ─── Step 2: Get merchant's current balance ─────────────────────────────

  let balance: bigint;
  
  try {
    balance = await paymentPool.getMerchantBalance(merchant, token);
    
    console.log(`  💰 Current balance: ${ethers.formatUnits(balance, 6)} USDC`);
  } catch (error) {
    console.error(`  ❌ Failed to get balance for merchant ${merchant}:`, error);
    throw error;
  }

  // ─── Step 3: Check if settlement threshold is hit ───────────────────────

  let shouldSettle = false;
  let reason = '';

  switch (intent.speed) {
    case SettlementSpeed.IMMEDIATE:
      // Always settle immediately
      shouldSettle = true;
      reason = 'IMMEDIATE intent';
      break;

    case SettlementSpeed.STANDARD:
      // Settle if max wait time has passed
      // TODO: In production, track first payment timestamp in database
      // For now, we'll use a mock check
      shouldSettle = await mockCheckWaitTime(merchant, intent.maxWaitTimeSeconds);
      reason = shouldSettle 
        ? `maxWaitTimeSeconds (${intent.maxWaitTimeSeconds}s) exceeded`
        : 'waiting for maxWaitTimeSeconds';
      break;

    case SettlementSpeed.DEFERRED:
      // Settle if balance >= minBatchAmount
      shouldSettle = balance >= intent.minBatchAmount;
      reason = shouldSettle
        ? `balance (${ethers.formatUnits(balance, 6)}) >= minBatchAmount (${ethers.formatUnits(intent.minBatchAmount, 6)})`
        : `balance (${ethers.formatUnits(balance, 6)}) < minBatchAmount (${ethers.formatUnits(intent.minBatchAmount, 6)})`;
      break;
  }

  console.log(`  ${shouldSettle ? '✅' : '⏸️ '} Settlement decision: ${shouldSettle ? 'SETTLE' : 'WAIT'}`);
  console.log(`     Reason: ${reason}`);

  // ─── Step 4: If threshold hit, publish to batch-ready stream ────────────

  if (shouldSettle) {
    await publishEvent(STREAMS.INTENT_HIT, {
      merchant,
      token,
      balance: balance.toString(),
      intent: {
        speed: SettlementSpeed[intent.speed],
        targetToken: intent.targetToken,
      },
      timestamp: Date.now(),
    });

    console.log(`  ✅ Published to ${STREAMS.INTENT_HIT} stream`);
  }

  console.log(`✅ Intent check complete for merchant ${merchant}`);
}

// ─── Mock Functions ──────────────────────────────────────────────────────────

/**
 * Mock function to check if maxWaitTimeSeconds has been exceeded.
 * 
 * TODO: Replace with actual database query:
 * 
 * const firstPayment = await prisma.payment.findFirst({
 *   where: { merchant, settled: false },
 *   orderBy: { createdAt: 'asc' }
 * });
 * 
 * const waitedSeconds = (Date.now() - firstPayment.createdAt.getTime()) / 1000;
 * return waitedSeconds >= maxWaitTimeSeconds;
 */
async function mockCheckWaitTime(
  merchant: string, 
  maxWaitTimeSeconds: bigint
): Promise<boolean> {
  // For testing purposes, let's say STANDARD intents always trigger
  // In production, you'd query the database for the first unsettled payment
  console.log(`    [MOCK] Checking wait time for merchant ${merchant}`);
  console.log(`    [MOCK] maxWaitTimeSeconds: ${maxWaitTimeSeconds}`);
  
  // Mock: assume wait time has passed (for testing the flow)
  // In production, this would be a real database query
  return true;
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

/**
 * Main consumer loop.
 * 
 * Reads from the "credited" stream and checks each merchant's intent.
 */
export async function startIntentChecker(): Promise<void> {
  console.log('🚀 Starting intent checker consumer...');
  console.log(`   Consumer name: ${CONSUMER_NAME}`);
  console.log(`   Consumer group: ${CONSUMER_GROUP}`);

  // Create consumer group if it doesn't exist
  await createConsumerGroup(STREAMS.CREDITED, CONSUMER_GROUP);

  // Start consuming
  while (true) {
    try {
      // Read messages from the "credited" stream
      const messages = await readStream(
        STREAMS.CREDITED,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        '>', // Only new messages
        10   // Batch size
      );

      // Process each message
      for (const message of messages) {
        try {
          // Check the merchant's intent
          await checkIntent(message.data);

          // Acknowledge the message
          await ackMessage(STREAMS.CREDITED, CONSUMER_GROUP, message.id);
        } catch (error) {
          console.error(`Failed to process message ${message.id}:`, error);
          // Don't ack - message stays in pending
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

export async function stopIntentChecker(): Promise<void> {
  console.log('🛑 Stopping intent checker...');
  // In production, wait for current processing to complete
}

process.on('SIGTERM', stopIntentChecker);
process.on('SIGINT', stopIntentChecker);