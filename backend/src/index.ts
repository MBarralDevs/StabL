// src/index.ts

/**
 * StabL Gateway - Main Entry Point
 * 
 * Orchestrates all backend services:
 * - Arc blockchain event listener (WebSocket)
 * - Payment processing consumer (Redis Streams)
 * - Intent checking consumer (Redis Streams)
 * - Batch execution consumer (Redis Streams)
 * 
 * Run with: npm run dev
 */

import express from 'express';
import { validateEnv, env } from './config/env.js';
import { redis, closeRedis, STREAMS, createConsumerGroup } from './config/redis.js';
import { startArcEventListener, stopArcEventListener } from './listeners/arcEventListener.js';
import { startPaymentConsumer, stopPaymentConsumer } from './consumers/onPaymentReceived.js';
import { startIntentChecker, stopIntentChecker } from './consumers/onPaymentCredited.js';
import { startBatchExecutor, stopBatchExecutor } from './consumers/onBatchReady.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// ─── Express App (for health checks and future API endpoints) ───────────────

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      redis: redis.status === 'ready' ? 'connected' : 'disconnected',
      arcListener: 'running', // Could add more granular status
      consumers: {
        paymentProcessor: 'running',
        intentChecker: 'running',
        batchExecutor: 'running',
      },
    },
  });
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    name: 'StabL Gateway',
    version: '1.0.0',
    description: 'Universal stablecoin payment gateway with intent-based settlement',
  });
});

// ─── Service Registry ────────────────────────────────────────────────────────

interface Service {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const services: Service[] = [];

// ─── Initialization ──────────────────────────────────────────────────────────

async function initialize(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                                                          ║');
  console.log('║              StabL Gateway - Backend                     ║');
  console.log('║   Universal Stablecoin Payment Processing System         ║');
  console.log('║                                                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // ─── Step 1: Validate environment ────────────────────────────────────────

  console.log('📋 Step 1/5: Validating environment...');
  try {
    validateEnv();
    console.log('   ✅ All required environment variables present');
    console.log('');
  } catch (error: any) {
    console.error('   ❌ Environment validation failed:');
    console.error(`   ${error.message}`);
    console.error('');
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }

  // ─── Step 2: Test Redis connection ───────────────────────────────────────

  console.log('📋 Step 2/5: Connecting to Redis...');
  try {
    await redis.ping();
    console.log('   ✅ Redis connection established');
    console.log(`   📍 Connected to: ${env.REDIS_URL}`);
    console.log('');
  } catch (error: any) {
    console.error('   ❌ Redis connection failed:');
    console.error(`   ${error.message}`);
    console.error('');
    console.error('Please ensure Redis is running and accessible.');
    process.exit(1);
  }

  // ─── Step 3: Initialize Redis Streams ────────────────────────────────────

  console.log('📋 Step 3/5: Initializing Redis Streams...');
  try {
    // Create consumer groups for each stream
    await createConsumerGroup(STREAMS.PAYMENTS, 'payment-processors');
    console.log(`   ✅ Consumer group created: payment-processors (${STREAMS.PAYMENTS})`);

    await createConsumerGroup(STREAMS.CREDITED, 'intent-checkers');
    console.log(`   ✅ Consumer group created: intent-checkers (${STREAMS.CREDITED})`);

    await createConsumerGroup(STREAMS.INTENT_HIT, 'batch-executors');
    console.log(`   ✅ Consumer group created: batch-executors (${STREAMS.INTENT_HIT})`);

    console.log('   ✅ All Redis Streams initialized');
    console.log('');
  } catch (error: any) {
    console.error('   ❌ Failed to initialize Redis Streams:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }

  // ─── Step 4: Display contract addresses ──────────────────────────────────

  console.log('📋 Step 4/5: Contract configuration...');
  console.log(`   📍 Chain: Arc Testnet (${5042002})`);
  console.log(`   📍 RPC: ${env.ARC_RPC_URL}`);
  console.log(`   📍 PaymentPool: ${env.PAYMENT_POOL_ADDRESS}`);
  console.log(`   📍 IntentVault: ${env.INTENT_VAULT_ADDRESS}`);
  console.log(`   📍 BatchSettler: ${env.BATCH_SETTLER_ADDRESS}`);
  console.log('');

  // ─── Step 5: Start services ──────────────────────────────────────────────

  console.log('📋 Step 5/5: Starting services...');
  console.log('');

  // Start Arc event listener
  console.log('🎧 Starting Arc blockchain listener...');
  await startArcEventListener();
  services.push({
    name: 'Arc Event Listener',
    start: startArcEventListener,
    stop: stopArcEventListener,
  });
  console.log('   ✅ Arc listener active');
  console.log('');

  // Start payment processor consumer
  console.log('⚙️  Starting payment processor consumer...');
  startPaymentConsumer().catch((error: any) => {
    console.error('Payment processor crashed:', error);
    process.exit(1);
  });
  services.push({
    name: 'Payment Processor',
    start: startPaymentConsumer,
    stop: stopPaymentConsumer,
  });
  console.log('   ✅ Payment processor active');
  console.log('');

  // Start intent checker consumer
  console.log('⚙️  Starting intent checker consumer...');
  startIntentChecker().catch((error) => {
    console.error('Intent checker crashed:', error);
    process.exit(1);
  });
  services.push({
    name: 'Intent Checker',
    start: startIntentChecker,
    stop: stopIntentChecker,
  });
  console.log('   ✅ Intent checker active');
  console.log('');

  // Start batch executor consumer
  console.log('⚙️  Starting batch executor consumer...');
  startBatchExecutor().catch((error) => {
    console.error('Batch executor crashed:', error);
    process.exit(1);
  });
  services.push({
    name: 'Batch Executor',
    start: startBatchExecutor,
    stop: stopBatchExecutor,
  });
  console.log('   ✅ Batch executor active');
  console.log('');

  // ─── Start HTTP server ───────────────────────────────────────────────────

  const server = app.listen(PORT, () => {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                                                          ║');
    console.log('║              🚀 StabL Gateway is RUNNING! 🚀              ║');
    console.log('║                                                          ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📡 HTTP Server listening on port ${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   Version info: http://localhost:${PORT}/version`);
    console.log('');
    console.log('🎯 Watching for PaymentReceived events on Arc blockchain...');
    console.log('');
    console.log('💡 Press Ctrl+C to shut down gracefully');
    console.log('');
  });

  // Store server reference for shutdown
  services.push({
    name: 'HTTP Server',
    start: async () => {},
    stop: async () => {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  });
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                                                          ║');
  console.log(`║              Received ${signal.padEnd(6)} - Shutting down...              ║`);
  console.log('║                                                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Stop services in reverse order
  for (let i = services.length - 1; i >= 0; i--) {
    const service = services[i];
    try {
      console.log(`⏳ Stopping ${service.name}...`);
      await service.stop();
      console.log(`   ✅ ${service.name} stopped`);
    } catch (error: any) {
      console.error(`   ⚠️  Error stopping ${service.name}:`, error.message);
    }
  }

  // Close Redis connection
  try {
    console.log('⏳ Closing Redis connection...');
    await closeRedis();
    console.log('   ✅ Redis connection closed');
  } catch (error: any) {
    console.error('   ⚠️  Error closing Redis:', error.message);
  }

  console.log('');
  console.log('👋 StabL Gateway shut down complete');
  console.log('');

  process.exit(0);
}

// ─── Signal Handlers ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('');
  console.error('💥 Uncaught Exception:', error);
  console.error('');
  shutdown('ERROR').then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('');
  console.error('💥 Unhandled Rejection at:', promise);
  console.error('💥 Reason:', reason);
  console.error('');
  shutdown('ERROR').then(() => process.exit(1));
});

// ─── Start the Application ───────────────────────────────────────────────────

initialize().catch((error) => {
  console.error('');
  console.error('💥 Fatal error during initialization:', error);
  console.error('');
  process.exit(1);
});