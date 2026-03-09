// src/consumers/__tests__/onPaymentReceived.test.ts

/**
 * Payment Received Consumer Tests
 * 
 * Tests the first stage of the payment pipeline:
 * - Duplicate detection (idempotency)
 * - Database persistence with correct fields
 * - CCTP source tracking (ARC vs CCTP origin)
 * - Downstream pipeline publishing to CREDITED stream
 * - Error handling for DB failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Mock Redis
const mockPublishEvent = vi.fn().mockResolvedValue('mock-message-id');
const mockReadStream = vi.fn().mockResolvedValue([]);
const mockAckMessage = vi.fn().mockResolvedValue(undefined);
const mockCreateConsumerGroup = vi.fn().mockResolvedValue(undefined);

vi.mock('../../config/redis.js', () => ({
  readStream: (...args: any[]) => mockReadStream(...args),
  ackMessage: (...args: any[]) => mockAckMessage(...args),
  publishEvent: (...args: any[]) => mockPublishEvent(...args),
  createConsumerGroup: (...args: any[]) => mockCreateConsumerGroup(...args),
  STREAMS: {
    PAYMENTS: 'payments',
    CREDITED: 'credited',
    INTENT_HIT: 'intent-threshold',
    BATCH_READY: 'batch-ready',
    CCTP_BURNS: 'cctp-burns',
  },
}));

// Mock Prisma
const mockPaymentFindUnique = vi.fn();
const mockPaymentCreate = vi.fn();

vi.mock('../../services/database.js', () => ({
  prisma: {
    payment: {
      findUnique: (...args: any[]) => mockPaymentFindUnique(...args),
      create: (...args: any[]) => mockPaymentCreate(...args),
    },
  },
}));

// ─── Import the module under test ────────────────────────────────────────────
// We can't directly call processPayment since it's not exported.
// Instead we test through the consumer loop by simulating messages via mockReadStream.
// However, for unit tests it's cleaner to extract and test the logic directly.
//
// Strategy: We'll re-implement the processPayment logic inline to test it,
// matching the actual implementation exactly. In a real codebase you'd export
// processPayment for testability, or use dependency injection.

import { processPayment } from '../onPaymentReceived.js';   

// ─── Test Data Factories ─────────────────────────────────────────────────────

function makeArcPayment(overrides: Record<string, any> = {}) {
  return {
    merchant: '0xMerchantAddress',
    token: '0xUSDCAddress',
    amount: '50000000', // 50 USDC
    paymentId: '0xPaymentId123',
    blockNumber: 12345,
    transactionHash: '0xArcTxHash',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeCCTPPayment(overrides: Record<string, any> = {}) {
  return {
    merchant: '0xMerchantAddress',
    token: '0xUSDCAddress',
    amount: '100000000', // 100 USDC
    paymentId: '0xCCTPPaymentId456',
    blockNumber: 0,
    transactionHash: '0xProcessTxHash',
    timestamp: Date.now(),
    source: 'CCTP',
    sourceChain: 'Ethereum Sepolia',
    sourceTxHash: '0xOriginalBurnTxHash',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('onPaymentReceived — processPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentFindUnique.mockResolvedValue(null); // No duplicate by default
    mockPaymentCreate.mockResolvedValue({ id: 'new-payment-1' });
  });

  // ─── Duplicate Detection ──────────────────────────────────────────────

  describe('duplicate detection', () => {
    it('skips processing when payment already exists', async () => {
      mockPaymentFindUnique.mockResolvedValue({ id: 'existing', paymentId: '0xPaymentId123' });

      await processPayment(makeArcPayment());

      expect(mockPaymentFindUnique).toHaveBeenCalledWith({
        where: { paymentId: '0xPaymentId123' },
      });
      expect(mockPaymentCreate).not.toHaveBeenCalled();
      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('processes payment when no duplicate found', async () => {
      mockPaymentFindUnique.mockResolvedValue(null);

      await processPayment(makeArcPayment());

      expect(mockPaymentCreate).toHaveBeenCalled();
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('converts paymentId to string for lookup', async () => {
      const payment = makeArcPayment({ paymentId: 12345 }); // numeric

      await processPayment(payment);

      expect(mockPaymentFindUnique).toHaveBeenCalledWith({
        where: { paymentId: '12345' },
      });
    });
  });

  // ─── Database Persistence (Arc payments) ──────────────────────────────

  describe('database persistence — Arc payments', () => {
    it('writes payment with correct fields', async () => {
      const payment = makeArcPayment();

      await processPayment(payment);

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentId: '0xPaymentId123',
          merchant: '0xMerchantAddress',
          token: '0xUSDCAddress',
          amount: '50000000',
          blockNumber: 12345,
          transactionHash: '0xArcTxHash',
        }),
      });
    });

    it('defaults source to ARC for local payments', async () => {
      await processPayment(makeArcPayment());

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'ARC',
          sourceChain: 'Arc',
        }),
      });
    });

    it('uses transactionHash as sourceTxHash for Arc payments', async () => {
      await processPayment(makeArcPayment({ transactionHash: '0xArcTx' }));

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceTxHash: '0xArcTx',
        }),
      });
    });

    it('handles null blockNumber gracefully', async () => {
      await processPayment(makeArcPayment({ blockNumber: null }));

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          blockNumber: null,
        }),
      });
    });

    it('handles undefined blockNumber gracefully', async () => {
      const payment = makeArcPayment({ blockNumber: undefined });

      await processPayment(payment);

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          blockNumber: null,
        }),
      });
    });

    it('converts amount to string', async () => {
      await processPayment(makeArcPayment({ amount: 75000000 })); // numeric

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: '75000000',
        }),
      });
    });
  });

  // ─── Database Persistence (CCTP payments) ─────────────────────────────

  describe('database persistence — CCTP payments', () => {
    it('writes CCTP source and sourceChain', async () => {
      await processPayment(makeCCTPPayment());

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'CCTP',
          sourceChain: 'Ethereum Sepolia',
        }),
      });
    });

    it('writes original burn tx as sourceTxHash', async () => {
      await processPayment(makeCCTPPayment({ sourceTxHash: '0xBurnTx' }));

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sourceTxHash: '0xBurnTx',
        }),
      });
    });

    it('handles CCTP payment with blockNumber 0', async () => {
      await processPayment(makeCCTPPayment({ blockNumber: 0 }));

      // blockNumber 0 is valid for CCTP (cross-chain, no single block)
      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          blockNumber: 0,
        }),
      });
    });

    it('distinguishes Base Sepolia CCTP payments', async () => {
      await processPayment(makeCCTPPayment({
        sourceChain: 'Base Sepolia',
        sourceTxHash: '0xBaseBurnTx',
      }));

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: 'CCTP',
          sourceChain: 'Base Sepolia',
          sourceTxHash: '0xBaseBurnTx',
        }),
      });
    });
  });

  // ─── Downstream Pipeline Publishing ───────────────────────────────────

  describe('downstream pipeline publishing', () => {
    it('publishes to CREDITED stream after DB write', async () => {
      await processPayment(makeArcPayment());

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'credited',
        expect.objectContaining({
          paymentId: '0xPaymentId123',
          merchant: '0xMerchantAddress',
          token: '0xUSDCAddress',
          amount: '50000000',
        })
      );
    });

    it('includes source tag in CREDITED event for Arc', async () => {
      await processPayment(makeArcPayment());

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'credited',
        expect.objectContaining({
          source: 'ARC',
        })
      );
    });

    it('includes source tag in CREDITED event for CCTP', async () => {
      await processPayment(makeCCTPPayment());

      expect(mockPublishEvent).toHaveBeenCalledWith(
        'credited',
        expect.objectContaining({
          source: 'CCTP',
        })
      );
    });

    it('does not publish if payment is duplicate', async () => {
      mockPaymentFindUnique.mockResolvedValue({ id: 'existing' });

      await processPayment(makeArcPayment());

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws when database write fails', async () => {
      mockPaymentCreate.mockRejectedValue(new Error('DB connection lost'));

      await expect(processPayment(makeArcPayment())).rejects.toThrow('DB connection lost');
    });

    it('does not publish to CREDITED stream when DB write fails', async () => {
      mockPaymentCreate.mockRejectedValue(new Error('DB error'));

      try {
        await processPayment(makeArcPayment());
      } catch {}

      expect(mockPublishEvent).not.toHaveBeenCalled();
    });

    it('handles Prisma unique constraint violation gracefully', async () => {
      // This could happen in a race condition where two consumers
      // process the same payment simultaneously
      const prismaError = new Error('Unique constraint failed on the fields: (`paymentId`)');
      (prismaError as any).code = 'P2002';
      mockPaymentCreate.mockRejectedValue(prismaError);

      await expect(processPayment(makeArcPayment())).rejects.toThrow('Unique constraint');
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles payment with very large amount', async () => {
      await processPayment(makeArcPayment({
        amount: '999999999999999', // ~999M USDC
      }));

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: '999999999999999',
        }),
      });
    });

    it('handles payment with zero amount', async () => {
      await processPayment(makeArcPayment({ amount: '0' }));

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: '0',
        }),
      });
    });

    it('handles payment with missing optional fields', async () => {
      const minimal = {
        merchant: '0xMerchant',
        token: '0xToken',
        amount: '1000000',
        paymentId: '0xMinimal',
      };

      await processPayment(minimal);

      expect(mockPaymentCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          blockNumber: null,
          transactionHash: null,
          source: 'ARC',
          sourceChain: 'Arc',
        }),
      });
    });
  });
});