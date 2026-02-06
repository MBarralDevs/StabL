// src/listeners/arcEventListener.ts

/**
 * Arc Event Listener
 * 
 * Listens to PaymentReceived events from the PaymentPool contract on Arc.
 * When a payment is detected, it publishes the event to Redis Streams
 * so consumers can process it (credit Yellow, write to DB, etc.).
 * 
 * This uses WebSocket (WSS) for persistent connection to Arc, which is
 * more efficient than polling.
 */

import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { 
  PaymentPoolABI_Interface, 
  PAYMENT_POOL_ADDRESS 
} from '../config/contracts.js';
import { publishEvent, STREAMS } from '../config/redis.js';

// ─── WebSocket Provider ──────────────────────────────────────────────────────

/**
 * Create a WebSocket provider for Arc.
 * 
 * WebSocket is better than HTTP for event listening because:
 * - It's a persistent connection (no need to poll)
 * - Events arrive in real-time
 * - Lower latency
 */
const provider = new ethers.WebSocketProvider(env.ARC_WSS_URL);

// ─── Contract Instance ───────────────────────────────────────────────────────

/**
 * Create a contract instance for PaymentPool.
 * This lets us listen to its events.
 */
const paymentPool = new ethers.Contract(
  PAYMENT_POOL_ADDRESS,
  PaymentPoolABI_Interface,
  provider
);

// ─── Event Listener ──────────────────────────────────────────────────────────

/**
 * Start listening for PaymentReceived events.
 * 
 * When an event is detected:
 * 1. Extract the event data (merchant, token, amount, paymentId)
 * 2. Publish to Redis Streams
 * 3. Log for monitoring
 */
export async function startArcEventListener(): Promise<void> {
  console.log('🎧 Starting Arc event listener...');
  console.log(`   Watching PaymentPool at ${PAYMENT_POOL_ADDRESS}`);

  // Listen for PaymentReceived events
  // Event signature: PaymentReceived(address indexed merchant, address indexed token, uint256 amount, bytes32 paymentId)
  paymentPool.on(
  'PaymentReceived',
  async (merchant, payer, token, amount, paymentId, event) => {  // ← Added 'payer' parameter
    try {
      const eventData = {
        merchant,
        token,
        amount: amount.toString(),
        paymentId: paymentId.toString(),              // ← Convert bytes32 to string
        blockNumber: event.blockNumber,               // ✅ Fixed
        transactionHash: event.transactionHash,       // ✅ Fixed
        timestamp: Date.now(),
      };

        console.log('💰 PaymentReceived event detected:', {
          merchant,
          token,
          amount: ethers.formatUnits(amount, 6), // USDC has 6 decimals
          paymentId,
          txHash: event.log.transactionHash,
        });

        // Publish to Redis Stream
        await publishEvent(STREAMS.PAYMENTS, eventData);

        console.log(`✅ Event published to ${STREAMS.PAYMENTS} stream`);
      } catch (error) {
        console.error('❌ Error processing PaymentReceived event:', error);
        // Don't throw - we don't want one bad event to crash the listener
      }
    }
  );

  // ─── Connection Error Handling ───────────────────────────────────────────

  /**
   * Handle WebSocket connection errors.
   * 
   * The ethers.js WebSocketProvider automatically reconnects,
   * but we log errors for monitoring.
   */
  provider.on('error', (error) => {
    console.error('❌ WebSocket provider error:', error);
  });

  /**
   * Log when the WebSocket connection is established.
   */
  provider.on('network', (newNetwork, oldNetwork) => {
    if (oldNetwork) {
      console.log('🔄 Network changed:', {
        from: oldNetwork.chainId,
        to: newNetwork.chainId,
      });
    } else {
      console.log('✅ Connected to Arc network:', newNetwork.chainId);
    }
  });

  console.log('✅ Arc event listener started successfully');
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * Stop listening and close the WebSocket connection.
 * Call this when the app is shutting down.
 */
export async function stopArcEventListener(): Promise<void> {
  console.log('🛑 Stopping Arc event listener...');
  
  // Remove all listeners
  paymentPool.removeAllListeners('PaymentReceived');
  
  // Close the WebSocket connection
  await provider.destroy();
  
  console.log('✅ Arc event listener stopped');
}