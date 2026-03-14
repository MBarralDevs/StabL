import express from 'express';
import cors from 'cors';
import { prisma } from '../services/database.js';
import { ethers } from 'ethers';
import { env } from '../config/env.js';
import {
  PaymentPoolABI_Interface,
  BatchSettlerABI_Interface,
  PAYMENT_POOL_ADDRESS,
  BATCH_SETTLER_ADDRESS,
} from '../config/contracts.js';

const app = express();

app.use(cors({
  origin: ['http://localhost:3001', 'http://localhost:3000'],
}));

app.use(express.json());

// ─── Helper ──────────────────────────────────────────────────────────────────

function formatTokenAmount(amount: string | bigint, decimals: number = 6): string {
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');

  if (trimmedFractional === '') {
    return wholePart.toString();
  }
  return `${wholePart}.${trimmedFractional}`;
}

// ─── GET /api/payments ───────────────────────────────────────────────────────

app.get('/api/payments', async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const formatted = payments.map(p => ({
      id: p.id.toString(),
      paymentId: p.paymentId,
      merchant: p.merchant,
      amount: formatTokenAmount(p.amount, 6),
      token: p.token,
      status: p.settled ? 'settled' : 'pending',
      settled: p.settled,
      source: p.source ?? 'ARC',
      sourceChain: p.sourceChain ?? 'Arc',
      settlementAmount: p.settlementAmount ? formatTokenAmount(p.settlementAmount, 6) : null,
      settlementFee: p.settlementFee ? formatTokenAmount(p.settlementFee, 6) : null,
      blockNumber: p.blockNumber,
      transactionHash: p.transactionHash,
      settlementTxHash: p.settlementTxHash,
      batchId: p.batchId,
      timestamp: p.createdAt.toISOString(),
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// ─── GET /api/stats ──────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  try {
    const totalPayments = await prisma.payment.count();
    const settled = await prisma.payment.count({ where: { settled: true } });

    const allPayments = await prisma.payment.findMany({
      select: { amount: true },
    });

    const totalVolumeRaw = allPayments.reduce((sum, p) => {
      return sum + BigInt(p.amount);
    }, BigInt(0));

    const totalVolume = formatTokenAmount(totalVolumeRaw, 6);

    const settledPayments = await prisma.payment.findMany({
      where: { settled: true },
      select: { settlementFee: true },
    });

    const totalFeesRaw = settledPayments.reduce((sum, p) => {
      if (!p.settlementFee) return sum;
      return sum + BigInt(p.settlementFee);
    }, BigInt(0));

    const totalFees = formatTokenAmount(totalFeesRaw, 6);

    res.json({
      totalPayments,
      settledPayments: settled,
      totalVolume,
      totalFees,
      avgSettlementTime: '<5s',
      activeChains: 1,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/contract-status ────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(env.ARC_RPC_URL);

const paymentPool = new ethers.Contract(
  PAYMENT_POOL_ADDRESS,
  PaymentPoolABI_Interface,
  provider
);

const batchSettler = new ethers.Contract(
  BATCH_SETTLER_ADDRESS,
  BatchSettlerABI_Interface,
  provider
);

app.get('/api/contract-status', async (req, res) => {
  try {
    const [
      poolPaused,
      settlerPaused,
      maxBatchSize,
      feeBasisPoints,
      feeRecipient,
    ] = await Promise.all([
      paymentPool.paused(),
      batchSettler.paused(),
      batchSettler.maxBatchSize(),
      batchSettler.feeBasisPoints(),
      batchSettler.feeRecipient(),
    ]);

    res.json({
      paymentPool: {
        address: PAYMENT_POOL_ADDRESS,
        paused: poolPaused,
      },
      batchSettler: {
        address: BATCH_SETTLER_ADDRESS,
        paused: settlerPaused,
        maxBatchSize: Number(maxBatchSize),
        feeBasisPoints: Number(feeBasisPoints),
        feePercentage: `${Number(feeBasisPoints) / 100}%`,
        feeRecipient,
      },
    });
  } catch (error) {
    console.error('Error fetching contract status:', error);
    res.status(500).json({ error: 'Failed to fetch contract status' });
  }
});

// ─── GET /api/settlements ────────────────────────────────────────────────────

app.get('/api/settlements', async (req, res) => {
  try {
    const settlements = await prisma.payment.findMany({
      where: { settled: true },
      orderBy: { settledAt: 'desc' },
      take: 50,
    });

    const formatted = settlements.map(p => ({
      id: p.id,
      merchant: p.merchant,
      token: p.token,
      grossAmount: formatTokenAmount(p.amount, 6),
      netAmount: p.settlementAmount ? formatTokenAmount(p.settlementAmount, 6) : formatTokenAmount(p.amount, 6),
      fee: p.settlementFee ? formatTokenAmount(p.settlementFee, 6) : '0',
      batchId: p.batchId,
      txHash: p.settlementTxHash,
      settledAt: p.settledAt?.toISOString(),
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching settlements:', error);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.API_PORT || 3002;

app.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
});

export default app;