-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('AMOUNT', 'PERCENT');

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "salesTaxRatePercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "taxProducts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxServices" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxProducts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxRatePercent" DECIMAL(6,3) NOT NULL DEFAULT 0,
ADD COLUMN     "taxServices" BOOLEAN NOT NULL DEFAULT false;

