import { NextResponse } from 'next/server';

// This would connect to your backend in production
// For now, we'll simulate data
export async function GET() {
  // In production: fetch from your backend API
  // const response = await fetch('http://localhost:3000/api/payments');
  
  // Mock data for demo
  const payments = [
    {
      id: '1',
      paymentId: '0x0000...6987c5db',
      merchant: '0x172B...4BB02',
      amount: '10.0',
      token: 'USDC',
      status: 'settled',
      yellowCredited: true,
      settled: true,
      blockNumber: 25855857,
      transactionHash: '0x0b04...be13e',
      timestamp: new Date().toISOString(),
    },
  ];
  
  return NextResponse.json(payments);
}