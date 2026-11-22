"use client";

import { useEffect, useState } from "react";
import { priceFromCost } from "@/lib/product-price";

export type PricingMode = "cost" | "fixed";

/** "" means "use the shop's markup". */
export function effectiveMarkup(markupInput: string, shopMarkup: number): number {
  const n = parseFloat(markupInput);
  return markupInput.trim() !== "" && Number.isFinite(n) ? n : shopMarkup;
}

/**
 * Cost + markup fields for the add and edit product forms. A product priced
 * before markup existed is in "fixed" mode: its price is charged as entered
 * until staff switch it to pricing from cost.
 */
export function ProductPricingFields({
  mode,
  cost,
  markup,
  fixedPrice,
  shopMarkup,
  onModeChange,
  onCostChange,
  onMarkupChange,
  onFixedPriceChange,
}: {
  mode: PricingMode;
  cost: string;
  markup: string;
  fixedPrice: string;
  shopMarkup: number;
  onModeChange?: (mode: PricingMode) => void;
  onCostChange: (v: string) => void;
  onMarkupChange: (v: string) => void;
  onFixedPriceChange?: (v: string) => void;
}) {
  if (mode === "fixed") {
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={fixedPrice}
          onChange={(e) => onFixedPriceChange?.(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
        />
        <p className="mt-1 text-xs text-slate-500">
          This product was priced by hand, so customers pay exactly this.{" "}
          {onModeChange && (
            <button
              type="button"
              onClick={() => onModeChange("cost")}
              className="font-semibold text-emerald-700 hover:underline"
            >
              Price it from cost + markup instead
            </button>
          )}
        </p>
      </div>
    );
  }

  const costNum = parseFloat(cost);
  const markupPct = effectiveMarkup(markup, shopMarkup);
  const customerPrice = Number.isFinite(costNum) ? priceFromCost(costNum, markupPct) : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Your cost ($)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={(e) => onCostChange(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          placeholder="0.00"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Markup (%) <span className="font-normal text-slate-400">optional</span>
        </label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={markup}
          onChange={(e) => onMarkupChange(e.target.value)}
          className="w-full px-4 py-2 border border-slate-300 rounded-lg"
          placeholder={`${shopMarkup}% (shop default)`}
        />
      </div>
      <p className="sm:col-span-2 text-sm text-slate-600">
        {customerPrice === null ? (
          "Enter your cost to see what customers pay."
        ) : (
          <>
            Customers pay <span className="font-semibold text-emerald-700">${customerPrice.toFixed(2)}</span>
            <span className="text-slate-500">
              {" "}
              (${costNum.toFixed(2)} + {markupPct}%
              {markup.trim() === "" ? ", the shop default" : ", this product only"})
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/** The shop-wide markup, editable from the Products page header. */
export function ShopMarkupControl({
  markup,
  onSaved,
}: {
  markup: number;
  onSaved: (markup: number, productsRepriced: number) => void;
}) {
  const [value, setValue] = useState(String(markup));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setValue(String(markup)), [markup]);

  const n = parseFloat(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1000;
  const dirty = valid && n !== markup;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/product-markup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markupPercent: n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save markup");
      onSaved(data.markupPercent, data.productsRepriced);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save markup");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
      <label htmlFor="shop-markup" className="text-sm font-semibold text-slate-800">
        Your markup on parts
      </label>
      <div className="relative w-24">
        <input
          id="shop-markup"
          type="number"
          step="0.1"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && void save()}
          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-7 text-sm"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
      </div>
      <button
        type="button"
        onClick={() => void save()}
        disabled={!dirty || saving}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <p className="basis-full text-xs text-slate-600">
        Added to your cost to set what customers pay. Changing it re-prices every product that uses the
        shop default; products with their own markup or a hand-set price stay as they are. Jobs already
        open keep the price they were quoted.
      </p>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
