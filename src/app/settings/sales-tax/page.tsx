"use client";

import { useEffect, useState } from "react";
import { FormSectionSkeleton } from "@/components/ui/Skeleton";

type TaxSettings = { salesTaxRatePercent: number; taxServices: boolean; taxProducts: boolean };

export default function SalesTaxSettingsPage() {
  const [saved, setSaved] = useState<TaxSettings | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [taxServices, setTaxServices] = useState(false);
  const [taxProducts, setTaxProducts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/sales-tax", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as TaxSettings;
        setSaved(data);
        setRateInput(data.salesTaxRatePercent ? String(data.salesTaxRatePercent) : "");
        setTaxServices(data.taxServices);
        setTaxProducts(data.taxProducts);
      })
      .catch(() => setError("Could not load sales tax settings."));
  }, []);

  const rate = rateInput.trim() === "" ? 0 : Number(rateInput);
  const rateValid = Number.isFinite(rate) && rate >= 0 && rate <= 25;
  const dirty =
    saved !== null &&
    (rate !== saved.salesTaxRatePercent || taxServices !== saved.taxServices || taxProducts !== saved.taxProducts);

  async function save() {
    if (!rateValid) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/sales-tax", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesTaxRatePercent: rate, taxServices, taxProducts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setSaved(data.settings as TaxSettings);
      const n = data.jobsUpdated as number;
      setNotice(
        `Saved. New jobs use these settings${
          n > 0 ? `, and ${n} open ${n === 1 ? "job" : "jobs"} with no payments yet ${n === 1 ? "was" : "were"} updated` : ""
        }.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Sales tax</h1>
        <p className="mt-1 text-text-secondary">
          Added to invoices and online payments. Check your state&apos;s rules for whether repair labor is taxable.
        </p>
      </div>

      {!saved && !error ? (
        <FormSectionSkeleton />
      ) : (
        <section className="space-y-4 rounded-xl border border-surface-border bg-surface p-4">
          <div className="rounded-lg border border-surface-border bg-subtle-bg px-3 py-3">
            <label htmlFor="tax-rate" className="block text-sm font-semibold text-foreground">
              Tax rate
            </label>
            <p className="mt-0.5 text-sm text-text-secondary">
              Your combined state and local rate. Leave blank or 0 to charge no sales tax.
            </p>
            <div className="relative mt-2 w-36">
              <input
                id="tax-rate"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={!rateValid}
                className="w-full rounded-lg border border-surface-border bg-background py-2 pl-3 pr-8 text-sm text-foreground"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">%</span>
            </div>
            {!rateValid && <p className="mt-1 text-sm text-red-600">Enter a rate between 0 and 25.</p>}
          </div>

          <div className="rounded-lg border border-surface-border bg-subtle-bg px-3 py-3">
            <p className="text-sm font-semibold text-foreground">What&apos;s taxed</p>
            <label className="mt-2 flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" className="mt-0.5" checked={taxProducts} onChange={(e) => setTaxProducts(e.target.checked)} />
              <span>
                Parts and products
                <span className="block text-text-secondary">Items from your product catalog.</span>
              </span>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" className="mt-0.5" checked={taxServices} onChange={(e) => setTaxServices(e.target.checked)} />
              <span>
                Labor and services
                <span className="block text-text-secondary">Services, custom labor lines, and the collection fee.</span>
              </span>
            </label>
          </div>

          <p className="text-sm text-text-secondary">
            Changes apply to new jobs and to open jobs that haven&apos;t taken a payment yet. Jobs that have
            already been paid keep the tax they were charged. You can mark a single job tax-exempt from its invoice.
          </p>

          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !dirty || !rateValid}
              className={`h-10 rounded-lg px-4 text-sm font-semibold transition-colors ${
                saving || !dirty || !rateValid
                  ? "cursor-not-allowed bg-surface-border text-text-muted"
                  : "bg-amber-600 text-white hover:bg-amber-700"
              }`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
