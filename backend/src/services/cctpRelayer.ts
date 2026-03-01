// src/services/cctpRelayer.ts

/**
 * CCTP Relayer Service
 * 
 * The brain of the CCTP cross-chain flow. Consumes burn events from the
 * cctp-burns Redis stream and orchestrates the full relay lifecycle:
 * 
 *   DETECTED → PENDING_ATTESTATION → ATTESTED → MINTING → MINTED → PROCESSING → COMPLETED
 * 
 * For each burn:
 * 1. Poll Circle's /v2/messages API until attestation is ready
 * 2. Submit receiveMessage() on Arc's MessageTransmitterV2 → USDC minted to CCTPReceiver
 * 3. Call CCTPReceiver.processPayment() → routes USDC into PaymentPool
 * 4. Publish to STREAMS.PAYMENTS so the existing pipeline (DB → Intent → Batch → V4 Hook) picks up
 * 5. Persist transfer state in PostgreSQL for tracking and retries
 * 
 * This is a Redis Stream consumer, following the same pattern as
 * onPaymentReceived.ts, onPaymentCredited.ts, and onBatchReady.ts.
 */

import { ethers } from 'ethers';
import {
  readStream,
  ackMessage,
  publishEvent,
  STREAMS,
  createConsumerGroup,
} from '../config/redis.js';
import { env } from '../config/env.js';
import {
  ARC_CCTP,
  CCTP_RECEIVER_ADDRESS,
  CCTPReceiverABI_Interface,
  MESSAGE_TRANSMITTER_V2_ABI,
  RELAYER_CONFIG,
  getCircleApiConfig,
  bytes32ToAddress,
} from '../config/cctp.js';
import { prisma } from '../services/database.js';

// ─── Consumer Configuration ──────────────────────────────────────────────────

const CONSUMER_GROUP = 'cctp-relayers';
const CONSUMER_NAME = `cctp-relayer-${process.pid}`;

// ─── Arc Provider + Signer ───────────────────────────────────────────────────
// The relayer needs to SEND transactions on Arc (receiveMessage + processPayment),
// so we need a wallet, not just a provider.

const provider = new ethers.JsonRpcProvider(env.ARC_RPC_URL);
const wallet = new ethers.Wallet(env.DEPLOYER_PRIVATE_KEY, provider);

// ─── Contract Instances ──────────────────────────────────────────────────────

const messageTransmitter = new ethers.Contract(
  ARC_CCTP.messageTransmitterV2,
  MESSAGE_TRANSMITTER_V2_ABI,
  wallet // Needs to send transactions
);

const cctpReceiver = CCTP_RECEIVER_ADDRESS
  ? new ethers.Contract(CCTP_RECEIVER_ADDRESS, CCTPReceiverABI_Interface, wallet)
  : null;

// ─── Transfer State ──────────────────────────────────────────────────────────

type TransferStatus =
  | 'DETECTED'
  | 'PENDING_ATTESTATION'
  | 'ATTESTED'
  | 'MINTING'
  | 'MINTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

interface CCTPTransfer {
  nonce: string;
  sourceDomain: number;
  destinationDomain: number;
  burnToken: string;
  amount: string;
  depositor: string;
  mintRecipient: string;
  sourceChain: string;
  sourceTxHash: string;
  sourceBlockNumber: number;
  detectedAt: number;
  status: TransferStatus;

  // Filled during relay
  messageBytes?: string;
  attestation?: string;
  mintTxHash?: string;
  processTxHash?: string;
  error?: string;
}

// ─── Circle Attestation API ──────────────────────────────────────────────────

const circleApi = getCircleApiConfig();

/**
 * Poll Circle's /v2/messages endpoint for the attestation.
 * 
 * Circle's attestation service (Iris) signs the burn message after
 * sufficient block confirmations. For Fast Transfer (minFinalityThreshold ≤ 1000),
 * this happens at confirmed level (seconds). For Standard (2000), at finalized
 * level (minutes on Ethereum).
 * 
 * Returns { messageBytes, attestation } when ready, or null if still pending.
 */
async function pollForAttestation(
  sourceTxHash: string
): Promise<{ messageBytes: string; attestation: string } | null> {
  const url = `${circleApi.host}${circleApi.messagesV2}?transactionHash=${sourceTxHash}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // 404 = not yet indexed by Circle, retry later
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Circle API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // The /v2/messages response contains an array of messages for this tx.
    // A single depositForBurn produces one message.
    if (!data.messages || data.messages.length === 0) {
      return null; // Not yet available
    }

    const message = data.messages[0];

    // Check if attestation is ready
    // Status can be: "pending", "complete"
    if (message.status !== 'complete' || !message.attestation || message.attestation === 'PENDING') {
      return null; // Still waiting for Circle to sign
    }

    return {
      messageBytes: message.message,
      attestation: message.attestation,
    };
  } catch (error: any) {
    console.error(`   ❌ Circle API poll failed: ${error.message}`);
    return null;
  }
}

/**
 * Wait for attestation with polling and timeout.
 * 
 * Polls Circle's API at RELAYER_CONFIG.attestationPollInterval until:
 * - Attestation is returned → success
 * - RELAYER_CONFIG.attestationTimeout is reached → throws
 */
async function waitForAttestation(
  sourceTxHash: string,
  nonce: string
): Promise<{ messageBytes: string; attestation: string }> {
  const startTime = Date.now();
  let attempt = 0;

  console.log(`   ⏳ Polling for attestation (tx: ${sourceTxHash.slice(0, 10)}...)`);

  while (Date.now() - startTime < RELAYER_CONFIG.attestationTimeout) {
    attempt++;

    const result = await pollForAttestation(sourceTxHash);

    if (result) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`   ✅ Attestation received after ${elapsed}s (${attempt} polls)`);
      return result;
    }

    // Wait before next poll
    await sleep(RELAYER_CONFIG.attestationPollInterval);
  }

  throw new Error(
    `Attestation timeout after ${RELAYER_CONFIG.attestationTimeout / 1000}s ` +
    `for nonce ${nonce} (tx: ${sourceTxHash})`
  );
}

// ─── On-Chain Actions ────────────────────────────────────────────────────────

/**
 * Submit receiveMessage() to Arc's MessageTransmitterV2.
 * 
 * This triggers USDC minting on Arc. The minted USDC goes to the
 * mintRecipient specified in the original burn — our CCTPReceiver contract.
 * 
 * Returns the transaction hash.
 */
async function submitReceiveMessage(
  messageBytes: string,
  attestation: string,
  nonce: string
): Promise<string> {
  console.log(`   📤 Submitting receiveMessage() on Arc...`);

  for (let attempt = 1; attempt <= RELAYER_CONFIG.maxMintRetries; attempt++) {
    try {
      const tx = await messageTransmitter.receiveMessage(messageBytes, attestation);
      console.log(`   ⏳ Tx submitted: ${tx.hash} (waiting for confirmation...)`);

      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        throw new Error(`Transaction reverted: ${tx.hash}`);
      }

      console.log(`   ✅ USDC minted on Arc (block ${receipt.blockNumber})`);
      return tx.hash;
    } catch (error: any) {
      // Check if nonce was already used (message already received)
      if (error.message?.includes('Nonce already used') ||
          error.message?.includes('already received')) {
        console.log(`   ℹ️  Message already received (nonce ${nonce}) — skipping mint`);
        return 'ALREADY_MINTED';
      }

      if (attempt < RELAYER_CONFIG.maxMintRetries) {
        console.warn(`   ⚠️  receiveMessage attempt ${attempt} failed: ${error.message}`);
        console.warn(`   🔄 Retrying in ${RELAYER_CONFIG.retryDelay / 1000}s...`);
        await sleep(RELAYER_CONFIG.retryDelay);
      } else {
        throw new Error(`receiveMessage failed after ${attempt} attempts: ${error.message}`);
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('receiveMessage exhausted all retries');
}

/**
 * Call CCTPReceiver.processPayment() to route the minted USDC into PaymentPool.
 * 
 * Our CCTPReceiver contract holds the minted USDC until we call processPayment(),
 * which decodes the hookData (merchant address, paymentId) and deposits into
 * PaymentPool on behalf of the correct merchant.
 * 
 * Returns the transaction hash.
 */
async function callProcessPayment(
  nonce: string,
  sourceDomain: number,
  amount: string,
  depositor: string
): Promise<string> {
  if (!cctpReceiver) {
    throw new Error('CCTPReceiver contract not configured');
  }

  console.log(`   📤 Calling processPayment() on CCTPReceiver...`);

  for (let attempt = 1; attempt <= RELAYER_CONFIG.maxProcessRetries; attempt++) {
    try {
      // processPayment(uint32 sourceDomain, bytes32 nonce, uint256 amount, address depositor)
      const tx = await cctpReceiver.processPayment(
        sourceDomain,
        nonce,
        amount,
        depositor
      );

      console.log(`   ⏳ Tx submitted: ${tx.hash}`);
      const receipt = await tx.wait();

      if (!receipt || receipt.status === 0) {
        throw new Error(`Transaction reverted: ${tx.hash}`);
      }

      console.log(`   ✅ Payment routed to PaymentPool (block ${receipt.blockNumber})`);
      return tx.hash;
    } catch (error: any) {
      // Duplicate protection — already processed
      if (error.message?.includes('already processed') ||
          error.message?.includes('DuplicatePayment')) {
        console.log(`   ℹ️  Payment already processed (nonce ${nonce}) — skipping`);
        return 'ALREADY_PROCESSED';
      }

      if (attempt < RELAYER_CONFIG.maxProcessRetries) {
        console.warn(`   ⚠️  processPayment attempt ${attempt} failed: ${error.message}`);
        await sleep(RELAYER_CONFIG.retryDelay);
      } else {
        throw new Error(`processPayment failed after ${attempt} attempts: ${error.message}`);
      }
    }
  }

  throw new Error('processPayment exhausted all retries');
}

// ─── Core Relay Logic ────────────────────────────────────────────────────────

/**
 * Process a single CCTP burn event through the full relay lifecycle.
 * 
 * This is the main function that orchestrates:
 * 1. Poll for attestation
 * 2. Submit receiveMessage (mint USDC on Arc)
 * 3. Call processPayment (route into PaymentPool)
 * 4. Publish to existing payment pipeline
 * 5. Persist state to PostgreSQL
 */
async function relayCCTPTransfer(burnData: CCTPTransfer): Promise<void> {
  const { nonce, sourceTxHash, sourceChain, amount, depositor } = burnData;

  console.log(`🌉 Relaying CCTP transfer:`);
  console.log(`   Source: ${sourceChain} (domain ${burnData.sourceDomain})`);
  console.log(`   Depositor: ${depositor}`);
  console.log(`   Amount: ${ethers.formatUnits(amount, 6)} USDC`);
  console.log(`   Nonce: ${nonce}`);

  // ── Check for duplicate ──────────────────────────────────────────────────

  const existing = await prisma.cCTPTransfer.findUnique({
    where: { nonce_sourceDomain: { nonce, sourceDomain: burnData.sourceDomain } },
  });

  if (existing && existing.status === 'COMPLETED') {
    console.log(`   ⏭️  Transfer already completed — skipping`);
    return;
  }

  // ── Create or update DB record ───────────────────────────────────────────

  const dbRecord = await prisma.cCTPTransfer.upsert({
    where: { nonce_sourceDomain: { nonce, sourceDomain: burnData.sourceDomain } },
    create: {
      nonce,
      sourceDomain: burnData.sourceDomain,
      destinationDomain: burnData.destinationDomain,
      burnToken: burnData.burnToken,
      amount,
      depositor,
      mintRecipient: burnData.mintRecipient,
      sourceChain,
      sourceTxHash,
      sourceBlockNumber: burnData.sourceBlockNumber,
      status: 'PENDING_ATTESTATION',
    },
    update: {
      status: 'PENDING_ATTESTATION',
    },
  });

  try {
    // ── Step 1: Wait for attestation ─────────────────────────────────────

    const { messageBytes, attestation } = await waitForAttestation(sourceTxHash, nonce);

    await prisma.cCTPTransfer.update({
      where: { id: dbRecord.id },
      data: { status: 'ATTESTED', messageBytes, attestation },
    });

    // ── Step 2: Submit receiveMessage on Arc ─────────────────────────────

    await prisma.cCTPTransfer.update({
      where: { id: dbRecord.id },
      data: { status: 'MINTING' },
    });

    const mintTxHash = await submitReceiveMessage(messageBytes, attestation, nonce);

    await prisma.cCTPTransfer.update({
      where: { id: dbRecord.id },
      data: { status: 'MINTED', mintTxHash },
    });

    // ── Step 3: Call processPayment on CCTPReceiver ──────────────────────

    await prisma.cCTPTransfer.update({
      where: { id: dbRecord.id },
      data: { status: 'PROCESSING' },
    });

    const processTxHash = await callProcessPayment(
      nonce,
      burnData.sourceDomain,
      amount,
      depositor
    );

    // ── Step 4: Publish to existing payment pipeline ─────────────────────
    // This feeds into the same flow as local Arc payments:
    // STREAMS.PAYMENTS → onPaymentReceived → DB + Intent Check → Batch → V4 Hook

    const paymentId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'uint32', 'string'],
        [nonce, burnData.sourceDomain, sourceTxHash]
      )
    );

    await publishEvent(STREAMS.PAYMENTS, {
      merchant: bytes32ToAddress(burnData.mintRecipient), // Will be resolved by CCTPReceiver
      token: burnData.burnToken,
      amount,
      paymentId,
      blockNumber: 0, // Cross-chain, no single block
      transactionHash: processTxHash,
      timestamp: Date.now(),
      source: 'CCTP', // Tag so downstream consumers know the origin
      sourceChain,
      sourceTxHash,
    });

    console.log(`   ✅ Published to ${STREAMS.PAYMENTS} (paymentId: ${paymentId.slice(0, 10)}...)`);

    // ── Step 5: Mark as completed ────────────────────────────────────────

    await prisma.cCTPTransfer.update({
      where: { id: dbRecord.id },
      data: {
        status: 'COMPLETED',
        processTxHash,
        completedAt: new Date(),
      },
    });

    console.log(`✅ CCTP relay complete for nonce ${nonce}`);
    console.log('');

  } catch (error: any) {
    console.error(`❌ CCTP relay failed for nonce ${nonce}: ${error.message}`);

    // Persist failure for retry
    await prisma.cCTPTransfer.update({
      where: { id: dbRecord.id },
      data: {
        status: 'FAILED',
        error: error.message,
      },
    });

    // Re-throw so the consumer loop doesn't ack the message
    throw error;
  }
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

/**
 * Main consumer loop.
 * 
 * Reads from STREAMS.CCTP_BURNS and relays each transfer.
 * Follows the exact same pattern as onPaymentReceived.ts.
 */
export async function startCCTPRelayer(): Promise<void> {
  if (!CCTP_RECEIVER_ADDRESS) {
    console.warn('⚠️  CCTP relayer disabled — no CCTP_RECEIVER_ADDRESS set');
    return;
  }

  console.log('🚀 Starting CCTP relayer consumer...');
  console.log(`   Consumer name: ${CONSUMER_NAME}`);
  console.log(`   Consumer group: ${CONSUMER_GROUP}`);
  console.log(`   Signer address: ${wallet.address}`);

  // Create consumer group
  await createConsumerGroup(STREAMS.CCTP_BURNS, CONSUMER_GROUP);

  while (!shouldStop) {
    try {
      const messages = await readStream(
        STREAMS.CCTP_BURNS,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        '>',
        3 // Small batch — each relay involves multiple API calls + txs
      );

      for (const message of messages) {
        try {
          await relayCCTPTransfer(message.data);
          await ackMessage(STREAMS.CCTP_BURNS, CONSUMER_GROUP, message.id);
        } catch (error: any) {
          console.error(`Failed to relay message ${message.id}:`, error.message);
          // Don't ack — stays in pending list for retry
          // Wait before processing next to avoid hammering Circle API
          await sleep(RELAYER_CONFIG.retryDelay);
        }
      }
    } catch (error) {
      console.error('Error in CCTP relayer loop:', error);
      await sleep(5000);
    }
  }
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

let shouldStop = false;

export async function stopCCTPRelayer(): Promise<void> {
  console.log('🛑 Stopping CCTP relayer...');
  shouldStop = true;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}