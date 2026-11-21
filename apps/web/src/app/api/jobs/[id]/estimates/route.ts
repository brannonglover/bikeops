import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getRequestShop, requireStaffShop } from "@/lib/api-auth";
import { hasJobReadAccess, hasStaffJobAccess } from "@/lib/job-customer-access";
import {
  EstimateError,
  createEstimate,
  deliverEstimate,
  listJobEstimates,
  publishEstimateJobEvent,
  serializeEstimate,
} from "@/lib/job-estimates";

type Params = { params: { id: string } };

/** Staff, or the customer holding the job's tracking link. Customers don't see withdrawn estimates. */
export async function GET(request: NextRequest, { params }: Params) {
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

    const isStaff = await hasStaffJobAccess(request, shop.id);
    const estimates = await listJobEstimates(shop.id, job.id);
    const res = NextResponse.json({
      estimates: isStaff ? estimates : estimates.filter((e) => e.status !== "CANCELLED"),
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    console.error("GET /api/jobs/[id]/estimates error:", error);
    return NextResponse.json({ error: "Failed to load estimates" }, { status: 500 });
  }
}

const quantity = z.number().int().min(1).max(999).optional();
const unitPrice = z.number().min(0).max(100000);
const jobBikeId = z.string().min(1).nullable().optional();

const itemSchema = z.union([
  z.object({ serviceId: z.string().min(1), quantity, unitPrice: unitPrice.optional(), jobBikeId }),
  z.object({ productId: z.string().min(1), quantity, unitPrice: unitPrice.optional(), jobBikeId }),
  z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    unitPrice,
    quantity,
    jobBikeId,
  }),
]);

const createSchema = z.object({
  message: z.string().max(2000).nullable().optional(),
  items: z.array(itemSchema).min(1).max(50),
  waitOnCustomer: z.boolean().optional().default(true),
});

/** Staff: create an estimate and send it to the customer. */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const data = createSchema.parse(await request.json());
    const { estimate, stageChanged } = await createEstimate({
      shopId: auth.shopId,
      jobId: params.id,
      message: data.message,
      items: data.items,
      waitOnCustomer: data.waitOnCustomer,
    });
    await publishEstimateJobEvent(auth.shopId, params.id, stageChanged);

    // Awaited so staff see which channels actually reached the customer.
    const delivery = await deliverEstimate(estimate).catch((e) => {
      console.error("[estimate] delivery failed:", e);
      return null;
    });
    const fresh = await prisma.jobEstimate.findUniqueOrThrow({
      where: { id: estimate.id },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    return NextResponse.json({ estimate: serializeEstimate(fresh), delivery, stageChanged });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid estimate", details: error.flatten() }, { status: 400 });
    }
    if (error instanceof EstimateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("POST /api/jobs/[id]/estimates error:", error);
    return NextResponse.json({ error: "Failed to send estimate" }, { status: 500 });
  }
}
