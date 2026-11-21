import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Shop sales-tax settings, and the copy of them each job carries.
 *
 * A job keeps its own rate so a settings change never rewrites a bill the
 * customer already paid against. New jobs copy the shop's settings when they
 * are created; saving the settings re-copies them onto open jobs that have no
 * payments yet, since nobody has paid against those bills.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type ShopTaxSettings = {
  salesTaxRatePercent: number;
  taxServices: boolean;
  taxProducts: boolean;
};

export const DEFAULT_TAX_SETTINGS: ShopTaxSettings = {
  salesTaxRatePercent: 0,
  taxServices: false,
  taxProducts: true,
};

export async function getShopTaxSettings(shopId: string, db: Db = prisma): Promise<ShopTaxSettings> {
  const row = await db.appSettings.findUnique({
    where: { shopId },
    select: { salesTaxRatePercent: true, taxServices: true, taxProducts: true },
  });
  if (!row) return DEFAULT_TAX_SETTINGS;
  return {
    salesTaxRatePercent: Number(row.salesTaxRatePercent),
    taxServices: row.taxServices,
    taxProducts: row.taxProducts,
  };
}

/** The job fields that copy the shop's tax settings; spread into job.create data. */
export async function jobTaxFieldsForShop(
  shopId: string,
  db: Db = prisma
): Promise<{ taxRatePercent: number; taxServices: boolean; taxProducts: boolean }> {
  const s = await getShopTaxSettings(shopId, db);
  return { taxRatePercent: s.salesTaxRatePercent, taxServices: s.taxServices, taxProducts: s.taxProducts };
}

/** Stages whose bill can still change without anyone having paid it. */
const CLOSED_STAGES = ["COMPLETED", "CANCELLED"] as const;

export async function updateShopTaxSettings(
  shopId: string,
  next: ShopTaxSettings
): Promise<{ settings: ShopTaxSettings; jobsUpdated: number }> {
  const rate = Math.round(next.salesTaxRatePercent * 1000) / 1000;
  return prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { shopId },
      create: { shopId, salesTaxRatePercent: rate, taxServices: next.taxServices, taxProducts: next.taxProducts },
      update: { salesTaxRatePercent: rate, taxServices: next.taxServices, taxProducts: next.taxProducts },
    });
    const updated = await tx.job.updateMany({
      where: {
        shopId,
        stage: { notIn: [...CLOSED_STAGES] },
        archivedAt: null,
        payments: { none: {} },
      },
      data: { taxRatePercent: rate, taxServices: next.taxServices, taxProducts: next.taxProducts },
    });
    return {
      settings: { salesTaxRatePercent: rate, taxServices: next.taxServices, taxProducts: next.taxProducts },
      jobsUpdated: updated.count,
    };
  });
}
