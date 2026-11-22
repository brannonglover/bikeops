-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "productMarkupPercent" DECIMAL(6,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "cost" DECIMAL(10,2),
ADD COLUMN "markupPercent" DECIMAL(6,2);
