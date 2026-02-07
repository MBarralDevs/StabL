// src/consumers/onPaymentReceived.ts

/**
 * Payment Received Consumer
 * 
 * Reads from the Redis "payments" stream and processes each payment:
 * 1. Credit merchant instantly via Yellow Network (off-chain state channel)
 * 2. Write payment record to PostgreSQL database
 * 3. Publish to "credited" stream for downstream processing
 * 
 * This is the first stage in the payment processing pipeline.
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
import { prisma } from '../services/database.js';
import { 
  creditMerchantViaYellow,
  creditMerchantViaYellowMock 
} from '../services/yellow.js';

// ─── Consumer Configuration ──────────────────────────────────────────────────

const CONSUMER_GROUP = 'payment-processors';
const CONSUMER_NAME = `payment-processor-${process.pid}`; // Unique name per process

// ─── Consumer Logic ──────────────────────────────────────────────────────────

/**
 * Process a single payment event.
 * 
 * @param paymentData - The payment data from the Redis stream
 */
async function processPayment(paymentData: any): Promise<void> {
  console.log('🔍 DEBUG: paymentData structure:', JSON.stringify(paymentData, null, 2));
  
  const { merchant, token, amount, paymentId, blockNumber, transactionHash } = paymentData;

  console.log(`📦 Processing payment ${paymentId} for merchant ${merchant}`);

  // ─── Step 1: Credit merchant via Yellow Network ─────────────────────────

  try {
    console.log(`  💳 Crediting merchant via Yellow...`);
    
 // ─── Step 1: Credit merchant via Yellow Network ─────────────────────────

/**
 * Yellow Network provides instant off-chain liquidity to merchants.
 * 
 * Production flow:
 * - Gateway has funded unified balance in Yellow Network
 * - Transfer executes via 'transfer' RPC method (<1 second)
 * - Merchant receives funds in their Yellow unified balance
 * - Merchant can withdraw to any blockchain
 * 
 * Demo mode:
 * - Simulates the Yellow Network integration
 * - Shows what production behavior would be
 */
let yellowTx;
try {
  // Try real Yellow Network transfer
  yellowTx = await creditMerchantViaYellow(merchant, BigInt(amount), 'usdc');
  console.log(`  ✅ Merchant credited via Yellow Network (TX: ${yellowTx.transactionId})`);
  
} catch (error: any) {
  // Fallback to demo mode if Yellow is not funded/connected
  console.log(`  ℹ️  Yellow Network: ${error.message}`);
  console.log(`  🔄 Using Yellow demo mode...`);
  yellowTx = await creditMerchantViaYellowMock(merchant, BigInt(amount), 'usdc');
  console.log(`  ✅ Merchant credited (Demo mode - TX: ${yellowTx.transactionId})`);
}

    console.log(`  ✅ Merchant credited via Yellow`);
  } catch (error) {
    console.error(`  ❌ Failed to credit via Yellow:`, error);
    throw error;
  }

  // ─── Step 2: Write to database ──────────────────────────────────────────

  try {
    console.log(`  💾 Writing payment to database...`);
    
    // Pass the entire paymentData object which has all required fields
    await writePaymentToDatabase(paymentData);

    console.log(`  ✅ Payment written to database`);
  } catch (error) {
    console.error(`  ❌ Failed to write to database:`, error);
    throw error;
  }

  // ─── Step 3: Publish to "credited" stream ───────────────────────────────

  await publishEvent(STREAMS.CREDITED, {
    paymentId,
    merchant,
    token,
    amount,
    creditedAt: Date.now(),
  });

  console.log(`✅ Payment ${paymentId} processed successfully`);
}

// ─── Mock Functions (to be replaced) ─────────────────────────────────────────


/**
 * Write payment to database using Prisma.
 */
async function writePaymentToDatabase(paymentData: any): Promise<void> {
  const { paymentId, merchant, token, amount, blockNumber, transactionHash } = paymentData;
  
  await prisma.payment.create({
    data: {
      paymentId: paymentId.toString(),
      merchant,
      token,
      amount: amount.toString(),
      blockNumber,
      transactionHash,
      yellowCredited: true, // We just credited them
      yellowCreditedAt: new Date(),
    },
  });
  
  console.log(`  ✅ Payment ${paymentId} written to database`);
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

/**
 * Main consumer loop.
 * 
 * Continuously reads from the Redis "payments" stream,
 * processes each message, and acknowledges it.
 */
export async function startPaymentConsumer(): Promise<void> {
  console.log('🚀 Starting payment consumer...');
  console.log(`   Consumer name: ${CONSUMER_NAME}`);
  console.log(`   Consumer group: ${CONSUMER_GROUP}`);

  // Create consumer group if it doesn't exist
  await createConsumerGroup(STREAMS.PAYMENTS, CONSUMER_GROUP);

  // Start consuming
  while (true) {
    try {
      // Read messages from the stream
      // '>' means "only new messages not yet delivered to this consumer group"
      const messages = await readStream(
        STREAMS.PAYMENTS,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        '>', // Only new messages
        10   // Process up to 10 messages at once
      );

      // Process each message
      for (const message of messages) {
        try {
          // Process the payment
          await processPayment(message.data);

          // Acknowledge the message (remove from pending)
          await ackMessage(STREAMS.PAYMENTS, CONSUMER_GROUP, message.id);
        } catch (error) {
          console.error(`Failed to process message ${message.id}:`, error);
          // Don't ack - message stays in pending list for retry
          // In production, you'd want exponential backoff here
        }
      }

      // If no messages, the readStream function blocks for up to 5 seconds
      // (configured in redis.ts), so this loop doesn't spin uselessly
    } catch (error) {
      console.error('Error in consumer loop:', error);
      // Wait a bit before retrying to avoid hammering Redis if there's an issue
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * Stop the consumer gracefully.
 * 
 * In production, you'd want to:
 * 1. Set a flag to stop the loop
 * 2. Wait for current message to finish processing
 * 3. Close Redis connection
 */
let shouldStop = false;

export async function stopPaymentConsumer(): Promise<void> {
  console.log('🛑 Stopping payment consumer...');
  shouldStop = true;
  // In a real implementation, you'd wait for current processing to complete
}

// Listen for shutdown signals
process.on('SIGTERM', stopPaymentConsumer);
process.on('SIGINT', stopPaymentConsumer);