"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job } from "@/lib/types";
import type { SerializedEstimate } from "@/lib/job-estimates";
import { Price } from "@/components/ui/Price";

type CatalogEntry = { id: string; name: string; price: number };

type DraftItem = {
  key: string;
  source: "service" | "product" | "custom";
  refId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  jobBikeId: string | null;
};

const CLOSED_STAGES = new Set(["COMPLETED", "CANCELLED"]);

function toNumber(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deliveryLabel(e: SerializedEstimate): string {
  const channels = [e.sentByPush && "app", e.sentBySms && "text", e.sentByEmail && "email"].filter(
    Boolean
  ) as string[];
  return channels.length ? `by ${channels.join(", ")}` : "";
}

function bikeName(job: Job, jobBikeId: string | null): string | null {
  if (!jobBikeId || (job.jobBikes?.length ?? 0) < 2) return null;
  const b = job.jobBikes?.find((x) => x.id === jobBikeId);
  if (!b) return null;
  return b.nickname?.trim() || [b.make, b.model].filter(Boolean).join(" ");
}

let draftSeq = 0;
const nextKey = () => `d${++draftSeq}`;

export function EstimateTab({ job, onJobUpdated }: { job: Job; onJobUpdated?: (job: Job) => void }) {
  const [estimates, setEstimates] = useState<SerializedEstimate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const bikes = job.jobBikes ?? [];
  const multiBike = bikes.length > 1;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${job.id}/estimates`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not load estimates");
      setEstimates(data.estimates as SerializedEstimate[]);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load estimates");
    }
  }, [job.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshJob = useCallback(async () => {
    const res = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
    if (res.ok) onJobUpdated?.((await res.json()) as Job);
  }, [job.id, onJobUpdated]);

  const open = estimates?.find((e) => e.status === "SENT") ?? null;
  const past = estimates?.filter((e) => e.status !== "SENT") ?? [];

  async function copyLink() {
    try {
      const res = await fetch(`/api/jobs/${job.id}/customer-links`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.statusUrl !== "string") throw new Error();
      await navigator.clipboard.writeText(data.statusUrl);
      setNotice({ tone: "ok", text: "Estimate link copied." });
    } catch {
      setNotice({ tone: "error", text: "Could not copy the link." });
    }
  }

  async function withdraw(estimate: SerializedEstimate) {
    if (!window.confirm("Withdraw this estimate? The customer will no longer be able to approve it.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/estimates/${estimate.id}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not withdraw the estimate");
      setNotice({ tone: "ok", text: "Estimate withdrawn." });
      await Promise.all([load(), refreshJob()]);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Could not withdraw the estimate" });
    } finally {
      setBusy(false);
    }
  }

  async function recordAnswer(estimate: SerializedEstimate, decisions: Record<string, "APPROVED" | "DECLINED">) {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/estimates/${estimate.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the answer");
      const answered = data.estimate as SerializedEstimate;
      setNotice({
        tone: "ok",
        text:
          answered.approvedTotal > 0
            ? `Saved. ${answered.items.filter((i) => i.decision === "APPROVED").length} approved item(s) added to the invoice.`
            : "Saved. Nothing was added to the invoice.",
      });
      await Promise.all([load(), refreshJob()]);
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Could not save the answer" });
    } finally {
      setBusy(false);
    }
  }

  async function send(draft: { items: DraftItem[]; message: string; waitOnCustomer: boolean }) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/estimates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft.message.trim() || null,
          waitOnCustomer: draft.waitOnCustomer,
          items: draft.items.map((i) => {
            const common = { quantity: i.quantity, unitPrice: i.unitPrice, jobBikeId: i.jobBikeId };
            if (i.source === "service") return { serviceId: i.refId, ...common };
            if (i.source === "product") return { productId: i.refId, ...common };
            return { name: i.name, ...common };
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send the estimate");
      const d = data.delivery as
        | { sms: boolean; email: boolean; push: boolean; notSentReason: string | null }
        | null;
      const channels = d
        ? ([d.push && "app", d.sms && "text", d.email && "email"].filter(Boolean) as string[])
        : [];
      setNotice(
        d && (d.sms || d.email)
          ? { tone: "ok", text: `Estimate sent by ${channels.join(" and ")}.` }
          : {
              tone: "warn",
              text: `Estimate saved, but it wasn't sent: ${
                d?.notSentReason ?? "delivery failed."
              } Copy the customer link and send it yourself.`,
            }
      );
      await Promise.all([load(), refreshJob()]);
      return true;
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Could not send the estimate" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {loadError}{" "}
        <button type="button" className="font-semibold underline" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!estimates) {
    return <p className="text-sm text-slate-500">Loading estimates…</p>;
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : notice.tone === "warn"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {notice.text}
        </div>
      )}

      {open ? (
        <OpenEstimate
          job={job}
          estimate={open}
          busy={busy}
          onCopyLink={copyLink}
          onWithdraw={() => void withdraw(open)}
          onRecord={(decisions) => void recordAnswer(open, decisions)}
        />
      ) : job.stage === "PENDING_APPROVAL" ? (
        <p className="text-sm text-slate-500">Confirm the booking before sending an estimate.</p>
      ) : CLOSED_STAGES.has(job.stage) ? (
        <p className="text-sm text-slate-500">This job is closed, so estimates can&apos;t be sent.</p>
      ) : (
        <EstimateBuilder
          job={job}
          multiBike={multiBike}
          busy={busy}
          alreadyWaiting={job.stage === "WAITING_ON_CUSTOMER"}
          hasCustomer={Boolean(job.customerId)}
          onSend={send}
        />
      )}

      {past.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Past estimates</h3>
          <ul className="space-y-3">
            {past.map((e) => (
              <li key={e.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-800">
                    {e.status === "CANCELLED"
                      ? "Withdrawn"
                      : e.approvedTotal > 0
                        ? `Approved ${e.items.filter((i) => i.decision === "APPROVED").length} of ${e.items.length}`
                        : "Declined"}
                    {e.respondedByStaff && <span className="text-slate-500"> · recorded by staff</span>}
                  </span>
                  <span className="text-slate-500">
                    Sent {formatWhen(e.sentAt)}
                    {e.respondedAt && ` · answered ${formatWhen(e.respondedAt)}`}
                  </span>
                </div>
                {e.customerComment && (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    &ldquo;{e.customerComment}&rdquo;
                  </p>
                )}
                <ul className="mt-2 space-y-1 text-sm">
                  {e.items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <DecisionBadge decision={e.status === "CANCELLED" ? "PENDING" : i.decision} />
                        <span className={`truncate ${i.decision === "DECLINED" ? "text-slate-500" : "text-slate-700"}`}>
                          {i.name}
                          {i.quantity > 1 && <span className="text-slate-400"> × {i.quantity}</span>}
                        </span>
                      </span>
                      <span className="tabular-nums text-slate-600">${i.lineTotal.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
                {e.items.some((i) => i.decision === "DECLINED") && e.status === "RESPONDED" && (
                  <p className="mt-2 text-xs text-slate-500">
                    Declined items are kept here as recommended work for a future visit.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DecisionBadge({ decision }: { decision: "PENDING" | "APPROVED" | "DECLINED" }) {
  if (decision === "APPROVED") {
    return (
      <span className="inline-flex flex-shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        Approved
      </span>
    );
  }
  if (decision === "DECLINED") {
    return (
      <span className="inline-flex flex-shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
        Declined
      </span>
    );
  }
  return (
    <span className="inline-flex flex-shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
      —
    </span>
  );
}

function OpenEstimate({
  job,
  estimate,
  busy,
  onCopyLink,
  onWithdraw,
  onRecord,
}: {
  job: Job;
  estimate: SerializedEstimate;
  busy: boolean;
  onCopyLink: () => void;
  onWithdraw: () => void;
  onRecord: (decisions: Record<string, "APPROVED" | "DECLINED">) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, "APPROVED" | "DECLINED">>({});
  const delivered = deliveryLabel(estimate);
  const allDecided = estimate.items.every((i) => decisions[i.id]);

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-violet-900">Waiting on the customer</h3>
          <p className="mt-0.5 text-xs text-violet-800">
            Sent {formatWhen(estimate.sentAt)}
            {delivered ? ` ${delivered}` : " · not delivered, so copy the link to send it"}
          </p>
        </div>
        <Price amount={estimate.total} variant="total" />
      </div>

      {estimate.message && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
          {estimate.message}
        </p>
      )}

      <ul className="mt-3 divide-y divide-violet-100 rounded-lg border border-violet-100 bg-white">
        {estimate.items.map((item) => {
          const bike = bikeName(job, item.jobBikeId);
          return (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="text-slate-800">{item.name}</span>
                {item.quantity > 1 && <span className="text-slate-400"> × {item.quantity}</span>}
                {bike && <span className="block text-xs text-slate-500">{bike}</span>}
              </span>
              <span className="flex items-center gap-2">
                {recording && (
                  <span className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold">
                    {(["APPROVED", "DECLINED"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={decisions[item.id] === d}
                        onClick={() => setDecisions((prev) => ({ ...prev, [item.id]: d }))}
                        className={`px-2.5 py-1 ${
                          decisions[item.id] === d
                            ? d === "APPROVED"
                              ? "bg-emerald-600 text-white"
                              : "bg-red-600 text-white"
                            : "bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {d === "APPROVED" ? "Approve" : "Decline"}
                      </button>
                    ))}
                  </span>
                )}
                <span className="tabular-nums text-slate-700">${item.lineTotal.toFixed(2)}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {recording ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !allDecided}
            onClick={() => onRecord(decisions)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save answer
          </button>
          <button
            type="button"
            onClick={() => {
              setRecording(false);
              setDecisions({});
            }}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          {!allDecided && <span className="text-xs text-slate-500">Choose approve or decline for each item.</span>}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopyLink}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Copy customer link
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRecording(true)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Record answer
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onWithdraw}
            className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>
      )}
      {!recording && (
        <p className="mt-2 text-xs text-slate-500">
          Customer answered by phone or at the counter? Use Record answer.
        </p>
      )}
    </section>
  );
}

function EstimateBuilder({
  job,
  multiBike,
  busy,
  alreadyWaiting,
  hasCustomer,
  onSend,
}: {
  job: Job;
  multiBike: boolean;
  busy: boolean;
  alreadyWaiting: boolean;
  hasCustomer: boolean;
  onSend: (draft: { items: DraftItem[]; message: string; waitOnCustomer: boolean }) => Promise<boolean>;
}) {
  const [items, setItems] = useState<DraftItem[]>([]);
  const [message, setMessage] = useState("");
  const [waitOnCustomer, setWaitOnCustomer] = useState(true);
  const [mode, setMode] = useState<"service" | "product" | "custom">("service");
  const [search, setSearch] = useState("");
  const [services, setServices] = useState<CatalogEntry[]>([]);
  const [products, setProducts] = useState<CatalogEntry[]>([]);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  const bikes = job.jobBikes ?? [];
  const defaultBikeId = bikes.length === 1 ? bikes[0].id : null;

  useEffect(() => {
    fetch("/api/services", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { id: string; name: string; price: unknown; isSystem?: boolean }[]) =>
        setServices(
          (Array.isArray(data) ? data : [])
            .filter((s) => !s.isSystem)
            .map((s) => ({ id: s.id, name: s.name, price: toNumber(s.price) }))
        )
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== "product") return;
    const q = search.trim();
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      fetch(`/api/products?${params.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: { id: string; name: string; price: unknown }[]) =>
          setProducts((Array.isArray(data) ? data : []).map((p) => ({ id: p.id, name: p.name, price: toNumber(p.price) })))
        )
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [mode, search]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = mode === "service" ? services : products;
    const filtered = mode === "service" && q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list;
    return filtered.slice(0, 8);
  }, [mode, search, services, products]);

  const total = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  function addCatalog(entry: CatalogEntry) {
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        source: mode === "product" ? "product" : "service",
        refId: entry.id,
        name: entry.name,
        quantity: 1,
        unitPrice: entry.price,
        jobBikeId: defaultBikeId,
      },
    ]);
    setSearch("");
  }

  function addCustom() {
    const name = customName.trim();
    const price = parseFloat(customPrice);
    if (!name || !Number.isFinite(price) || price < 0) return;
    setItems((prev) => [
      ...prev,
      { key: nextKey(), source: "custom", name, quantity: 1, unitPrice: Math.round(price * 100) / 100, jobBikeId: defaultBikeId },
    ]);
    setCustomName("");
    setCustomPrice("");
  }

  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">New estimate</h3>
        <p className="mt-1 text-sm text-slate-600">
          Add the work you recommend. The customer approves or declines each item from their phone, and
          approved items go straight onto the invoice. Nothing is billed until they approve.
        </p>
        {!hasCustomer && (
          <p className="mt-2 text-sm text-amber-800">
            No customer is linked to this job, so you&apos;ll need to copy the link and send it yourself.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 p-3">
        <div className="mb-3 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm" role="tablist">
          {(["service", "product", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setSearch("");
              }}
              className={`rounded-md px-3 py-1.5 font-medium ${
                mode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {m === "service" ? "Service" : m === "product" ? "Part" : "Custom"}
            </button>
          ))}
        </div>

        {mode === "custom" ? (
          <div className="flex flex-wrap gap-2">
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Describe the work (e.g. True rear wheel)"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
            />
            <div className="relative w-28">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
              <input
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Price"
                className="w-full rounded-lg border border-slate-300 py-2 pl-6 pr-3 text-sm"
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
              />
            </div>
            <button
              type="button"
              onClick={addCustom}
              disabled={!customName.trim() || !customPrice.trim()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={mode === "service" ? "Search services" : "Search parts"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <ul className="mt-2 max-h-56 overflow-y-auto">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => addCatalog(entry)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="truncate text-slate-700">{entry.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-500">${entry.price.toFixed(2)}</span>
                      <span className="text-xs font-semibold text-blue-600">Add</span>
                    </span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-2 py-1.5 text-sm text-slate-500">
                  {mode === "service" ? "No matching services." : "No matching parts."}
                </li>
              )}
            </ul>
          </>
        )}
      </div>

      {items.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-800">{item.name}</span>
              {multiBike && (
                <select
                  value={item.jobBikeId ?? ""}
                  onChange={(e) => update(item.key, { jobBikeId: e.target.value || null })}
                  aria-label="Bike"
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                >
                  <option value="">Any bike</option>
                  {(job.jobBikes ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nickname?.trim() || [b.make, b.model].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => update(item.key, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                aria-label={`Quantity for ${item.name}`}
                className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-right"
              />
              <div className="relative w-24">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => update(item.key, { unitPrice: Math.max(0, parseFloat(e.target.value) || 0) })}
                  aria-label={`Price for ${item.name}`}
                  className="w-full rounded-lg border border-slate-300 py-1 pl-5 pr-2 text-right"
                />
              </div>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}
                aria-label={`Remove ${item.name}`}
                className="rounded p-1 text-slate-400 hover:text-red-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
          <li className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-semibold text-slate-700">Estimate total</span>
            <Price amount={total} variant="total" />
          </li>
        </ul>
      )}

      <div>
        <label htmlFor="estimate-message" className="text-sm font-medium text-slate-700">
          Note to the customer <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="estimate-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="e.g. Your chain is worn past 0.75% and is starting to wear the cassette."
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {!alreadyWaiting && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={waitOnCustomer}
            onChange={(e) => setWaitOnCustomer(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Move the job to <strong>Waiting on Customer</strong> until they answer
            <span className="block text-xs text-slate-500">It moves back automatically when they respond.</span>
          </span>
        </label>
      )}

      <button
        type="button"
        disabled={busy || items.length === 0}
        onClick={async () => {
          const ok = await onSend({ items, message, waitOnCustomer: alreadyWaiting ? true : waitOnCustomer });
          if (ok) {
            setItems([]);
            setMessage("");
          }
        }}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? "Sending…" : items.length === 0 ? "Add items to send" : `Send estimate · $${total.toFixed(2)}`}
      </button>
    </section>
  );
}
