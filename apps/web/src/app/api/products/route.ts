import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { syncLowStockAlerts } from "@/lib/low-stock";
import { ProductPricingError, resolveProductPricing } from "@/lib/product-pricing";

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable().transform((v) => (v?.trim() ? v : null)),
  /** What the shop pays; the price is worked out as cost plus markup. */
  cost: z.number().min(0, "Cost must be 0 or greater").nullable().optional(),
  /** Overrides the shop's markup for this product. */
  markupPercent: z.number().min(0).max(1000).nullable().optional(),
  /** A hand-set price, used only when no cost is given. */
  price: z.number().min(0, "Price must be 0 or greater").optional(),
  stockQuantity: z.number().int().min(0).optional().default(0),
  lowStockThreshold: z.number().int().min(0).nullable().optional(),
  supplier: z.string().optional().nullable().transform((v) => (v?.trim() ? v : null)),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;
    const shop = auth.shop;
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";

    const products = await prisma.product.findMany({
      where: q
        ? {
            shopId: shop.id,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { supplier: { contains: q, mode: "insensitive" } },
            ],
          }
        : { shopId: shop.id },
      orderBy: { name: "asc" },
    });
    const res = NextResponse.json(products);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    console.error("GET /api/products error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;
    const shop = auth.shop;
    const body = await request.json();
    const data = createProductSchema.parse(body);

    const pricing = await resolveProductPricing(shop.id, {
      cost: data.cost ?? null,
      markupPercent: data.markupPercent ?? null,
      price: data.price ?? null,
    });

    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        name: data.name,
        description: data.description ?? null,
        imageUrl: data.imageUrl ?? null,
        ...pricing,
        stockQuantity: data.stockQuantity,
        lowStockThreshold: data.lowStockThreshold ?? null,
        supplier: data.supplier ?? null,
      },
    });
    if (product.lowStockThreshold != null) {
      await syncLowStockAlerts(shop.id, { productIds: [product.id], notify: false });
    }

    return NextResponse.json(product);
  } catch (error) {
    if (error instanceof ProductPricingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      const flattened = error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors ?? {})
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean).map((m) => `${field}: ${m}`)
        );
      return NextResponse.json(
        { error: fieldErrors.join("; ") },
        { status: 400 }
      );
    }
    console.error("POST /api/products error:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 }
    );
  }
}
