import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { MERGE_TRANSACTION_OPTIONS, mergeCustomerInto } from "@/lib/customer-merge";

const mergeSchema = z.object({
  sourceCustomerId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;
  const { shopId } = auth;

  try {
    const { id: targetId } = await params;
    const body = await request.json();
    const { sourceCustomerId } = mergeSchema.parse(body);

    if (sourceCustomerId === targetId) {
      return NextResponse.json(
        { error: "Cannot merge a customer into themselves" },
        { status: 400 }
      );
    }

    // Both must be this shop's customers; another shop's id is "not found".
    // mergeCustomerInto checks again under a row lock, so a merge that already
    // ran (a double tap, a retry) finds the source gone and changes nothing.
    const outcome = await prisma.$transaction(
      (tx) => mergeCustomerInto(tx, shopId, targetId, sourceCustomerId),
      MERGE_TRANSACTION_OPTIONS
    );

    if (outcome === "target-missing") {
      return NextResponse.json(
        { error: "Target customer not found" },
        { status: 404 }
      );
    }
    if (outcome === "source-missing") {
      return NextResponse.json(
        { error: "Source customer not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "sourceCustomerId is required" },
        { status: 400 }
      );
    }
    console.error("POST /api/customers/[id]/merge error:", error);
    return NextResponse.json(
      { error: "Failed to merge customers" },
      { status: 500 }
    );
  }
}
