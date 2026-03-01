// src/config/redis.ts

/**
 * Redis connection and stream utilities.
 * 
 * We use Redis Streams (not pub/sub) because streams are durable:
 * - If a consumer crashes, messages aren't lost
 * - We can replay events if needed
 * - Multiple consumers can read the same stream
 * 
 * This is critical for a payment system where losing an event = losing money.
 */

import Redis from 'ioredis';

// Load Redis URL from environment
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis client
export const redis = new Redis(REDIS_URL, {
  // Reconnect automatically if connection drops
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    console.log(`Redis reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  // Log connection events
  reconnectOnError(err) {
    console.error('Redis connection error:', err.message);
    return true; // Always try to reconnect
  },
});

// Handle connection events
redis.on('connect', () => {
  console.log('✅ Redis connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});

redis.on('close', () => {
  console.warn('⚠️  Redis connection closed');
});

// ─── Stream Names ────────────────────────────────────────────────────────────

/**
 * Stream naming convention:
 * - Use descriptive names that indicate what events live there
 * - Keep them short but clear
 */
export const STREAMS = {
  PAYMENTS: 'payments',           // PaymentReceived events from Arc
  CREDITED: 'credited',           // After Yellow credit + DB write
  INTENT_HIT: 'intent-threshold', // When a merchant's intent threshold is reached
  BATCH_READY: 'batch-ready',     // When a batch is ready to execute
  CCTP_BURNS: 'cctp-burns',       // DepositForBurn events from source chains (CCTP V2)
} as const;

// ─── Stream Utilities ────────────────────────────────────────────────────────

/**
 * Publish an event to a Redis Stream.
 * 
 * @param stream - Which stream to publish to (use STREAMS constant)
 * @param data - Event payload (will be JSON-serialized)
 * @returns The message ID assigned by Redis
 */
export async function publishEvent(
  stream: string,
  data: Record<string, any>
): Promise<string> {
  try {
    // Redis Streams use field-value pairs. We serialize the data to JSON
    // and store it in a single "payload" field.
    const messageId = await redis.xadd(
      stream,
      '*', // Auto-generate ID (timestamp-based)
      'payload',
      JSON.stringify(data)
    );

    if (!messageId) {
      throw new Error('Failed to publish event: Redis returned null');
    }

    console.log(`📤 Published to ${stream}:`, messageId);
    return messageId;
  } catch (error) {
    console.error(`Failed to publish to ${stream}:`, error);
    throw error;
  }
}

/**
 * Read events from a Redis Stream.
 * 
 * This is used by consumers. It blocks until new messages arrive.
 * 
 * @param stream - Which stream to read from
 * @param consumerGroup - Name of the consumer group (for load balancing)
 * @param consumerName - Name of this specific consumer instance
 * @param lastId - Start reading from this ID (use '>' for only new messages)
 * @param count - Max number of messages to read at once
 * @returns Array of messages
 */
export async function readStream(
  stream: string,
  consumerGroup: string,
  consumerName: string,
  lastId: string = '>',
  count: number = 10
): Promise<Array<{ id: string; data: any }>> {
  try {
    // XREADGROUP is the Redis command for reading as part of a consumer group
    // Consumer groups allow multiple workers to process events in parallel
    const result = await redis.xreadgroup(
      'GROUP',
      consumerGroup,
      consumerName,
      'COUNT',
      count,
      'BLOCK',
      5000, // Block for up to 5 seconds waiting for new messages
      'STREAMS',
      stream,
      lastId
    );

    if (!result || result.length === 0) {
      return [];
    }

    // Parse the Redis response format
    const [, messages] = result[0] as [string, [string, string[]][]];
    return messages.map(([id, fields]: [string, string[]]) => {
      // fields is ['payload', '{"data":"..."}']
      const payload = fields[1]; // The JSON string
      return {
        id,
        data: JSON.parse(payload),
      };
    });
  } catch (error) {
    console.error(`Failed to read from ${stream}:`, error);
    throw error;
  }
}

/**
 * Create a consumer group for a stream.
 * 
 * Consumer groups allow multiple workers to share the workload.
 * Each message is delivered to only ONE consumer in the group.
 * 
 * This is idempotent — won't fail if the group already exists.
 * 
 * @param stream - Which stream to create the group for
 * @param groupName - Name of the consumer group
 */
export async function createConsumerGroup(
  stream: string,
  groupName: string
): Promise<void> {
  try {
    // Create consumer group with MKSTREAM flag
    // MKSTREAM creates the stream if it doesn't exist
    // '$' means "start from the END" (only future messages)
    await redis.xgroup('CREATE', stream, groupName, '$', 'MKSTREAM');

    console.log(`✅ Consumer group "${groupName}" created for stream "${stream}"`);
  } catch (error: any) {
    // BUSYGROUP means the group already exists — that's fine
    if (error.message && error.message.includes('BUSYGROUP')) {
      console.log(`ℹ️  Consumer group "${groupName}" already exists for "${stream}"`);
    } else {
      console.error(`Failed to create consumer group:`, error);
      throw error;
    }
  }
}

/**
 * Acknowledge that a message has been processed.
 * 
 * This removes it from the consumer group's pending list.
 * Critical for ensuring messages aren't processed twice.
 * 
 * @param stream - Which stream the message came from
 * @param group - Which consumer group
 * @param messageId - The message ID to acknowledge
 */
export async function ackMessage(
  stream: string,
  group: string,
  messageId: string
): Promise<void> {
  try {
    await redis.xack(stream, group, messageId);
  } catch (error) {
    console.error(`Failed to ack message ${messageId}:`, error);
    throw error;
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * Close Redis connection gracefully.
 * Call this when the app is shutting down.
 */
export async function closeRedis(): Promise<void> {
  console.log('Closing Redis connection...');
  await redis.quit();
  console.log('✅ Redis connection closed');
}