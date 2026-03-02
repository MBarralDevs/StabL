// src/config/__tests__/cctp.test.ts

/**
 * CCTP V2 Configuration Tests
 * 
 * Tests for utility functions, domain mappings, and config validation.
 * These are pure functions with no external dependencies — fast and reliable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CCTP_DOMAINS,
  ARC_CCTP,
  CIRCLE_API,
  RELAYER_CONFIG,
  addressToBytes32,
  bytes32ToAddress,
  getSourceChains,
  getCircleApiConfig,
  validateCCTPConfig,
} from '../cctp.js';

// ─── addressToBytes32 ───────────────────────────────────────────────────────

describe('addressToBytes32', () => {
  it('pads a 20-byte address to 32 bytes', () => {
    const address = '0x1234567890abcdef1234567890abcdef12345678';
    const result = addressToBytes32(address);

    // 0x + 24 zero chars (12 bytes) + 40 address chars (20 bytes) = 66 chars total
    expect(result).toHaveLength(66);
    expect(result).toBe('0x0000000000000000000000001234567890abcdef1234567890abcdef12345678');
  });

  it('handles checksummed addresses (lowercases)', () => {
    const checksummed = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
    const result = addressToBytes32(checksummed);

    expect(result).toBe('0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12');
  });

  it('handles zero address', () => {
    const result = addressToBytes32('0x0000000000000000000000000000000000000000');

    expect(result).toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
  });
});

// ─── bytes32ToAddress ───────────────────────────────────────────────────────

describe('bytes32ToAddress', () => {
  it('extracts a 20-byte address from 32 bytes', () => {
    const bytes32 = '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678';
    const result = bytes32ToAddress(bytes32);

    expect(result).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  it('is the inverse of addressToBytes32', () => {
    const original = '0xabcdef1234567890abcdef1234567890abcdef12';
    const roundTrip = bytes32ToAddress(addressToBytes32(original));

    expect(roundTrip).toBe(original);
  });

  it('handles zero address bytes32', () => {
    const bytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const result = bytes32ToAddress(bytes32);

    expect(result).toBe('0x0000000000000000000000000000000000000000');
  });
});

// ─── CCTP_DOMAINS ───────────────────────────────────────────────────────────

describe('CCTP_DOMAINS', () => {
  it('has correct domain IDs from Circle docs', () => {
    expect(CCTP_DOMAINS.ETHEREUM).toBe(0);
    expect(CCTP_DOMAINS.AVALANCHE).toBe(1);
    expect(CCTP_DOMAINS.OP_MAINNET).toBe(2);
    expect(CCTP_DOMAINS.ARBITRUM).toBe(3);
    expect(CCTP_DOMAINS.BASE).toBe(6);
    expect(CCTP_DOMAINS.POLYGON).toBe(7);
    expect(CCTP_DOMAINS.ARC).toBe(26);
  });
});

// ─── ARC_CCTP ───────────────────────────────────────────────────────────────

describe('ARC_CCTP', () => {
  it('has correct Arc testnet CCTP V2 contract addresses', () => {
    expect(ARC_CCTP.domain).toBe(26);
    expect(ARC_CCTP.tokenMessengerV2).toBe('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA');
    expect(ARC_CCTP.messageTransmitterV2).toBe('0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275');
    expect(ARC_CCTP.tokenMinterV2).toBe('0xb43db544E2c27092c107639Ad201b3dEfAbcF192');
  });
});

// ─── getCircleApiConfig ─────────────────────────────────────────────────────

describe('getCircleApiConfig', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('returns testnet config by default (development)', () => {
    process.env.NODE_ENV = 'development';
    const config = getCircleApiConfig();

    expect(config.host).toBe('https://iris-api-sandbox.circle.com');
    expect(config.messagesV2).toBe('/v2/messages');
  });

  it('returns mainnet config in production', () => {
    process.env.NODE_ENV = 'production';
    const config = getCircleApiConfig();

    expect(config.host).toBe('https://iris-api.circle.com');
  });
});

// ─── getSourceChains ────────────────────────────────────────────────────────

describe('getSourceChains', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and clear relevant env vars
    const keys = [
      'ETH_SEPOLIA_RPC_URL', 'ETH_SEPOLIA_WSS_URL',
      'BASE_SEPOLIA_RPC_URL', 'BASE_SEPOLIA_WSS_URL',
    ];
    for (const key of keys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns empty array when no source chain RPCs are configured', () => {
    const chains = getSourceChains();
    expect(chains).toHaveLength(0);
  });

  it('includes Ethereum Sepolia when RPC is set', () => {
    process.env.ETH_SEPOLIA_RPC_URL = 'https://eth-sepolia.example.com';

    const chains = getSourceChains();

    expect(chains).toHaveLength(1);
    expect(chains[0].name).toBe('Ethereum Sepolia');
    expect(chains[0].domain).toBe(CCTP_DOMAINS.ETHEREUM);
    expect(chains[0].rpcUrl).toBe('https://eth-sepolia.example.com');
    expect(chains[0].wssUrl).toBeUndefined();
  });

  it('includes WSS URL when provided', () => {
    process.env.ETH_SEPOLIA_RPC_URL = 'https://eth-sepolia.example.com';
    process.env.ETH_SEPOLIA_WSS_URL = 'wss://eth-sepolia.example.com';

    const chains = getSourceChains();

    expect(chains[0].wssUrl).toBe('wss://eth-sepolia.example.com');
  });

  it('includes Base Sepolia when RPC is set', () => {
    process.env.BASE_SEPOLIA_RPC_URL = 'https://base-sepolia.example.com';

    const chains = getSourceChains();

    expect(chains).toHaveLength(1);
    expect(chains[0].name).toBe('Base Sepolia');
    expect(chains[0].domain).toBe(CCTP_DOMAINS.BASE);
  });

  it('includes both chains when both RPCs are set', () => {
    process.env.ETH_SEPOLIA_RPC_URL = 'https://eth-sepolia.example.com';
    process.env.BASE_SEPOLIA_RPC_URL = 'https://base-sepolia.example.com';

    const chains = getSourceChains();

    expect(chains).toHaveLength(2);
    expect(chains[0].name).toBe('Ethereum Sepolia');
    expect(chains[1].name).toBe('Base Sepolia');
  });

  it('has correct CCTP V2 contract addresses for each chain', () => {
    process.env.ETH_SEPOLIA_RPC_URL = 'https://eth-sepolia.example.com';
    process.env.BASE_SEPOLIA_RPC_URL = 'https://base-sepolia.example.com';

    const chains = getSourceChains();

    // CCTP V2 uses deterministic CREATE2 — same addresses on all EVM chains
    for (const chain of chains) {
      expect(chain.tokenMessengerV2).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d');
      expect(chain.messageTransmitterV2).toBe('0x81D40F21F12A8F0E3252Bccb954D722d4c464B64');
    }
  });
});

// ─── RELAYER_CONFIG ─────────────────────────────────────────────────────────

describe('RELAYER_CONFIG', () => {
  it('has sensible polling interval', () => {
    expect(RELAYER_CONFIG.attestationPollInterval).toBeGreaterThanOrEqual(1000);
    expect(RELAYER_CONFIG.attestationPollInterval).toBeLessThanOrEqual(10_000);
  });

  it('has timeout longer than poll interval', () => {
    expect(RELAYER_CONFIG.attestationTimeout).toBeGreaterThan(
      RELAYER_CONFIG.attestationPollInterval * 10
    );
  });

  it('has retry counts greater than zero', () => {
    expect(RELAYER_CONFIG.maxMintRetries).toBeGreaterThan(0);
    expect(RELAYER_CONFIG.maxProcessRetries).toBeGreaterThan(0);
  });
});

// ─── CIRCLE_API ─────────────────────────────────────────────────────────────

describe('CIRCLE_API', () => {
  it('testnet and mainnet have the same endpoint paths', () => {
    expect(CIRCLE_API.testnet.messagesV2).toBe(CIRCLE_API.mainnet.messagesV2);
    expect(CIRCLE_API.testnet.burnFees).toBe(CIRCLE_API.mainnet.burnFees);
  });

  it('testnet and mainnet have different hosts', () => {
    expect(CIRCLE_API.testnet.host).not.toBe(CIRCLE_API.mainnet.host);
    expect(CIRCLE_API.testnet.host).toContain('sandbox');
    expect(CIRCLE_API.mainnet.host).not.toContain('sandbox');
  });
});