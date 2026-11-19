import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { getShopTaxSettings, updateShopTaxSettings } from "@/lib/sales-tax";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  salesTaxRatePercent: z.number().min(0).max(25),
  taxServices: z.boolean(),
  taxProducts: z.boolean(),
});

export async function GET(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getShopTaxSettings(auth.shopId));
}

/** Saves the settings and re-copies them onto open jobs nobody has paid against yet. */
export async function PUT(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;
  try {
    const data = updateSchema.parse(await request.json());
    return NextResponse.json(await updateShopTaxSettings(auth.shopId, data));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Enter a tax rate between 0% and 25%." }, { status: 400 });
    }
    console.error("PUT /api/settings/sales-tax error:", error);
    return NextResponse.json({ error: "Failed to save sales tax settings" }, { status: 500 });
  }
}
