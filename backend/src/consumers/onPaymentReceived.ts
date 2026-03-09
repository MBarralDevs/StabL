// src/consumers/onPaymentReceived.ts

/**
 * Payment Received Consumer
 * 
 * Reads from the Redis "payments" stream and processes each payment:
 * 1. Check for duplicate payment (idempotency)
 * 2. Write payment record to PostgreSQL database
 * 3. Publish to "credited" stream for downstream processing
 * 
 * This is the first stage in the payment processing pipeline.
 * Payments arrive here from two sources:
 * - arcEventListener (local Arc payments via PaymentPool)
 * - cctpRelayer (cross-chain USDC via CCTP V2)
 */

import {
  readStream,
  ackMessage,
  publishEvent,
  STREAMS,
  createConsumerGroup,
} from '../config/redis.js';
import { prisma } from '../services/database.js';

// ─── Consumer Configuration ──────────────────────────────────────────────────

const CONSUMER_GROUP = 'payment-processors';
const CONSUMER_NAME = `payment-processor-${process.pid}`;

// ─── Consumer Logic ──────────────────────────────────────────────────────────

/**
 * Process a single payment event.
 * 
 * With Yellow Network removed, this is now a clean two-step process:
 * 1. Persist to database (audit trail + dedup)
 * 2. Publish to downstream pipeline (intent checking → batching → settlement)
 */
export async function processPayment(paymentData: any): Promise<void> {
  const { merchant, token, amount, paymentId, blockNumber, transactionHash } = paymentData;

  console.log(`📦 Processing payment ${paymentId} for merchant ${merchant}`);

  // ─── Step 1: Check for duplicate payment ─────────────────────────────────

  const existingPayment = await prisma.payment.findUnique({
    where: { paymentId: paymentId.toString() },
  });

  if (existingPayment) {
    console.log(`  ⏭️  Payment ${paymentId} already processed, skipping`);
    return;
  }

  // ─── Step 2: Write to database ───────────────────────────────────────────

  try {
    await prisma.payment.create({
      data: {
        paymentId: paymentId.toString(),
        merchant,
        token,
        amount: amount.toString(),
        blockNumber: blockNumber ?? null,
        transactionHash: transactionHash ?? null,
        // Track origin: local Arc payment or cross-chain CCTP
        source: paymentData.source ?? 'ARC',
        sourceChain: paymentData.sourceChain ?? 'Arc',
        sourceTxHash: paymentData.sourceTxHash ?? transactionHash ?? null,
      },
    });

    console.log(`  ✅ Payment written to database`);
  } catch (error) {
    console.error(`  ❌ Failed to write to database:`, error);
    throw error;
  }

  // ─── Step 3: Publish to downstream pipeline ──────────────────────────────

  await publishEvent(STREAMS.CREDITED, {
    paymentId,
    merchant,
    token,
    amount,
    source: paymentData.source ?? 'ARC',
    recordedAt: Date.now(),
  });

  console.log(`✅ Payment ${paymentId} processed successfully`);
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

export async function startPaymentConsumer(): Promise<void> {
  console.log('🚀 Starting payment consumer...');
  console.log(`   Consumer name: ${CONSUMER_NAME}`);
  console.log(`   Consumer group: ${CONSUMER_GROUP}`);

  await createConsumerGroup(STREAMS.PAYMENTS, CONSUMER_GROUP);

  while (!shouldStop) {
    try {
      const messages = await readStream(
        STREAMS.PAYMENTS,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        '>',
        10
      );

      for (const message of messages) {
        try {
          await processPayment(message.data);
          await ackMessage(STREAMS.PAYMENTS, CONSUMER_GROUP, message.id);
        } catch (error) {
          console.error(`Failed to process message ${message.id}:`, error);
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

export async function stopPaymentConsumer(): Promise<void> {
  console.log('🛑 Stopping payment consumer...');
  shouldStop = true;
}
