"use client";

import { useCallback, useEffect, useState } from "react";
import type { SerializedEstimate } from "@/lib/job-estimates";
import { jobAccessApiSuffix } from "@/lib/job-access-url";

type Decision = "APPROVED" | "DECLINED";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Customer view of an estimate on the tracking page: approve or decline each
 * item, then send. Renders nothing when there is no estimate waiting.
 */
export function EstimateApprovalCard({
  jobId,
  jobAccess,
  bikeNames,
  onOpenChange,
  onAnswered,
}: {
  jobId: string;
  jobAccess: string | null;
  /** jobBikeId → display name, for multi-bike jobs. */
  bikeNames: Record<string, string>;
  onOpenChange?: (hasOpenEstimate: boolean) => void;
  onAnswered?: () => void;
}) {
  const [estimate, setEstimate] = useState<SerializedEstimate | null>(null);
  const [answered, setAnswered] = useState<SerializedEstimate | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/estimates${jobAccessApiSuffix(jobAccess)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { estimates: SerializedEstimate[] };
      const open = data.estimates.find((e) => e.status === "SENT") ?? null;
      setEstimate(open);
      onOpenChange?.(Boolean(open));
    } catch {
      // The rest of the tracking page still works without estimates.
    }
  }, [jobId, jobAccess, onOpenChange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (estimate && typeof window !== "undefined" && window.location.hash === "#estimate") {
      document.getElementById("estimate")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [estimate]);

  if (answered) {
    const approved = answered.items.filter((i) => i.decision === "APPROVED");
    return (
      <section id="estimate" className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm" role="status">
        <h2 className="text-base font-semibold text-emerald-900">Thanks, we&apos;ve got your answer</h2>
        <p className="mt-1 text-sm text-emerald-800">
          {approved.length === 0
            ? "You declined the estimate, so nothing was added to your bill. The shop will be in touch if anything changes."
            : `${money(answered.approvedTotal)} of approved work was added to your bill, and the shop has been notified.`}
        </p>
      </section>
    );
  }

  if (!estimate) return null;

  const decidedCount = estimate.items.filter((i) => decisions[i.id]).length;
  const allDecided = decidedCount === estimate.items.length;
  const approvedTotal = estimate.items
    .filter((i) => decisions[i.id] === "APPROVED")
    .reduce((sum, i) => sum + i.lineTotal, 0);

  const setAll = (d: Decision) =>
    setDecisions(Object.fromEntries(estimate.items.map((i) => [i.id, d])));

  async function submit() {
    if (!estimate || !allDecided) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/jobs/${jobId}/estimates/${estimate.id}/respond${jobAccessApiSuffix(jobAccess)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions, comment: comment.trim() || null }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again or contact the shop.");
        if (res.status === 409) void load();
        return;
      }
      setAnswered(data.estimate as SerializedEstimate);
      onOpenChange?.(false);
      onAnswered?.();
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="estimate" className="rounded-xl border-2 border-violet-300 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Your approval needed</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Estimate for recommended work</h2>
        </div>
        <span className="text-right">
          <span className="block text-xs text-slate-500">Estimate total</span>
          <span className="text-lg font-bold tabular-nums text-slate-900">{money(estimate.total)}</span>
        </span>
      </div>

      {estimate.message && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-violet-50 px-3 py-2 text-sm text-slate-700">
          {estimate.message}
        </p>
      )}

      <p className="mt-3 text-sm text-slate-600">
        Approve or decline each item. Nothing is added to your bill unless you approve it.
      </p>

      <div className="mt-3 flex gap-2 text-sm">
        <button
          type="button"
          onClick={() => setAll("APPROVED")}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
        >
          Approve all
        </button>
        <button
          type="button"
          onClick={() => setAll("DECLINED")}
          className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
        >
          Decline all
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {estimate.items.map((item) => {
          const d = decisions[item.id];
          const bike = item.jobBikeId ? bikeNames[item.jobBikeId] : null;
          return (
            <li
              key={item.id}
              className={`rounded-xl border p-3 transition-colors ${
                d === "APPROVED"
                  ? "border-emerald-300 bg-emerald-50/60"
                  : d === "DECLINED"
                    ? "border-slate-200 bg-slate-50"
                    : "border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${d === "DECLINED" ? "text-slate-500 line-through" : "text-slate-900"}`}>
                    {item.name}
                    {item.quantity > 1 && <span className="font-normal text-slate-500"> × {item.quantity}</span>}
                  </p>
                  {bike && <p className="text-xs text-slate-500">{bike}</p>}
                  {item.description && (
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-500">{item.description}</p>
                  )}
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-900">{money(item.lineTotal)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={`Decision for ${item.name}`}>
                <button
                  type="button"
                  aria-pressed={d === "APPROVED"}
                  onClick={() => setDecisions((prev) => ({ ...prev, [item.id]: "APPROVED" }))}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    d === "APPROVED"
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-emerald-50"
                  }`}
                >
                  Approve
                </button>
                <button
                  type="button"
                  aria-pressed={d === "DECLINED"}
                  onClick={() => setDecisions((prev) => ({ ...prev, [item.id]: "DECLINED" }))}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    d === "DECLINED"
                      ? "bg-slate-700 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  Decline
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <label htmlFor="estimate-comment" className="mt-4 block text-sm font-medium text-slate-700">
        Anything to tell the shop? <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <textarea
        id="estimate-comment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={1000}
        rows={2}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!allDecided || submitting}
        onClick={() => void submit()}
        className="mt-4 w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
      >
        {submitting
          ? "Sending…"
          : !allDecided
            ? `Choose for each item (${decidedCount} of ${estimate.items.length})`
            : approvedTotal > 0
              ? `Send answer · approve ${money(approvedTotal)}`
              : "Send answer · decline all"}
      </button>
    </section>
  );
}
