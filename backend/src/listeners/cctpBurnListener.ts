// src/listeners/cctpBurnListener.ts

/**
 * CCTP Burn Listener
 * 
 * Monitors source chains (Ethereum, Base, etc.) for DepositForBurn events
 * where the mintRecipient is our CCTPReceiver contract on Arc.
 * 
 * When a burn is detected:
 * 1. Extract the event data (nonce, depositor, amount, destination domain)
 * 2. Publish to Redis Stream: STREAMS.CCTP_BURNS
 * 3. The cctp-relayer consumer picks it up from there
 * 
 * Architecture note: Unlike arcEventListener.ts which monitors ONE chain (Arc),
 * this listener monitors MULTIPLE source chains simultaneously. Each source
 * chain gets its own provider + contract instance, but all events funnel
 * into the same Redis stream.
 */

import { ethers } from 'ethers';
import { publishEvent, STREAMS } from '../config/redis.js';
import {
  getSourceChains,
  TOKEN_MESSENGER_V2_EVENTS_ABI,
  CCTP_RECEIVER_ADDRESS,
  CCTP_DOMAINS,
  addressToBytes32,
  validateCCTPConfig,
  type SourceChainConfig,
} from '../config/cctp.js';

// ─── Active Listeners ────────────────────────────────────────────────────────
// Track all active providers/contracts so we can shut them down gracefully.

interface ActiveListener {
  chainName: string;
  provider: ethers.Provider;
  contract: ethers.Contract;
}

const activeListeners: ActiveListener[] = [];

// ─── Our CCTPReceiver as bytes32 ─────────────────────────────────────────────
// Pre-compute this once since we filter every event against it.

let receiverBytes32: string;

// ─── Start Listening ─────────────────────────────────────────────────────────

/**
 * Start monitoring all configured source chains for CCTP burns
 * targeting our CCTPReceiver on Arc.
 * 
 * This function is safe to call even if no source chains are configured —
 * it will log a warning and return without doing anything.
 */
export async function startCCTPBurnListener(): Promise<void> {
  console.log('🔥 Starting CCTP burn listener...');

  // Validate config before starting
  validateCCTPConfig();

  if (!CCTP_RECEIVER_ADDRESS) {
    console.warn('   ⚠️  CCTP disabled — no CCTP_RECEIVER_ADDRESS set');
    return;
  }

  receiverBytes32 = addressToBytes32(CCTP_RECEIVER_ADDRESS);
  console.log(`   🎯 Filtering for mintRecipient: ${receiverBytes32}`);

  const sourceChains = getSourceChains();

  if (sourceChains.length === 0) {
    console.warn('   ⚠️  No source chains configured — nothing to monitor');
    return;
  }

  // Start a listener for each source chain
  for (const chain of sourceChains) {
    try {
      await startChainListener(chain);
    } catch (error) {
      console.error(`   ❌ Failed to start listener for ${chain.name}:`, error);
      // Don't crash — other chains might work fine
    }
  }

  console.log(`✅ CCTP burn listener active on ${activeListeners.length} chain(s)`);
}

// ─── Per-Chain Listener ──────────────────────────────────────────────────────

/**
 * Start listening for DepositForBurn events on a single source chain.
 * 
 * Uses WebSocket if available (real-time), falls back to HTTP polling.
 */
async function startChainListener(chain: SourceChainConfig): Promise<void> {
  console.log(`   🔗 Connecting to ${chain.name} (domain ${chain.domain})...`);

  // Prefer WebSocket for real-time events, fall back to HTTP + polling
  const provider = chain.wssUrl
    ? new ethers.WebSocketProvider(chain.wssUrl)
    : new ethers.JsonRpcProvider(chain.rpcUrl);

  // Create contract instance with just the event ABI
  const tokenMessenger = new ethers.Contract(
    chain.tokenMessengerV2,
    TOKEN_MESSENGER_V2_EVENTS_ABI,
    provider
  );

  // Listen for DepositForBurn events
  tokenMessenger.on(
    'DepositForBurn',
    async (
      nonce: bigint,
      burnToken: string,
      amount: bigint,
      depositor: string,
      mintRecipient: string,
      destinationDomain: number,
      destinationTokenMessenger: string,
      destinationCaller: string,
      event: any
    ) => {
      try {
        // ── Filter: Only process burns targeting OUR CCTPReceiver on Arc ──
        if (mintRecipient.toLowerCase() !== receiverBytes32.toLowerCase()) {
          return; // Not for us, skip silently
        }

        if (destinationDomain !== CCTP_DOMAINS.ARC) {
          return; // Not targeting Arc, skip
        }

        const blockNumber = event.log?.blockNumber ?? 0;
        const transactionHash = event.log?.transactionHash ?? '0x0';

        const burnData = {
          // CCTP identifiers
          nonce: nonce.toString(),
          sourceDomain: chain.domain,
          destinationDomain,

          // Transfer details
          burnToken,
          amount: amount.toString(),
          depositor,
          mintRecipient,
          destinationCaller,

          // Source chain tx info
          sourceChain: chain.name,
          sourceTxHash: transactionHash,
          sourceBlockNumber: blockNumber,

          // Tracking
          detectedAt: Date.now(),
          status: 'DETECTED',
        };

        console.log('🔥 DepositForBurn detected:', {
          chain: chain.name,
          depositor,
          amount: ethers.formatUnits(amount, 6),
          nonce: nonce.toString(),
          txHash: transactionHash,
        });

        // Publish to Redis Stream for the relayer consumer
        await publishEvent(STREAMS.CCTP_BURNS, burnData);
        console.log(`   ✅ Published to ${STREAMS.CCTP_BURNS} stream`);
      } catch (error) {
        console.error(`   ❌ Error processing DepositForBurn on ${chain.name}:`, error);
      }
    }
  );

  // ── Handle provider errors ──────────────────────────────────────────────

  provider.on('error', (error: any) => {
    console.error(`❌ ${chain.name} provider error:`, error.message || error);
  });

  // ── If using HTTP provider, set up polling for events ───────────────────
  // ethers v6 HTTP providers don't natively support .on() for events,
  // so we fall back to periodic getLogs() polling.

  if (!chain.wssUrl) {
    console.log(`   📡 ${chain.name}: No WSS — using HTTP polling (every 15s)`);
    startHttpPolling(chain, provider, tokenMessenger);
  }

  // Track for graceful shutdown
  activeListeners.push({
    chainName: chain.name,
    provider,
    contract: tokenMessenger,
  });

  console.log(`   ✅ ${chain.name} listener active`);
}

// ─── HTTP Polling Fallback ───────────────────────────────────────────────────

/**
 * For chains where we don't have a WebSocket URL, poll for events
 * using getLogs() at a regular interval.
 * 
 * This is less efficient than WebSocket but works with any RPC provider.
 */
let pollingIntervals: NodeJS.Timeout[] = [];

function startHttpPolling(
  chain: SourceChainConfig,
  provider: ethers.Provider,
  contract: ethers.Contract
): void {
  let lastBlock = 0;

  const poll = async () => {
    try {
      const currentBlock = await provider.getBlockNumber();

      if (lastBlock === 0) {
        // First run: start from current block (don't scan history)
        lastBlock = currentBlock;
        return;
      }

      if (currentBlock <= lastBlock) {
        return; // No new blocks
      }

      // Query for DepositForBurn events in the new block range
      const filter = contract.filters.DepositForBurn(
        null,       // nonce — any
        null,       // burnToken — any
        null,       // amount — any
        null,       // depositor — any
        receiverBytes32, // mintRecipient — our CCTPReceiver only
        CCTP_DOMAINS.ARC // destinationDomain — Arc only
      );

      const events = await contract.queryFilter(filter, lastBlock + 1, currentBlock);

      for (const event of events) {
        // Re-emit as if it came from the .on() listener
        // The event args match the DepositForBurn signature
        const args = (event as ethers.EventLog).args;
        if (args) {
          const burnData = {
            nonce: args.nonce.toString(),
            sourceDomain: chain.domain,
            destinationDomain: Number(args.destinationDomain),
            burnToken: args.burnToken,
            amount: args.amount.toString(),
            depositor: args.depositor,
            mintRecipient: args.mintRecipient,
            destinationCaller: args.destinationCaller,
            sourceChain: chain.name,
            sourceTxHash: event.transactionHash,
            sourceBlockNumber: event.blockNumber,
            detectedAt: Date.now(),
            status: 'DETECTED',
          };

          console.log('🔥 DepositForBurn detected (polled):', {
            chain: chain.name,
            depositor: args.depositor,
            amount: ethers.formatUnits(args.amount, 6),
            nonce: args.nonce.toString(),
            txHash: event.transactionHash,
          });

          await publishEvent(STREAMS.CCTP_BURNS, burnData);
          console.log(`   ✅ Published to ${STREAMS.CCTP_BURNS} stream`);
        }
      }

      lastBlock = currentBlock;
    } catch (error) {
      console.error(`❌ ${chain.name} polling error:`, error);
    }
  };

  // Poll every 15 seconds
  const interval = setInterval(poll, 15_000);
  pollingIntervals.push(interval);

  // Run immediately on start
  poll();
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

/**
 * Stop all chain listeners and close connections.
 */
export async function stopCCTPBurnListener(): Promise<void> {
  console.log('🛑 Stopping CCTP burn listener...');

  // Clear polling intervals
  for (const interval of pollingIntervals) {
    clearInterval(interval);
  }
  pollingIntervals = [];

  // Stop all chain listeners
  for (const listener of activeListeners) {
    try {
      listener.contract.removeAllListeners('DepositForBurn');

      // Destroy WebSocket providers, disconnect HTTP providers
      if ('destroy' in listener.provider) {
        await (listener.provider as ethers.WebSocketProvider).destroy();
      }

      console.log(`   ✅ ${listener.chainName} listener stopped`);
    } catch (error) {
      console.error(`   ⚠️  Error stopping ${listener.chainName}:`, error);
    }
  }

  activeListeners.length = 0;
  console.log('✅ CCTP burn listener stopped');
}