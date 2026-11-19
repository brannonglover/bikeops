"use client";

import { useState } from "react";
import type { Job } from "@/lib/types";
import type { JobTotals } from "@/lib/job-payments";
import { Price } from "@/components/ui/Price";

/**
 * Subtotal, discount and sales-tax rows above the invoice total, with staff
 * controls to set a discount, mark the job tax-exempt, or re-apply the shop's
 * current tax settings.
 */
export function InvoicePricingRows({
  job,
  totals,
  onJobUpdated,
}: {
  job: Job;
  totals: JobTotals;
  onJobUpdated: (job: Job) => void;
}) {
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">(job.discountType ?? "AMOUNT");
  const [discountValue, setDiscountValue] = useState(
    job.discountType ? String(Number(job.discountValue ?? 0)) : ""
  );
  const [discountReason, setDiscountReason] = useState(job.discountReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/pricing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not update the invoice");
      const jobRes = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
      if (jobRes.ok) onJobUpdated((await jobRes.json()) as Job);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the invoice");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDiscount() {
    const value = parseFloat(discountValue);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a discount greater than zero.");
      return;
    }
    if (discountType === "PERCENT" && value > 100) {
      setError("A percent discount can't be more than 100%.");
      return;
    }
    const ok = await patch({ discountType, discountValue: value, discountReason: discountReason.trim() || null });
    if (ok) setEditingDiscount(false);
  }

  const rate = Number(job.taxRatePercent ?? 0);
  const hasDiscount = totals.discount > 0;
  const showSubtotal = hasDiscount || totals.tax > 0;

  return (
    <div className="space-y-1.5 border-t-2 border-slate-200 pt-4 mt-4 text-sm">
      {showSubtotal && (
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-slate-600">Subtotal</span>
          <Price amount={totals.itemsTotal} variant="inline" className="text-slate-700" />
        </div>
      )}

      {editingDiscount ? (
        <div className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs font-semibold">
              {(["AMOUNT", "PERCENT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={discountType === t}
                  onClick={() => setDiscountType(t)}
                  className={`rounded-md px-2.5 py-1 ${discountType === t ? "bg-slate-900 text-white" : "text-slate-600"}`}
                >
                  {t === "AMOUNT" ? "$ off" : "% off"}
                </button>
              ))}
            </span>
            <input
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              inputMode="decimal"
              placeholder={discountType === "AMOUNT" ? "10.00" : "10"}
              aria-label="Discount"
              className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right"
            />
            <input
              value={discountReason}
              onChange={(e) => setDiscountReason(e.target.value)}
              maxLength={200}
              placeholder="Reason (optional, shown to customer)"
              aria-label="Discount reason"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDiscount()}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Apply discount
            </button>
            {hasDiscount && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await patch({ discountType: null })) {
                    setEditingDiscount(false);
                    setDiscountValue("");
                    setDiscountReason("");
                  }
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Remove discount
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditingDiscount(false);
                setError(null);
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : hasDiscount ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setEditingDiscount(true)}
            className="min-w-0 truncate text-left font-medium text-slate-600 hover:text-blue-600"
          >
            Discount
            {job.discountType === "PERCENT" && ` (${Number(job.discountValue)}%)`}
            {job.discountReason && <span className="font-normal text-slate-400"> · {job.discountReason}</span>}
          </button>
          <span className="font-medium tabular-nums text-emerald-700">−${totals.discount.toFixed(2)}</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditingDiscount(true)}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          + Add discount
        </button>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-slate-600">
          {job.taxExempt ? "Sales tax (exempt)" : rate > 0 ? `Sales tax (${rate}%)` : "Sales tax"}
          <span className="ml-2 inline-flex gap-2 text-xs font-semibold">
            {rate > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patch({ taxExempt: !job.taxExempt })}
                className="text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                {job.taxExempt ? "Charge tax" : "Mark exempt"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ applyShopTax: true })}
              title="Copy the rate and taxed items from Settings → Sales tax onto this job"
              className="text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Use shop rate
            </button>
          </span>
        </span>
        <Price amount={totals.tax} variant="inline" className="text-slate-700" />
      </div>

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
