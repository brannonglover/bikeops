-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('SENT', 'RESPONDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EstimateItemKind" AS ENUM ('SERVICE', 'PRODUCT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EstimateItemDecision" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "JobEstimate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'SENT',
    "message" TEXT,
    "resumeStage" "Stage",
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBySms" BOOLEAN NOT NULL DEFAULT false,
    "sentByEmail" BOOLEAN NOT NULL DEFAULT false,
    "sentByPush" BOOLEAN NOT NULL DEFAULT false,
    "respondedAt" TIMESTAMP(3),
    "respondedByStaff" BOOLEAN NOT NULL DEFAULT false,
    "customerComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEstimateItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "kind" "EstimateItemKind" NOT NULL,
    "serviceId" TEXT,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "jobBikeId" TEXT,
    "decision" "EstimateItemDecision" NOT NULL DEFAULT 'PENDING',
    "jobLineId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEstimateItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobEstimate_shopId_idx" ON "JobEstimate"("shopId");

-- CreateIndex
CREATE INDEX "JobEstimate_jobId_idx" ON "JobEstimate"("jobId");

-- CreateIndex
CREATE INDEX "JobEstimateItem_shopId_idx" ON "JobEstimateItem"("shopId");

-- CreateIndex
CREATE INDEX "JobEstimateItem_estimateId_idx" ON "JobEstimateItem"("estimateId");

-- AddForeignKey
ALTER TABLE "JobEstimate" ADD CONSTRAINT "JobEstimate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEstimate" ADD CONSTRAINT "JobEstimate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEstimateItem" ADD CONSTRAINT "JobEstimateItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEstimateItem" ADD CONSTRAINT "JobEstimateItem_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "JobEstimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEstimateItem" ADD CONSTRAINT "JobEstimateItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEstimateItem" ADD CONSTRAINT "JobEstimateItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEstimateItem" ADD CONSTRAINT "JobEstimateItem_jobBikeId_fkey" FOREIGN KEY ("jobBikeId") REFERENCES "JobBike"("id") ON DELETE SET NULL ON UPDATE CASCADE;

