-- AlterTable
ALTER TABLE "Product" ADD COLUMN "lowStockThreshold" INTEGER,
ADD COLUMN "lowStockAlertedAt" TIMESTAMP(3);
