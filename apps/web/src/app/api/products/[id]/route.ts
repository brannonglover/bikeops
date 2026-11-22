import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { ProductPricingError, resolveProductPricing } from "@/lib/product-pricing";

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  /** A hand-set price. Sent without `cost`, it stops the product pricing from cost. */
  price: z.number().min(0).optional(),
  /** What the shop pays; null switches the product to a hand-set price. */
  cost: z.number().min(0).nullable().optional(),
  /** Overrides the shop's markup; null follows the shop's. */
  markupPercent: z.number().min(0).max(1000).nullable().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  supplier: z.string().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const body = await request.json();
    const data = updateProductSchema.parse(body);
    const existing = await prisma.product.findFirst({
      where: { id, shopId: auth.shopId },
      select: { id: true, price: true, cost: true, markupPercent: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    const imageUrl =
      data.imageUrl !== undefined ? (data.imageUrl?.trim() || null) : undefined;
    const supplier =
      data.supplier !== undefined ? (data.supplier?.trim() || null) : undefined;

    const pricingTouched =
      data.price !== undefined || data.cost !== undefined || data.markupPercent !== undefined;
    const pricing = pricingTouched
      ? await resolveProductPricing(auth.shopId, {
          cost:
            data.cost !== undefined
              ? data.cost
              : data.price !== undefined || existing.cost === null
                ? null
                : Number(existing.cost),
          markupPercent:
            data.markupPercent !== undefined
              ? data.markupPercent
              : existing.markupPercent === null
                ? null
                : Number(existing.markupPercent),
          price: data.price ?? Number(existing.price),
        })
      : null;

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(pricing ?? {}),
        ...(data.stockQuantity !== undefined && { stockQuantity: data.stockQuantity }),
        ...(supplier !== undefined && { supplier }),
      },
    });

    return NextResponse.json(product);
  } catch (error) {
    if (error instanceof ProductPricingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/products/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const { count } = await prisma.product.deleteMany({ where: { id, shopId: auth.shopId } });
    if (count === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/products/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete product" },
      { status: 500 }
    );
  }
}
