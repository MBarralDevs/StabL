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
  const { merchant, token, amount, paymentId, transactionHash } = paymentData;

  console.log(`📦 Processing payment ${paymentId} for merchant ${merchant}`);

  // ─── Step 1: Credit merchant via Yellow Network ─────────────────────────

  /**
   * Yellow Network provides instant off-chain credit to the merchant.
   * This happens via state channels, so the merchant can use the funds
   * immediately even though on-chain settlement hasn't happened yet.
   * 
   * TODO: Implement Yellow Network integration
   * For now, we'll mock this step.
   */
  try {
    console.log(`  💳 Crediting merchant via Yellow...`);
    
    // Mock Yellow credit (replace with actual Yellow SDK call)
    await mockYellowCredit({
      merchant,
      amount,
      token,
      paymentId,
    });

    console.log(`  ✅ Merchant credited via Yellow`);
  } catch (error) {
    console.error(`  ❌ Failed to credit via Yellow:`, error);
    throw error; // Rethrow so the message stays in Redis pending
  }

  // ─── Step 2: Write to database ──────────────────────────────────────────

  /**
   * Store the payment in PostgreSQL for audit trail and reporting.
   * 
   * TODO: Implement Prisma database write
   * For now, we'll mock this step.
   */
  try {
    console.log(`  💾 Writing payment to database...`);
    
    // Mock database write (replace with actual Prisma call)
    await mockDatabaseWrite({
      paymentId,
      merchant,
      token,
      amount,
      transactionHash,
      status: 'credited',
      createdAt: new Date(),
    });

    console.log(`  ✅ Payment written to database`);
  } catch (error) {
    console.error(`  ❌ Failed to write to database:`, error);
    throw error; // Rethrow so the message stays in Redis pending
  }

  // ─── Step 3: Publish to "credited" stream ───────────────────────────────

  /**
   * Notify downstream consumers that this payment has been credited.
   * The intent matcher will listen to this stream to check if any
   * merchant's settlement threshold has been hit.
   */
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
 * Mock Yellow Network credit operation.
 * 
 * TODO: Replace with actual Yellow SDK integration:
 * 
 * import { YellowClient } from '@yellow-network/sdk';
 * const yellow = new YellowClient({ ... });
 * await yellow.credit({ merchant, amount, asset: token });
 */
async function mockYellowCredit(data: any): Promise<void> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // In production, this would call Yellow's API
  console.log(`    [MOCK] Yellow credit:`, {
    merchant: data.merchant,
    amount: ethers.formatUnits(data.amount, 6), // USDC has 6 decimals
  });
}

/**
 * Mock database write operation.
 * 
 * TODO: Replace with actual Prisma call:
 * 
 * import { prisma } from '../config/database.js';
 * await prisma.payment.create({ data });
 */
async function mockDatabaseWrite(data: any): Promise<void> {
  // Simulate database write delay
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // In production, this would be a Prisma call
  console.log(`    [MOCK] Database write:`, {
    paymentId: data.paymentId,
    merchant: data.merchant,
  });
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