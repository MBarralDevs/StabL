-- CreateTable
CREATE TABLE "CCTPTransfer" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "sourceDomain" INTEGER NOT NULL,
    "destinationDomain" INTEGER NOT NULL,
    "burnToken" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "depositor" TEXT NOT NULL,
    "mintRecipient" TEXT NOT NULL,
    "sourceChain" TEXT NOT NULL,
    "sourceTxHash" TEXT NOT NULL,
    "sourceBlockNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DETECTED',
    "messageBytes" TEXT,
    "attestation" TEXT,
    "mintTxHash" TEXT,
    "processTxHash" TEXT,
    "error" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CCTPTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CCTPTransfer_status_idx" ON "CCTPTransfer"("status");

-- CreateIndex
CREATE INDEX "CCTPTransfer_sourceTxHash_idx" ON "CCTPTransfer"("sourceTxHash");

-- CreateIndex
CREATE INDEX "CCTPTransfer_depositor_idx" ON "CCTPTransfer"("depositor");

-- CreateIndex
CREATE INDEX "CCTPTransfer_createdAt_idx" ON "CCTPTransfer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CCTPTransfer_nonce_sourceDomain_key" ON "CCTPTransfer"("nonce", "sourceDomain");
