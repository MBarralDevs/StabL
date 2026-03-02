/*
  Warnings:

  - You are about to drop the column `yellowCredited` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `yellowCreditedAt` on the `Payment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "yellowCredited",
DROP COLUMN "yellowCreditedAt",
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ARC',
ADD COLUMN     "sourceChain" TEXT NOT NULL DEFAULT 'Arc',
ADD COLUMN     "sourceTxHash" TEXT;

-- CreateIndex
CREATE INDEX "Payment_source_idx" ON "Payment"("source");
