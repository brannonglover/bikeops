"use client";

import { catalogChipCounts } from "@/lib/catalog-chips";

/**
 * A row of filter chips (All, Tubes, Tires, Bearings, …) above the Products
 * and Services lists. Only chips that match at least one of `texts` show.
 */
export function CatalogChips({
  texts,
  selected,
  onSelect,
}: {
  /** One searchable string per item in the list. */
  texts: readonly string[];
  selected: string | null;
  onSelect: (chipId: string | null) => void;
}) {
  const chips = catalogChipCounts(texts, selected);
  if (chips.length === 0) return null;

  const base =
    "flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors";
  const on = "border-emerald-600 bg-emerald-600 text-white";
  const off = "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";

  return (
    <div
      role="group"
      aria-label="Filter by category"
      className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
    >
      <button
        type="button"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
        className={`${base} ${selected === null ? on : off}`}
      >
        All
      </button>
      {chips.map(({ chip, count }) => {
        const active = selected === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? null : chip.id)}
            className={`${base} ${active ? on : off}`}
          >
            {chip.label}
            <span className={active ? "text-emerald-100" : "text-slate-400"}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
