-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "settlementAmount" TEXT,
ADD COLUMN     "settlementFee" TEXT,
ALTER COLUMN "blockNumber" DROP NOT NULL,
ALTER COLUMN "transactionHash" DROP NOT NULL;
