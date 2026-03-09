// src/consumers/__tests__/onPaymentCredited.test.ts

/**
 * Payment Credited Consumer Tests
 * 
 * Tests the intent evaluation logic — the decision engine that determines
 * when a merchant's payments should be settled:
 * - IMMEDIATE: always settle
 * - STANDARD: settle when maxWaitTimeSeconds has elapsed
 * - DEFERRED: settle when balance >= minBatchAmount
 * - Edge cases: no intent, stale intent, zero balance, contract errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockPublishEvent = vi.fn().mockResolvedValue('mock-id');

vi.mock('../../config/redis.js', () => ({
  redis: {},
  readStream: vi.fn().mockResolvedValue([]),
  ackMessage: vi.fn(),
  publishEvent: (...args: any[]) => mockPublishEvent(...args),
  createConsumerGroup: vi.fn(),
  STREAMS: {
    PAYMENTS: 'payments',
    CREDITED: 'credited',
    INTENT_HIT: 'intent-threshold',
    BATCH_READY: 'batch-ready',
    CCTP_BURNS: 'cctp-burns',
  },
}));

// Use globalThis to share contract mocks (same pattern as onBatchReady)
vi.mock('ethers', async () => {
  (globalThis as any).__intentContractInstances = (globalThis as any).__intentContractInstances || [];

  const actual = await vi.importActual('ethers');
  const actualEthers = (actual as any).ethers ?? actual;

  class MockProvider {
    getBlock = vi.fn().mockResolvedValue({ timestamp: 1700000000 });
    constructor() {}
  }

  class MockWallet {
    constructor() {}
  }

  class MockContract {
    getIntent = vi.fn();
    getMerchantBalance = vi.fn();
    constructor() {
      (globalThis as any).__intentContractInstances.push(this);
    }
  }

  return {
    ...actual as any,
    ethers: {
      ...actualEthers,
      JsonRpcProvider: MockProvider,
      Wallet: MockWallet,
      Contract: MockContract,
      formatUnits: actualEthers.formatUnits,
    },
  };
});

vi.mock('../../config/env.js', () => ({
  env: {
    ARC_RPC_URL: 'https://rpc.testnet.arc.network',
  },
}));

vi.mock('../../config/contracts.js', () => ({
  PaymentPoolABI_Interface: [],
  IntentVaultABI_Interface: [],
  PAYMENT_POOL_ADDRESS: '0xPaymentPool',
  INTENT_VAULT_ADDRESS: '0xIntentVault',
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { checkIntent } from '../onPaymentCredited.js';

// ─── Grab mock references ───────────────────────────────────────────────────
// onPaymentCredited.ts creates: provider, paymentPool (Contract), intentVault (Contract)
// Provider is index 0 in its own class, but Contract instances are what we need.
// contractInstances[0] = paymentPool, contractInstances[1] = intentVault

const paymentPoolMock = (globalThis as any).__intentContractInstances[0];
const intentVaultMock = (globalThis as any).__intentContractInstances[1];

const mockGetIntent = intentVaultMock.getIntent;
const mockGetMerchantBalance = paymentPoolMock.getMerchantBalance;

// We also need to access the provider's getBlock mock
// The provider is created via new ethers.JsonRpcProvider() — we need its instance
// Since it's not a Contract, it's not in contractInstances. We'll mock it via the module.
// Actually, the provider is used directly in checkIntent via `provider.getBlock('latest')`
// We set the default timestamp in MockProvider above.

// ─── Test Data ───────────────────────────────────────────────────────────────

const CURRENT_TIMESTAMP = 1700000000n; // Matches MockProvider.getBlock

function makeCreditedEvent(overrides: Record<string, any> = {}) {
  return {
    merchant: '0xMerchant1',
    token: '0xUSDC',
    amount: '50000000',
    paymentId: '0xPaymentId1',
    creditedAt: Date.now(),
    ...overrides,
  };
}

function makeIntent(overrides: Record<string, any> = {}) {
  return {
    speed: 0n, // IMMEDIATE
    minBatchAmount: 0n,
    maxWaitTimeSeconds: 0n,
    targetToken: '0xUSDC',
    exists: true,
    updatedAt: CURRENT_TIMESTAMP - 3600n, // 1 hour ago
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onPaymentCredited — checkIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Defaults: merchant has intent, has balance
    mockGetIntent.mockResolvedValue(makeIntent());
    mockGetMerchantBalance.mockResolvedValue(100000000n); // 100 USDC
  });

  // ─── IMMEDIATE Intent ─────────────────────────────────────────────────

  describe('IMMEDIATE intent', () => {
    it('always publishes to INTENT_HIT', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({ speed: 0n })); // IMMEDIATE

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'intent-threshold',
        expect.objectContaining({
          merchant: '0xMerchant1',
        })
      );
    });

    it('publishes regardless of balance amount', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({ speed: 0n }));
      mockGetMerchantBalance.mockResolvedValue(1n); // 0.000001 USDC

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalled();
    });
  });

  // ─── STANDARD Intent ──────────────────────────────────────────────────

  describe('STANDARD intent', () => {
    it('settles when wait time has elapsed', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 1n, // STANDARD
        maxWaitTimeSeconds: 3600n, // 1 hour
        updatedAt: CURRENT_TIMESTAMP - 7200n, // 2 hours ago (exceeded)
      }));

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'intent-threshold',
        expect.objectContaining({ merchant: '0xMerchant1' })
      );
    });

    it('does not settle when wait time has not elapsed', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 1n, // STANDARD
        maxWaitTimeSeconds: 3600n, // 1 hour
        updatedAt: CURRENT_TIMESTAMP - 1800n, // 30 min ago (not exceeded)
      }));

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('settles when wait time exactly equals threshold', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 1n,
        maxWaitTimeSeconds: 3600n,
        updatedAt: CURRENT_TIMESTAMP - 3600n, // Exactly 1 hour ago
      }));

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalled();
    });
  });

  // ─── DEFERRED Intent ──────────────────────────────────────────────────

  describe('DEFERRED intent', () => {
    it('settles when balance >= minBatchAmount', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 2n, // DEFERRED
        minBatchAmount: 100000000n, // 100 USDC
      }));
      mockGetMerchantBalance.mockResolvedValue(150000000n); // 150 USDC

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('does not settle when balance < minBatchAmount', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 2n,
        minBatchAmount: 100000000n, // 100 USDC
      }));
      mockGetMerchantBalance.mockResolvedValue(50000000n); // 50 USDC

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('settles when balance exactly equals minBatchAmount', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 2n,
        minBatchAmount: 100000000n,
      }));
      mockGetMerchantBalance.mockResolvedValue(100000000n); // Exactly 100

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalled();
    });
  });

  // ─── No Intent / Stale Intent ─────────────────────────────────────────

  describe('no intent or stale intent', () => {
    it('skips when merchant has no intent', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({ exists: false }));

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).not.toHaveBeenCalled();
      expect(mockGetMerchantBalance).not.toHaveBeenCalled();
    });

    it('skips when intent is stale (>30 days old)', async () => {
      const thirtyOneDays = 31n * 24n * 60n * 60n;
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 0n, // IMMEDIATE — would normally always settle
        updatedAt: CURRENT_TIMESTAMP - thirtyOneDays,
      }));

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('processes intent that is exactly 30 days old', async () => {
      const thirtyDays = 30n * 24n * 60n * 60n;
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 0n,
        updatedAt: CURRENT_TIMESTAMP - thirtyDays,
      }));

      await checkIntent(makeCreditedEvent());

      // 30 days = threshold, should still process (not strictly greater)
      expect(mockPublishEvent).toHaveBeenCalled();
    });
  });

  // ─── Published Event Shape ────────────────────────────────────────────

  describe('published event shape', () => {
    it('publishes merchant, token, balance, and intent details', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({
        speed: 0n,
        targetToken: '0xEURC',
      }));
      mockGetMerchantBalance.mockResolvedValue(200000000n);

      await checkIntent(makeCreditedEvent({ merchant: '0xAlice', token: '0xUSDC' }));

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'intent-threshold',
        expect.objectContaining({
          merchant: '0xAlice',
          token: '0xUSDC',
          balance: '200000000',
          intent: expect.objectContaining({
            targetToken: '0xEURC',
          }),
          timestamp: expect.any(Number),
        })
      );
    });

    it('includes speed name as string', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({ speed: 2n })); // DEFERRED
      mockGetMerchantBalance.mockResolvedValue(999999999n);

      await checkIntent(makeCreditedEvent());

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'intent-threshold',
        expect.objectContaining({
          intent: expect.objectContaining({
            speed: 'DEFERRED',
          }),
        })
      );
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws when getIntent fails', async () => {
      mockGetIntent.mockRejectedValue(new Error('RPC error'));

      await expect(
        checkIntent(makeCreditedEvent())
      ).rejects.toThrow('RPC error');
    });

    it('throws when getMerchantBalance fails', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({ speed: 0n }));
      mockGetMerchantBalance.mockRejectedValue(new Error('Contract call failed'));

      await expect(
        checkIntent(makeCreditedEvent())
      ).rejects.toThrow('Contract call failed');
    });

    it('does not call getMerchantBalance when intent does not exist', async () => {
      mockGetIntent.mockResolvedValue(makeIntent({ exists: false }));

      await checkIntent(makeCreditedEvent());

      expect(mockGetMerchantBalance).not.toHaveBeenCalled();
    });
  });

  // ─── Contract Interaction ─────────────────────────────────────────────

  describe('contract interaction', () => {
    it('queries IntentVault with correct merchant address', async () => {
      await checkIntent(makeCreditedEvent({ merchant: '0xBob' }));

      expect(mockGetIntent).toHaveBeenCalledWith('0xBob');
    });

    it('queries PaymentPool with correct merchant and token', async () => {
      await checkIntent(makeCreditedEvent({ merchant: '0xBob', token: '0xDAI' }));

      expect(mockGetMerchantBalance).toHaveBeenCalledWith('0xBob', '0xDAI');
    });
  });
});