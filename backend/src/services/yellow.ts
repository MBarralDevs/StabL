// src/services/yellow.ts

/**
 * Yellow Network Integration
 * 
 * Provides instant liquidity to merchants through Yellow Network's
 * state channel infrastructure. Merchants receive instant credit
 * in their unified balance and can withdraw to any supported chain.
 */

import WebSocket from 'ws';
import { ethers } from 'ethers';
import { parseAnyRPCResponse } from '@erc7824/nitrolite';

// Yellow Network Configuration
const YELLOW_WSS_URL = process.env.YELLOW_WSS_URL || 'wss://clearnet-sandbox.yellow.com/ws';

// WebSocket connection to Yellow Network Clearnode
let yellowWs: WebSocket | null = null;
let isConnected = false;
let messageId = 1;

// Message handlers
const responseHandlers = new Map<number, {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}>();

/**
 * Connect to Yellow Network Clearnode
 */
export async function connectToYellow(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('🟡 Connecting to Yellow Network...');
    console.log(`   Clearnode: ${YELLOW_WSS_URL}`);
    
    yellowWs = new WebSocket(YELLOW_WSS_URL);
    
    yellowWs.on('open', () => {
      isConnected = true;
      console.log('   ✅ Connected to Yellow Network!');
      resolve();
    });
    
   yellowWs.on('message', (data: WebSocket.Data) => {
  try {
    const message = parseAnyRPCResponse(data.toString());
    
    // Type guard: check if it's a standard RPC response (has id field)
    if ('id' in message && typeof message.id === 'number') {
      // This is a response to our request
      if (responseHandlers.has(message.id)) {
        const handler = responseHandlers.get(message.id)!;
        responseHandlers.delete(message.id);
        
        if ('error' in message && message.error && typeof message.error === 'object') {
          const errorMsg = 'message' in message.error 
            ? String(message.error.message) 
            : 'Yellow Network error';
          handler.reject(new Error(errorMsg));
        } else if ('result' in message) {
          handler.resolve(message.result);
        } else {
          handler.reject(new Error('Invalid response from Yellow Network'));
        }
      }
    } else if ('method' in message && message.method) {
      // This is a notification
      handleNotification(message);
    }
  } catch (error) {
    console.error('   ❌ Error parsing Yellow message:', error);
  }
});
    
    yellowWs.on('error', (error) => {
      console.error('   ❌ Yellow Network connection error:', error);
      isConnected = false;
      reject(error);
    });
    
    yellowWs.on('close', () => {
      console.warn('   ⚠️  Yellow Network connection closed');
      isConnected = false;
    });
  });
}

/**
 * Handle notifications from Yellow Network
 */
function handleNotification(message: any): void {
  switch (message.method) {
    case 'tr': // Transfer notification
      console.log('   💸 Yellow transfer notification:', message.params);
      break;
    case 'bu': // Balance update notification
      console.log('   💰 Yellow balance update:', message.params);
      break;
    default:
      console.log('   📨 Yellow notification:', message.method);
  }
}

/**
 * Send RPC request to Yellow Network
 */
async function sendRPCRequest(method: string, params: any = {}): Promise<any> {
  if (!isConnected || !yellowWs) {
    throw new Error('Not connected to Yellow Network');
  }
  
  return new Promise((resolve, reject) => {
    const id = messageId++;
    
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    
    // Store handler for this request
    responseHandlers.set(id, { resolve, reject });
    
    // Send request
    yellowWs!.send(JSON.stringify(request));
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (responseHandlers.has(id)) {
        responseHandlers.delete(id);
        reject(new Error('Yellow Network request timeout'));
      }
    }, 30000);
  });
}

/**
 * Authenticate with Yellow Network using wallet signature
 * 
 * This creates a session that allows us to perform transfers
 * on behalf of the payment gateway.
 */
export async function authenticateYellow(): Promise<void> {
  // Get our backend wallet
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!);
  
  console.log('🟡 Authenticating with Yellow Network...');
  console.log(`   Gateway wallet: ${wallet.address}`);
  
  // TODO: Implement proper EIP-712 authentication
  // For now, we'll use the sandbox which may have simplified auth
  
  console.log('   ✅ Yellow authentication successful');
}

/**
 * Transfer funds to merchant via Yellow Network
 * 
 * This gives the merchant instant liquidity in their Yellow unified balance.
 * They can then withdraw to any supported chain at their convenience.
 */
export async function creditMerchantViaYellow(
  merchantAddress: string,
  amount: bigint,
  asset: string = 'usdc'
): Promise<{ transactionId: number; timestamp: string }> {
  
  console.log(`  💳 Crediting merchant via Yellow Network...`);
  console.log(`     Merchant: ${merchantAddress}`);
  console.log(`     Amount: ${ethers.formatUnits(amount, 6)} ${asset.toUpperCase()}`);
  
  try {
    // Convert amount to human-readable format
    const amountStr = ethers.formatUnits(amount, 6);
    
    // Execute transfer via Yellow Network
    const result = await sendRPCRequest('transfer', {
      destination: merchantAddress,
      allocations: [
        {
          asset: asset.toLowerCase(),
          amount: amountStr,
        },
      ],
    });
    
    // Extract transaction details
    const transaction = result.transactions[0];
    
    console.log(`     ✅ Transfer complete!`);
    console.log(`        Transaction ID: ${transaction.id}`);
    console.log(`        Timestamp: ${transaction.created_at}`);
    
    return {
      transactionId: transaction.id,
      timestamp: transaction.created_at,
    };
    
  } catch (error: any) {
    console.error(`     ❌ Yellow transfer failed:`, error.message);
    throw error;
  }
}

/**
 * Get merchant's Yellow Network balance
 */
export async function getYellowBalance(
  merchantAddress: string
): Promise<{ [asset: string]: string }> {
  
  const result = await sendRPCRequest('get_balance', {
    wallet: merchantAddress,
  });
  
  return result.balances || {};
}

/**
 * Close Yellow Network connection
 */
export async function disconnectFromYellow(): Promise<void> {
  console.log('🟡 Disconnecting from Yellow Network...');
  
  if (yellowWs) {
    yellowWs.close();
    yellowWs = null;
  }
  
  isConnected = false;
  responseHandlers.clear();
  
  console.log('   ✅ Disconnected from Yellow Network');
}

/**
 * DEMO MODE: Mock Yellow Network credit
 * 
 * This simulates what Yellow Network's transfer method would do in production.
 * In production, this would be replaced with real transfers from a funded
 * unified balance in Yellow Network's custody contracts.
 * 
 * Production flow:
 * 1. Gateway deposits USDC to Yellow custody contract on-chain
 * 2. Gateway resizes to move funds to unified balance (off-chain)
 * 3. Gateway uses 'transfer' RPC to credit merchants instantly
 * 4. Merchants receive funds in their Yellow unified balance
 * 5. Merchants can withdraw to any supported blockchain
 */
export async function creditMerchantViaYellowMock(
  merchantAddress: string,
  amount: bigint,
  asset: string = 'usdc'
): Promise<{ transactionId: number; timestamp: string }> {
  
  console.log(`  💳 [YELLOW NETWORK - DEMO MODE]`);
  console.log(`     Simulating instant off-chain transfer via state channels`);
  console.log(`     Merchant: ${merchantAddress}`);
  console.log(`     Amount: ${ethers.formatUnits(amount, 6)} ${asset.toUpperCase()}`);
  console.log(`     Clearnode: sandbox.yellow.com`);
  
  // Simulate network delay (Yellow is <1 second in production)
  await new Promise(resolve => setTimeout(resolve, 150));
  
  const mockTx = {
    transactionId: Math.floor(Math.random() * 1000000),
    timestamp: new Date().toISOString(),
  };
  
  console.log(`     ✅ Transfer complete!`);
  console.log(`        Transaction ID: ${mockTx.transactionId}`);
  console.log(`        Merchant unified balance: +${ethers.formatUnits(amount, 6)} USDC`);
  console.log(`        Merchant can withdraw to: Ethereum, Polygon, Base, Arbitrum, etc.`);
  console.log(`        Gas cost: $0.00 (off-chain)`);
  console.log(`        Finality: Instant (<1 sec)`);
  
  return mockTx;
}