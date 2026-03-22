// src/config/cctp.ts

/**
 * CCTP V2 Configuration
 * 
 * Contract addresses, domain IDs, and ABIs for Circle's Cross-Chain
 * Transfer Protocol V2. Used by the CCTP relayer service to:
 * - Monitor DepositForBurn events on source chains
 * - Poll Circle's attestation API
 * - Submit receiveMessage() on Arc
 * - Call CCTPReceiver.processPayment() to route into PaymentPool
 * 
 * Reference: https://developers.circle.com/cctp/references/contract-addresses
 * Arc docs:  https://docs.arc.network/arc/references/contract-addresses
 */

import CCTPReceiverABI from '../abi/CCTPReceiver.json';

// ─── CCTP Domain Identifiers ─────────────────────────────────────────────────
// These are Circle-issued, NOT chain IDs.

export const CCTP_DOMAINS = {
  ETHEREUM: 0,
  AVALANCHE: 1,
  OP_MAINNET: 2,
  ARBITRUM: 3,
  BASE: 6,
  POLYGON: 7,
  ARC: 26,
} as const;

export type CCTPDomain = (typeof CCTP_DOMAINS)[keyof typeof CCTP_DOMAINS];

// ─── Source Chain Configurations ─────────────────────────────────────────────
// Chains we monitor for inbound DepositForBurn events targeting our CCTPReceiver.
// Each entry contains the RPC, CCTP contract addresses, and domain ID.

export interface SourceChainConfig {
  name: string;
  domain: CCTPDomain;
  rpcUrl: string;
  wssUrl?: string;
  tokenMessengerV2: string;
  messageTransmitterV2: string;
  usdc: string;
}

/**
 * Source chains we actively monitor.
 * 
 * For testnet, we monitor Ethereum Sepolia and Base Sepolia.
 * Add more chains here as needed — the relayer picks them up automatically.
 * 
 * RPC URLs come from env vars so they can be configured per environment.
 */
export function getSourceChains(): SourceChainConfig[] {
  const chains: SourceChainConfig[] = [];

  // Ethereum Sepolia (testnet) — only add if RPC is configured
  if (process.env.ETH_SEPOLIA_RPC_URL) {
    chains.push({
      name: 'Ethereum Sepolia',
      domain: CCTP_DOMAINS.ETHEREUM,
      rpcUrl: process.env.ETH_SEPOLIA_RPC_URL,
      wssUrl: process.env.ETH_SEPOLIA_WSS_URL,
      // CCTP V2 uses deterministic CREATE2 addresses — same on all EVM chains
      tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
      usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia USDC
    });
  }

  // Base Sepolia (testnet)
  if (process.env.BASE_SEPOLIA_RPC_URL) {
    chains.push({
      name: 'Base Sepolia',
      domain: CCTP_DOMAINS.BASE,
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
      wssUrl: process.env.BASE_SEPOLIA_WSS_URL,
      tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia USDC
    });
  }

  return chains;
}

// ─── Arc (Destination Chain) CCTP Contracts ─────────────────────────────────

export const ARC_CCTP = {
  domain: CCTP_DOMAINS.ARC,
  tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  tokenMinterV2: '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
  messageV2: '0xbaC0179bB358A8936169a63408C8481D582390C4',
} as const;

// ─── CCTPReceiver (Our Contract on Arc) ─────────────────────────────────────

export const CCTP_RECEIVER_ADDRESS = process.env.CCTP_RECEIVER_ADDRESS!;
export const CCTPReceiverABI_Interface = CCTPReceiverABI.abi;

// ─── Circle Attestation API ─────────────────────────────────────────────────

export const CIRCLE_API = {
  // Testnet (sandbox)
  testnet: {
    host: 'https://iris-api-sandbox.circle.com',
    messagesV2: '/v2/messages',
    attestationV1: '/v1/attestations', // Legacy fallback
    burnFees: '/v2/burn/USDC/fees',
  },
  // Mainnet
  mainnet: {
    host: 'https://iris-api.circle.com',
    messagesV2: '/v2/messages',
    attestationV1: '/v1/attestations',
    burnFees: '/v2/burn/USDC/fees',
  },
} as const;

/**
 * Get the active Circle API config based on NODE_ENV.
 */
export function getCircleApiConfig() {
  const isMainnet = process.env.NODE_ENV === 'production';
  return isMainnet ? CIRCLE_API.mainnet : CIRCLE_API.testnet;
}

// ─── Relayer Configuration ──────────────────────────────────────────────────

export const RELAYER_CONFIG = {
  /** How often to poll Circle's API for attestation (ms) */
  attestationPollInterval: 2_000,

  /** Max time to wait for attestation before marking as timed out (ms) */
  attestationTimeout: 300_000, // 5 minutes

  /** Max retries for submitting receiveMessage() on Arc */
  maxMintRetries: 3,

  /** Max retries for calling processPayment() on CCTPReceiver */
  maxProcessRetries: 3,

  /** Delay between retries (ms) */
  retryDelay: 5_000,
} as const;

// ─── Minimal ABIs for Source Chain Monitoring ───────────────────────────────
// We only need the event signature to monitor burns. No need for full ABIs.

export const TOKEN_MESSENGER_V2_EVENTS_ABI = [
  'event DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)',
];

export const MESSAGE_TRANSMITTER_V2_ABI = [
  'function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool success)',
];

// ─── Helper: Convert address to bytes32 ─────────────────────────────────────
// CCTP uses bytes32 for addresses to support non-EVM chains.

export function addressToBytes32(address: string): string {
  // Pad a 20-byte address to 32 bytes (prepend 12 zero bytes)
  return '0x' + '00'.repeat(12) + address.slice(2).toLowerCase();
}

export function bytes32ToAddress(bytes32: string): string {
  // Strip the leading 12 zero bytes to get the 20-byte address
  return '0x' + bytes32.slice(26);
}

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateCCTPConfig(): void {
  if (!CCTP_RECEIVER_ADDRESS) {
    console.warn('⚠️  CCTP_RECEIVER_ADDRESS not set — CCTP relayer will be disabled');
    return;
  }

  const sourceChains = getSourceChains();
  if (sourceChains.length === 0) {
    console.warn('⚠️  No source chain RPCs configured — CCTP relayer will have no chains to monitor');
    console.warn('   Set ETH_SEPOLIA_RPC_URL or BASE_SEPOLIA_RPC_URL in .env');
    return;
  }

  console.log('📋 CCTP V2 configuration loaded:');
  console.log(`   CCTPReceiver on Arc: ${CCTP_RECEIVER_ADDRESS}`);
  console.log(`   Arc MessageTransmitterV2: ${ARC_CCTP.messageTransmitterV2}`);
  console.log(`   Arc domain: ${ARC_CCTP.domain}`);
  console.log(`   Monitoring ${sourceChains.length} source chain(s):`);
  for (const chain of sourceChains) {
    console.log(`     - ${chain.name} (domain ${chain.domain})`);
  }
}
