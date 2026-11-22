import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { syncLowStockAlerts } from "@/lib/low-stock";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getRequestShop } from "@/lib/api-auth";
import { hasJobReadAccess, hasStaffJobAccess } from "@/lib/job-customer-access";
import {
  EstimateError,
  notifyEstimateResponse,
  publishEstimateJobEvent,
  respondToEstimate,
  serializeEstimate,
} from "@/lib/job-estimates";

const respondSchema = z.object({
  decisions: z.record(z.string().min(1), z.enum(["APPROVED", "DECLINED"])),
  comment: z.string().max(1000).nullable().optional(),
});

/**
 * The customer's answer, from the tracking link (or a signed-in customer).
 * Staff can also record an answer given by phone or at the counter.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; estimateId: string } }
) {
  try {
    const shop = await getRequestShop(request);
    if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

    const job = await prisma.job.findFirst({
      where: { id: params.id, shopId: shop.id },
      select: { id: true, customerId: true },
    });
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    if (!(await hasJobReadAccess(request, shop.id, job.id, job.customerId))) {
      return NextResponse.json({ error: "access_required" }, { status: 403 });
    }
    const byStaff = await hasStaffJobAccess(request, shop.id);

    const data = respondSchema.parse(await request.json());
    const { estimate, stageChanged } = await respondToEstimate({
      shopId: shop.id,
      jobId: job.id,
      estimateId: params.estimateId,
      decisions: data.decisions,
      comment: data.comment,
      byStaff,
    });
    await publishEstimateJobEvent(shop.id, job.id, stageChanged);
    // Approved product lines came off the shelf.
    waitUntil(syncLowStockAlerts(shop.id, { notify: true }));
    waitUntil(
      notifyEstimateResponse(estimate).catch((e) =>
        console.error("[estimate] response notification failed:", e)
      )
    );

    return NextResponse.json({ estimate: serializeEstimate(estimate), stageChanged });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid response", details: error.flatten() }, { status: 400 });
    }
    if (error instanceof EstimateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("POST /api/jobs/[id]/estimates/[estimateId]/respond error:", error);
    return NextResponse.json({ error: "Failed to save your response" }, { status: 500 });
  }
}
