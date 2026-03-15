import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';

// ─── Arc Testnet Chain Definition ────────────────────────────────────────────

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
      webSocket: ['wss://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
});

// ─── Wagmi Config ────────────────────────────────────────────────────────────

export const config = getDefaultConfig({
  appName: 'StabL Gateway',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'stabl-dev',
  chains: [arcTestnet],
  ssr: true,
});