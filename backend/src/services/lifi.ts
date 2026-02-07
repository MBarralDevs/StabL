// src/services/lifi.ts

/**
 * Li.Fi Integration (REAL API)
 * 
 * Uses Li.Fi's free API to get REAL cross-chain routing quotes.
 * Shows actual bridges, DEXs, gas costs, and timing estimates.
 * 
 * For demo: We get real quotes but simulate execution (no funds needed).
 */

import { createConfig, getQuote, getRoutes, ChainId } from '@lifi/sdk';
import { ethers } from 'ethers';

// Token addresses for common stablecoins
const TOKENS = {
  // USDC addresses
  USDC_ETHEREUM: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDC_POLYGON: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  USDC_ARBITRUM: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  USDC_OPTIMISM: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  USDC_BASE: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  
  // DAI addresses
  DAI_ETHEREUM: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  DAI_POLYGON: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
  DAI_ARBITRUM: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
  DAI_OPTIMISM: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
};

/**
 * Initialize Li.Fi SDK
 */
export function initializeLiFi(): void {
  console.log('🌉 Initializing Li.Fi SDK...');
  
  createConfig({
    integrator: 'StabL-Gateway',
    // No API key needed for free tier (200 requests/2 hours)
  });
  
  console.log('   ✅ Li.Fi SDK initialized');
  console.log('   📡 API: https://li.quest (Free tier)');
  console.log('   🌍 Supported: 40+ chains, 50k+ token pairs');
}

/**
 * Get a REAL quote from Li.Fi API
 * 
 * This makes an actual API call and returns real routing data:
 * - Which bridges to use (Across, Stargate, Hop, etc.)
 * - Which DEXs to use (Uniswap, Curve, etc.)
 * - Real gas estimates
 * - Real timing estimates
 * - Real output amounts
 */
export async function getLiFiQuote(params: {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
}): Promise<any> {
  
  console.log(`  🌉 Getting REAL Li.Fi quote...`);
  console.log(`     From: Chain ${params.fromChainId} (${getChainName(params.fromChainId)})`);
  console.log(`     To: Chain ${params.toChainId} (${getChainName(params.toChainId)})`);
  console.log(`     Amount: ${ethers.formatUnits(params.fromAmount, 6)} USDC`);
  
  try {
    const quote = await getQuote({
      fromAddress: params.fromAddress,
      fromChain: params.fromChainId,
      toChain: params.toChainId,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
    });
    
    console.log(`     ✅ REAL quote received from Li.Fi!`);
    console.log(`        Route: ${quote.toolDetails.name}`);
    console.log(`        Bridge: ${quote.toolDetails.key}`);
    console.log(`        Estimated output: ${ethers.formatUnits(quote.estimate.toAmount, quote.action.toToken.decimals)} ${quote.action.toToken.symbol}`);
    console.log(`        Estimated time: ~${Math.round(quote.estimate.executionDuration / 60)} minutes`);
    console.log(`        Gas cost (USD): ~$${quote.estimate.gasCosts?.[0]?.amountUSD || 'N/A'}`);
    
    // Show the route breakdown
    if (quote.includedSteps && quote.includedSteps.length > 0) {
      console.log(`        Steps:`);
      quote.includedSteps.forEach((step: any, index: number) => {
        console.log(`          ${index + 1}. ${step.type}: ${step.tool} (${step.toolDetails.name})`);
      });
    }
    
    return quote;
    
  } catch (error: any) {
    console.error(`     ❌ Li.Fi quote failed:`, error.message);
    throw error;
  }
}

/**
 * Get multiple route options from Li.Fi
 * 
 * Returns different routing strategies (fastest, cheapest, etc.)
 */
export async function getLiFiRoutes(params: {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
}): Promise<any> {
  
  console.log(`  🌉 Getting REAL Li.Fi routes...`);
  
  try {
    const routes = await getRoutes({
      fromAddress: params.fromAddress,
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      fromTokenAddress: params.fromToken,
      toTokenAddress: params.toToken,
      fromAmount: params.fromAmount,
      options: {
        order: 'FASTEST', // or 'CHEAPEST', 'RECOMMENDED'
      },
    });
    
    console.log(`     ✅ REAL routes received from Li.Fi!`);
    console.log(`        Found ${routes.routes.length} route options`);
    
    // Show top 3 routes
    routes.routes.slice(0, 3).forEach((route: any, index: number) => {
      console.log(`        Route ${index + 1}:`);
      console.log(`          Bridge: ${route.steps[0]?.toolDetails?.name || 'N/A'}`);
      console.log(`          Output: ${ethers.formatUnits(route.toAmount, route.toToken.decimals)} ${route.toToken.symbol}`);
      console.log(`          Time: ~${Math.round(route.steps[0]?.estimate?.executionDuration / 60)} min`);
      console.log(`          Gas: ~$${route.gasCostUSD || 'N/A'}`);
    });
    
    return routes;
    
  } catch (error: any) {
    console.error(`     ❌ Li.Fi routes failed:`, error.message);
    throw error;
  }
}

/**
 * Simulate executing a Li.Fi quote
 * 
 * In production, this would actually execute the swap.
 * For demo, we show what WOULD happen based on the real quote.
 */
export async function executeLiFiQuote(quote: any): Promise<{
  txHash: string;
  outputAmount: string;
  outputToken: string;
  outputChain: number;
  bridge: string;
  gasUsed: string;
}> {
  
  console.log(`  🌉 Executing Li.Fi route (simulated)...`);
  console.log(`     Bridge: ${quote.toolDetails.name}`);
  console.log(`     Route: ${quote.action.fromToken.symbol} → ${quote.action.toToken.symbol}`);
  
  // Simulate execution delay
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const result = {
    txHash: `0x${Math.random().toString(16).substring(2, 66)}`,
    outputAmount: quote.estimate.toAmount,
    outputToken: quote.action.toToken.address,
    outputChain: quote.action.toChainId,
    bridge: quote.toolDetails.name,
    gasUsed: quote.estimate.gasCosts?.[0]?.amountUSD || '0',
  };
  
  console.log(`     ✅ Execution complete (simulated)`);
  console.log(`        TxHash: ${result.txHash}`);
  console.log(`        Output: ${ethers.formatUnits(result.outputAmount, quote.action.toToken.decimals)} ${quote.action.toToken.symbol}`);
  console.log(`        Bridge used: ${result.bridge}`);
  console.log(`        Gas cost: $${result.gasUsed}`);
  console.log(`        Status: Merchant will receive funds in ~${Math.round(quote.estimate.executionDuration / 60)} minutes`);
  
  return result;
}

/**
 * Helper: Get chain name from ID
 */
function getChainName(chainId: number): string {
  const names: { [key: number]: string } = {
    1: 'Ethereum',
    10: 'Optimism',
    56: 'BSC',
    137: 'Polygon',
    8453: 'Base',
    42161: 'Arbitrum',
    43114: 'Avalanche',
  };
  return names[chainId] || `Chain ${chainId}`;
}

/**
 * Helper: Get USDC address for a chain
 */
export function getUSDCAddress(chainId: number): string {
  const addresses: { [key: number]: string } = {
    1: TOKENS.USDC_ETHEREUM,
    10: TOKENS.USDC_OPTIMISM,
    137: TOKENS.USDC_POLYGON,
    8453: TOKENS.USDC_BASE,
    42161: TOKENS.USDC_ARBITRUM,
  };
  return addresses[chainId] || TOKENS.USDC_ETHEREUM;
}

/**
 * Helper: Get DAI address for a chain
 */
export function getDAIAddress(chainId: number): string {
  const addresses: { [key: number]: string } = {
    1: TOKENS.DAI_ETHEREUM,
    10: TOKENS.DAI_OPTIMISM,
    137: TOKENS.DAI_POLYGON,
    42161: TOKENS.DAI_ARBITRUM,
  };
  return addresses[chainId] || TOKENS.DAI_ETHEREUM;
}