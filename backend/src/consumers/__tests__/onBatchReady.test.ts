// src/consumers/__tests__/onBatchReady.test.ts

/**
 * Batch Ready Consumer Tests
 * 
 * Tests the final stage of the payment pipeline — on-chain settlement:
 * - Balance verification against PaymentPool
 * - Fee calculation from BatchSettler config
 * - Cross-token vs same-token detection
 * - Settlement struct construction with outputToken
 * - Batch validation dry-run
 * - executeBatch transaction submission and confirmation
 * - Database update after successful settlement
 * - Error handling for reverts and network failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

vi.mock('../../config/redis.js', () => ({
  readStream: vi.fn().mockResolvedValue([]),
  ackMessage: vi.fn(),
  createConsumerGroup: vi.fn(),
  STREAMS: {
    PAYMENTS: 'payments',
    CREDITED: 'credited',
    INTENT_HIT: 'intent-threshold',
    BATCH_READY: 'batch-ready',
    CCTP_BURNS: 'cctp-burns',
  },
}));

const mockPaymentUpdateMany = vi.fn();

vi.mock('../../services/database.js', () => ({
  prisma: {
    payment: {
      updateMany: (...args: any[]) => mockPaymentUpdateMany(...args),
    },
  },
}));

vi.mock('ethers', async () => {
  // Initialize here — guaranteed to run before MockContract constructor
  (globalThis as any).__contractInstances = (globalThis as any).__contractInstances || [];

  const actual = await vi.importActual('ethers');
  const actualEthers = (actual as any).ethers ?? actual;

  class MockProvider {
    constructor() {}
  }

  class MockWallet {
    address = '0xRelayerWallet';
    constructor() {}
  }

  class MockContract {
    getMerchantBalance = vi.fn();
    feeBasisPoints = vi.fn();
    feeRecipient = vi.fn().mockResolvedValue('0xFeeRecipient');
    validateBatch = vi.fn();
    executeBatch = vi.fn();
    constructor() {
      (globalThis as any).__contractInstances.push(this);
    }
  }

  class MockInterface {
    parseError = vi.fn().mockReturnValue(null);
    constructor() {}
  }

  return {
    ...actual as any,
    ethers: {
      ...actualEthers,
      JsonRpcProvider: MockProvider,
      Wallet: MockWallet,
      Contract: MockContract,
      Interface: MockInterface,
      formatUnits: actualEthers.formatUnits,
      id: actualEthers.id,
      ZeroAddress: '0x0000000000000000000000000000000000000000',
    },
  };
});

vi.mock('../../config/env.js', () => ({
  env: {
    ARC_RPC_URL: 'https://rpc.testnet.arc.network',
    DEPLOYER_PRIVATE_KEY: '0x' + 'ab'.repeat(32),
  },
}));

vi.mock('../../config/contracts.js', () => ({
  PaymentPoolABI_Interface: [],
  BatchSettlerABI_Interface: [],
  PAYMENT_POOL_ADDRESS: '0xPaymentPool',
  BATCH_SETTLER_ADDRESS: '0xBatchSettler',
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { executeBatchSettlement } from '../onBatchReady.js';

// ─── Grab mock references from constructed contracts ─────────────────────────

const paymentPoolMock = (globalThis as any).__contractInstances[0];
const batchSettlerMock = (globalThis as any).__contractInstances[1];

const mockGetMerchantBalance = paymentPoolMock.getMerchantBalance;
const mockFeeBasisPoints = batchSettlerMock.feeBasisPoints;
const mockValidateBatch = batchSettlerMock.validateBatch;
const mockExecuteBatch = batchSettlerMock.executeBatch;

// ─── Test Data ───────────────────────────────────────────────────────────────

const USDC = '0xUSDCAddress';
const EURC = '0xEURCAddress';
const ZERO = '0x0000000000000000000000000000000000000000';

function makeSettlementRequest(overrides: Record<string, any> = {}) {
  return {
    merchant: '0xMerchant1',
    token: USDC,
    balance: '500000000', // 500 USDC
    intent: {
      speed: 'STANDARD',
      targetToken: USDC, // same-token by default
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeTxResponse(hash: string, success = true) {
  return {
    hash,
    wait: vi.fn().mockResolvedValue({
      status: success ? 1 : 0,
      blockNumber: 88888,
      gasUsed: 150000n,
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onBatchReady — executeBatchSettlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Defaults: merchant has 500 USDC, no fees, validation passes, tx succeeds
    mockGetMerchantBalance.mockResolvedValue(500000000n);
    mockFeeBasisPoints.mockResolvedValue(0n);
    mockValidateBatch.mockResolvedValue([true, 0n, '']);
    mockExecuteBatch.mockResolvedValue(makeTxResponse('0xSettleTxHash'));
    mockPaymentUpdateMany.mockResolvedValue({ count: 3 });
  });

  // ─── Balance Verification ─────────────────────────────────────────────

  describe('balance verification', () => {
    it('queries PaymentPool for on-chain balance', async () => {
      await executeBatchSettlement(makeSettlementRequest());

      expect(mockGetMerchantBalance).toHaveBeenCalledWith('0xMerchant1', USDC);
    });

    it('skips settlement when balance is zero', async () => {
      mockGetMerchantBalance.mockResolvedValue(0n);

      await executeBatchSettlement(makeSettlementRequest());

      expect(mockExecuteBatch).not.toHaveBeenCalled();
      expect(mockPaymentUpdateMany).not.toHaveBeenCalled();
    });

    it('throws when balance check fails', async () => {
      mockGetMerchantBalance.mockRejectedValue(new Error('RPC timeout'));

      await expect(
        executeBatchSettlement(makeSettlementRequest())
      ).rejects.toThrow('RPC timeout');
    });

    it('uses actual on-chain balance, not request balance', async () => {
      // Request says 500 USDC, but on-chain has 300
      mockGetMerchantBalance.mockResolvedValue(300000000n);

      await executeBatchSettlement(makeSettlementRequest({ balance: '500000000' }));

      // executeBatch should use 300 (on-chain), not 500 (request)
      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String), // batchId
        expect.arrayContaining([
          expect.objectContaining({ amount: 300000000n }),
        ]),
        0
      );
    });
  });

  // ─── Fee Calculation ──────────────────────────────────────────────────

  describe('fee calculation', () => {
    it('reads feeBasisPoints from contract', async () => {
      await executeBatchSettlement(makeSettlementRequest());

      expect(mockFeeBasisPoints).toHaveBeenCalled();
    });

    it('handles fee read failure gracefully (assumes 0)', async () => {
      mockFeeBasisPoints.mockRejectedValue(new Error('revert'));

      // Should not throw — falls back to 0 fee
      await executeBatchSettlement(makeSettlementRequest());

      expect(mockExecuteBatch).toHaveBeenCalled();
    });

    it('calculates correct net amount with fees', async () => {
      mockFeeBasisPoints.mockResolvedValue(30n); // 0.30%
      mockGetMerchantBalance.mockResolvedValue(1000000000n); // 1000 USDC

      await executeBatchSettlement(makeSettlementRequest({ balance: '1000000000' }));

      // Fee = 1000 * 30 / 10000 = 3 USDC
      // Net = 1000 - 3 = 997 USDC
      // But the gross amount goes to executeBatch — fee is deducted on-chain
      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ amount: 1000000000n }),
        ]),
        0
      );
    });
  });

  // ─── Cross-Token Detection ────────────────────────────────────────────

  describe('cross-token detection', () => {
    it('sets outputToken = token for same-token settlement', async () => {
      await executeBatchSettlement(makeSettlementRequest({
        token: USDC,
        intent: { speed: 'STANDARD', targetToken: USDC },
      }));

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ outputToken: USDC }),
        ]),
        0
      );
    });

    it('sets outputToken = targetToken for cross-token settlement', async () => {
      await executeBatchSettlement(makeSettlementRequest({
        token: USDC,
        intent: { speed: 'STANDARD', targetToken: EURC },
      }));

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ outputToken: EURC }),
        ]),
        0
      );
    });

    it('treats targetToken = zero address as same-token', async () => {
      await executeBatchSettlement(makeSettlementRequest({
        token: USDC,
        intent: { speed: 'STANDARD', targetToken: ZERO },
      }));

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ outputToken: USDC }),
        ]),
        0
      );
    });
  });

  // ─── Settlement Struct Construction ───────────────────────────────────

  describe('settlement struct construction', () => {
    it('builds correct Settlement struct', async () => {
      mockGetMerchantBalance.mockResolvedValue(250000000n);

      await executeBatchSettlement(makeSettlementRequest({
        merchant: '0xAlice',
        token: USDC,
        intent: { speed: 'IMMEDIATE', targetToken: USDC },
      }));

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        [{
          merchant: '0xAlice',
          token: USDC,
          amount: 250000000n,
          recipient: '0xAlice',
          outputToken: USDC,
        }],
        0
      );
    });

    it('sets recipient = merchant (self-settlement)', async () => {
      await executeBatchSettlement(makeSettlementRequest({ merchant: '0xBob' }));

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({
            merchant: '0xBob',
            recipient: '0xBob',
          }),
        ]),
        0
      );
    });
  });

  // ─── Batch Validation ─────────────────────────────────────────────────

  describe('batch validation (dry-run)', () => {
    it('calls validateBatch before executing', async () => {
      await executeBatchSettlement(makeSettlementRequest());

      expect(mockValidateBatch).toHaveBeenCalled();
    });

    it('aborts when validation fails', async () => {
      mockValidateBatch.mockResolvedValue([false, 0n, 'Insufficient balance']);

      await executeBatchSettlement(makeSettlementRequest());

      expect(mockExecuteBatch).not.toHaveBeenCalled();
    });

    it('proceeds when validation call reverts (best effort)', async () => {
      mockValidateBatch.mockRejectedValue(new Error('execution reverted'));

      await executeBatchSettlement(makeSettlementRequest());

      // Should still attempt executeBatch
      expect(mockExecuteBatch).toHaveBeenCalled();
    });
  });

  // ─── Transaction Execution ────────────────────────────────────────────

  describe('on-chain execution', () => {
    it('submits executeBatch with batchId and settlements', async () => {
      await executeBatchSettlement(makeSettlementRequest());

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String), // batchId (hash)
        expect.any(Array),  // settlements
        0                   // totalGasSaved
      );
    });

    it('waits for transaction confirmation', async () => {
      const txResponse = makeTxResponse('0xTxHash');
      mockExecuteBatch.mockResolvedValue(txResponse);

      await executeBatchSettlement(makeSettlementRequest());

      expect(txResponse.wait).toHaveBeenCalled();
    });

    it('throws when transaction reverts', async () => {
      mockExecuteBatch.mockResolvedValue(makeTxResponse('0xRevertedTx', false));

      await expect(
        executeBatchSettlement(makeSettlementRequest())
      ).rejects.toThrow('reverted');
    });

    it('throws when executeBatch call fails', async () => {
      mockExecuteBatch.mockRejectedValue(new Error('insufficient funds for gas'));

      await expect(
        executeBatchSettlement(makeSettlementRequest())
      ).rejects.toThrow('insufficient funds');
    });
  });

  // ─── Database Update ──────────────────────────────────────────────────

  describe('database update after settlement', () => {
    it('marks unsettled payments as settled', async () => {
      await executeBatchSettlement(makeSettlementRequest({ merchant: '0xAlice', token: USDC }));

      expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
        where: {
          merchant: '0xAlice',
          token: USDC,
          settled: false,
        },
        data: expect.objectContaining({
          settled: true,
          settledAt: expect.any(Date),
        }),
      });
    });

    it('stores settlement tx hash', async () => {
      mockExecuteBatch.mockResolvedValue(makeTxResponse('0xMySettleTx'));

      await executeBatchSettlement(makeSettlementRequest());

      expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        data: expect.objectContaining({
          settlementTxHash: '0xMySettleTx',
        }),
      });
    });

    it('stores net amount and fee', async () => {
      mockFeeBasisPoints.mockResolvedValue(50n); // 0.50%
      mockGetMerchantBalance.mockResolvedValue(1000000000n); // 1000 USDC

      await executeBatchSettlement(makeSettlementRequest());

      // Fee = 1000 * 50 / 10000 = 5 USDC (5000000)
      // Net = 1000 - 5 = 995 USDC (995000000)
      expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        data: expect.objectContaining({
          settlementAmount: '995000000',
          settlementFee: '5000000',
        }),
      });
    });

    it('stores zero fee when no fees configured', async () => {
      mockFeeBasisPoints.mockResolvedValue(0n);
      mockGetMerchantBalance.mockResolvedValue(500000000n);

      await executeBatchSettlement(makeSettlementRequest());

      expect(mockPaymentUpdateMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        data: expect.objectContaining({
          settlementAmount: '500000000',
          settlementFee: '0',
        }),
      });
    });

    it('does not throw when DB update fails (settlement already on-chain)', async () => {
      mockPaymentUpdateMany.mockRejectedValue(new Error('DB connection lost'));

      // Should NOT throw — the on-chain settlement succeeded
      await executeBatchSettlement(makeSettlementRequest());

      // Execution completed without error
      expect(mockExecuteBatch).toHaveBeenCalled();
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles very small balance (1 unit)', async () => {
      mockGetMerchantBalance.mockResolvedValue(1n);

      await executeBatchSettlement(makeSettlementRequest());

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ amount: 1n }),
        ]),
        0
      );
    });

    it('handles very large balance', async () => {
      mockGetMerchantBalance.mockResolvedValue(999999999999999n);

      await executeBatchSettlement(makeSettlementRequest());

      expect(mockExecuteBatch).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ amount: 999999999999999n }),
        ]),
        0
      );
    });

    it('generates unique batchId per call', async () => {
      await executeBatchSettlement(makeSettlementRequest());
      const firstBatchId = mockExecuteBatch.mock.calls[0][0];

      vi.clearAllMocks();
      mockGetMerchantBalance.mockResolvedValue(500000000n);
      mockFeeBasisPoints.mockResolvedValue(0n);
      mockValidateBatch.mockResolvedValue([true, 0n, '']);
      mockExecuteBatch.mockResolvedValue(makeTxResponse('0xTx2'));
      mockPaymentUpdateMany.mockResolvedValue({ count: 1 });

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 5));
      await executeBatchSettlement(makeSettlementRequest());
      const secondBatchId = mockExecuteBatch.mock.calls[0][0];

      expect(firstBatchId).not.toBe(secondBatchId);
    });
  });
});