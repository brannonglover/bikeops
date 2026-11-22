import { NextRequest, NextResponse } from "next/server";
import { getStaffToken } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { syncLowStockAlerts } from "@/lib/low-stock";
import {
  adjustStockForQuantityChange,
  releaseStockForLine,
  takeStockForLine,
} from "@/lib/product-stock";

const addProductSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).optional().default(1),
  jobBikeId: z.string().optional().nullable(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getStaffToken(request);
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopId = token.shopId;

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = addProductSchema.parse(body);

    const [job, product, jobBike] = await Promise.all([
      prisma.job.findFirst({ where: { id: jobId, shopId }, select: { id: true, stage: true } }),
      prisma.product.findFirst({ where: { id: data.productId, shopId } }),
      data.jobBikeId
        ? prisma.jobBike.findFirst({ where: { id: data.jobBikeId, jobId, shopId }, select: { id: true } })
        : Promise.resolve(null),
    ]);
    if (!job || (data.jobBikeId && !jobBike)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Selling the product takes it off the shelf. A cancelled job sells nothing;
    // restoring the job takes the stock then.
    const jobProduct = await prisma.$transaction(async (tx) => {
      const line = await tx.jobProduct.create({
        data: {
          shopId,
          jobId,
          productId: data.productId,
          quantity: data.quantity,
          unitPrice: product.price,
          jobBikeId: data.jobBikeId ?? null,
        },
      });
      if (job.stage !== "CANCELLED") await takeStockForLine(tx, line);
      return tx.jobProduct.findUniqueOrThrow({
        where: { id: line.id },
        include: {
          product: true,
          jobBike: { select: { id: true, make: true, model: true, nickname: true } },
        },
      });
    });
    waitUntil(syncLowStockAlerts(shopId, { productIds: [product.id], notify: true }));

    return NextResponse.json(jobProduct);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/jobs/[id]/products error:", error);
    return NextResponse.json(
      { error: "Failed to add product to job" },
      { status: 500 }
    );
  }
}

const patchProductSchema = z.object({
  jobProductId: z.string().min(1),
  jobBikeId: z.string().nullable().optional(),
  quantity: z.number().int().min(1).optional(),
  unitPrice: z.number().min(0).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getStaffToken(request);
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopId = token.shopId;

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = patchProductSchema.parse(body);

    const existing = await prisma.jobProduct.findFirst({
      where: { shopId, id: data.jobProductId, jobId },
      include: { job: { select: { stage: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: "Job product not found" }, { status: 404 });
    }

    const updateData: { jobBikeId?: string | null; quantity?: number; unitPrice?: number } = {};
    if ("jobBikeId" in data) updateData.jobBikeId = data.jobBikeId ?? null;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.unitPrice !== undefined) updateData.unitPrice = Math.round(data.unitPrice * 100) / 100;

    const updated = await prisma.$transaction(async (tx) => {
      if (data.quantity !== undefined && existing.job.stage !== "CANCELLED") {
        await adjustStockForQuantityChange(tx, existing, data.quantity);
      }
      const line = await tx.jobProduct.update({
        where: { id: data.jobProductId },
        data: updateData,
        include: {
          product: true,
          jobBike: { select: { id: true, make: true, model: true, nickname: true } },
        },
      });
      await tx.job.update({ where: { id: jobId, shopId }, data: {} });
      return line;
    });
    if (data.quantity !== undefined) {
      waitUntil(syncLowStockAlerts(shopId, { productIds: [existing.productId], notify: true }));
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/jobs/[id]/products error:", error);
    return NextResponse.json({ error: "Failed to update product line" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getStaffToken(request);
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopId = token.shopId;

  try {
    const { id: jobId } = params;
    const { searchParams } = new URL(request.url);
    const jobProductId = searchParams.get("jobProductId");

    if (!jobProductId) {
      return NextResponse.json(
        { error: "jobProductId query param required" },
        { status: 400 }
      );
    }

    // Removing a line puts back whatever it took off the shelf.
    const removed = await prisma.$transaction(async (tx) => {
      const line = await tx.jobProduct.findFirst({
        where: { shopId, id: jobProductId, jobId },
        select: { id: true, productId: true, stockDeductedQty: true },
      });
      if (!line) return null;
      await releaseStockForLine(tx, line);
      const result = await tx.jobProduct.deleteMany({ where: { id: line.id } });
      return result.count > 0 ? line.productId : null;
    });

    if (!removed) {
      return NextResponse.json(
        { error: "Job product not found" },
        { status: 404 }
      );
    }

    // Stock went back up: re-arm the alert if it is now above the threshold.
    waitUntil(syncLowStockAlerts(shopId, { productIds: [removed], notify: true }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/jobs/[id]/products error:", error);
    return NextResponse.json(
      { error: "Failed to remove product from job" },
      { status: 500 }
    );
  }
}
