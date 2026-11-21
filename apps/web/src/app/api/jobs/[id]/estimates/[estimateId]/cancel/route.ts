import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import {
  EstimateError,
  cancelEstimate,
  publishEstimateJobEvent,
  serializeEstimate,
} from "@/lib/job-estimates";

/** Staff: withdraw an estimate the customer hasn't answered. */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; estimateId: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { estimate, stageChanged } = await cancelEstimate({
      shopId: auth.shopId,
      jobId: params.id,
      estimateId: params.estimateId,
    });
    await publishEstimateJobEvent(auth.shopId, params.id, stageChanged);
    return NextResponse.json({ estimate: serializeEstimate(estimate), stageChanged });
  } catch (error) {
    if (error instanceof EstimateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("POST /api/jobs/[id]/estimates/[estimateId]/cancel error:", error);
    return NextResponse.json({ error: "Failed to withdraw estimate" }, { status: 500 });
  }
}
