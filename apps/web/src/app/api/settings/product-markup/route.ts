import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { getShopProductMarkup, updateShopProductMarkup } from "@/lib/product-pricing";

export const dynamic = "force-dynamic";

const updateSchema = z.object({ markupPercent: z.number().min(0).max(1000) });

export async function GET(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ markupPercent: await getShopProductMarkup(auth.shopId) });
}

/** Saves the shop markup and re-prices products that price from cost and follow it. */
export async function PUT(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;
  try {
    const { markupPercent } = updateSchema.parse(await request.json());
    return NextResponse.json(await updateShopProductMarkup(auth.shopId, markupPercent));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter a markup between 0% and 1000%." }, { status: 400 });
    }
    console.error("PUT /api/settings/product-markup error:", error);
    return NextResponse.json({ error: "Failed to save markup" }, { status: 500 });
  }
}
