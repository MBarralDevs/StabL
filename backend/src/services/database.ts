// src/services/database.ts

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['error', 'warn'], // Enable query logging in development if needed
});

// Graceful shutdown
export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
  console.log('✅ Prisma disconnected');
}