// src/config/env.ts

/**
 * Environment variable validation and loading.
 * 
 * This file ensures all required environment variables are present
 * before the application starts. It's better to fail fast at startup
 * than to crash later when a variable is missing.
 */

import dotenv from 'dotenv';

// Load .env file (if present)
dotenv.config();

// ─── Required Environment Variables ──────────────────────────────────────────

const REQUIRED_VARS = [
  'ARC_RPC_URL',
  'ARC_WSS_URL',
  'DEPLOYER_PRIVATE_KEY',
  'PAYMENT_POOL_ADDRESS',
  'INTENT_VAULT_ADDRESS',
  'BATCH_SETTLER_ADDRESS',
  'REDIS_URL',
  'DATABASE_URL',
  'LIFI_INTEGRATOR',
] as const;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate that all required environment variables are present.
 * Throws an error if any are missing.
 */
export function validateEnv(): void {
  const missing: string[] = [];

  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map(v => `  - ${v}`).join('\n')}\n\n` +
      `Please check your .env file and ensure all required variables are set.`
    );
  }

  console.log('✅ All required environment variables are present');
}

// ─── Typed Environment Variables ─────────────────────────────────────────────

/**
 * Typed access to environment variables.
 * 
 * This ensures TypeScript knows these variables exist and are strings.
 * We validate at startup, so we can safely use non-null assertions here.
 */
export const env = {
  // Arc Testnet
  ARC_RPC_URL: process.env.ARC_RPC_URL!,
  ARC_WSS_URL: process.env.ARC_WSS_URL!,
  DEPLOYER_PRIVATE_KEY: process.env.DEPLOYER_PRIVATE_KEY!,

  // Contract Addresses
  PAYMENT_POOL_ADDRESS: process.env.PAYMENT_POOL_ADDRESS!,
  INTENT_VAULT_ADDRESS: process.env.INTENT_VAULT_ADDRESS!,
  BATCH_SETTLER_ADDRESS: process.env.BATCH_SETTLER_ADDRESS!,

  // Infrastructure
  REDIS_URL: process.env.REDIS_URL!,
  DATABASE_URL: process.env.DATABASE_URL!,

  // Li.Fi
  LIFI_INTEGRATOR: process.env.LIFI_INTEGRATOR!,

  // Optional: Node environment (defaults to 'development')
  NODE_ENV: process.env.NODE_ENV || 'development',
} as const;

// ─── Export Validation Function ──────────────────────────────────────────────

/**
 * Call this at the start of your application to ensure
 * all required environment variables are present.
 */
export default validateEnv;