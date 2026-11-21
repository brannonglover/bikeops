import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { computeJobTotals } from "@/lib/job-payments";
import { publishJobEvent } from "@/lib/realtime/publish-job-event";
import { jobTaxFieldsForShop } from "@/lib/sales-tax";

const pricingSchema = z
  .object({
    /** null removes the discount. */
    discountType: z.enum(["AMOUNT", "PERCENT"]).nullable().optional(),
    discountValue: z.number().min(0).max(100000).optional(),
    discountReason: z.string().trim().max(200).nullable().optional(),
    taxExempt: z.boolean().optional(),
    /** Copy the shop's current tax settings onto this job. */
    applyShopTax: z.boolean().optional(),
  })
  .refine((d) => !(d.discountType === "PERCENT" && (d.discountValue ?? 0) > 100), {
    message: "A percent discount can't be more than 100%.",
    path: ["discountValue"],
  });

/** Staff: set a job's discount and tax treatment. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const data = pricingSchema.parse(await request.json());
    const existing = await prisma.job.findFirst({
      where: { id: params.id, shopId: auth.shopId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const update: Record<string, unknown> = {};
    if (data.discountType !== undefined) {
      update.discountType = data.discountType;
      update.discountValue = data.discountType ? Math.round((data.discountValue ?? 0) * 100) / 100 : 0;
      update.discountReason = data.discountType ? data.discountReason?.trim() || null : null;
    } else if (data.discountReason !== undefined) {
      update.discountReason = data.discountReason?.trim() || null;
    }
    if (data.taxExempt !== undefined) update.taxExempt = data.taxExempt;
    if (data.applyShopTax) Object.assign(update, await jobTaxFieldsForShop(auth.shopId));

    const job = await prisma.job.update({
      where: { id: params.id, shopId: auth.shopId },
      data: update,
      include: { jobServices: true, jobProducts: true },
    });
    await publishJobEvent("job:updated", { jobId: job.id, shopId: auth.shopId });
    return NextResponse.json({ totals: computeJobTotals(job) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid pricing", details: error.flatten() },
        { status: 400 }
      );
    }
    console.error("PATCH /api/jobs/[id]/pricing error:", error);
    return NextResponse.json({ error: "Failed to update pricing" }, { status: 500 });
  }
}
