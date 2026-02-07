-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "yellowCredited" BOOLEAN NOT NULL DEFAULT false,
    "yellowCreditedAt" TIMESTAMP(3),
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "settlementTxHash" TEXT,
    "settledAt" TIMESTAMP(3),
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "merchantCount" INTEGER NOT NULL,
    "totalAmount" TEXT NOT NULL,
    "gasUsed" TEXT NOT NULL,
    "gasSaved" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantIntent" (
    "id" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "speed" TEXT NOT NULL,
    "minBatchAmount" TEXT NOT NULL,
    "maxWaitTimeSeconds" INTEGER NOT NULL,
    "targetToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentId_key" ON "Payment"("paymentId");

-- CreateIndex
CREATE INDEX "Payment_merchant_idx" ON "Payment"("merchant");

-- CreateIndex
CREATE INDEX "Payment_settled_idx" ON "Payment"("settled");

-- CreateIndex
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_batchId_key" ON "Batch"("batchId");

-- CreateIndex
CREATE INDEX "Batch_createdAt_idx" ON "Batch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantIntent_merchant_key" ON "MerchantIntent"("merchant");

-- CreateIndex
CREATE INDEX "MerchantIntent_merchant_idx" ON "MerchantIntent"("merchant");
