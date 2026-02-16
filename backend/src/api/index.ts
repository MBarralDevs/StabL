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
  origin: 'http://localhost:3001'
}));

app.use(express.json());

// Helper function to format token amounts
function formatTokenAmount(amount: string | bigint, decimals: number = 6): string {
  // Convert to bigint if it's a string
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
  
  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;
  
  // Convert to decimal string
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '');
  
  if (trimmedFractional === '') {
    return wholePart.toString();
  }
  
  return `${wholePart}.${trimmedFractional}`;
}

// Get all payments
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
      status: p.settled ? 'settled' : (p.yellowCredited ? 'credited' : 'pending'),
      yellowCredited: p.yellowCredited,
      settled: p.settled,
      settlementAmount: p.settlementAmount ? formatTokenAmount(p.settlementAmount, 6) : null,
      settlementFee: p.settlementFee ? formatTokenAmount(p.settlementFee, 6) : null,
      blockNumber: p.blockNumber,
      transactionHash: p.transactionHash,
      settlementTxHash: p.settlementTxHash,
      timestamp: p.createdAt.toISOString(),
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    const totalPayments = await prisma.payment.count();
    const settled = await prisma.payment.count({ where: { settled: true } });
    
    const allPayments = await prisma.payment.findMany({
      select: { amount: true },
    });

    // Sum with proper decimal conversion - convert each string to BigInt
    const totalVolumeRaw = allPayments.reduce((sum, p) => {
      const amountBigInt = typeof p.amount === 'string' ? BigInt(p.amount) : p.amount;
      return sum + amountBigInt;
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
      activeChains: 3,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});


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

const PORT = process.env.API_PORT || 3002;

app.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
});

export default app;