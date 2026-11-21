import type { Prisma, Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";
import { formatCustomerName } from "@/lib/customer";
import { sendEstimateEmail, sendEstimateResponseNotification } from "@/lib/email";
import { getCustomerStatusUrl } from "@/lib/job-customer-access";
import { roundCurrency } from "@/lib/job-payments";
import { takeStockForLine } from "@/lib/product-stock";
import { customerHasPushTokens, sendPushToAllStaff, sendPushToCustomer } from "@/lib/push";
import { publishJobEvent } from "@/lib/realtime/publish-job-event";
import { getEffectiveEmailUpdatesConsent, getEffectiveSmsConsent } from "@/lib/sms-consent";
import { sendPlainSms } from "@/lib/sms";
import { normalizePhone } from "@/lib/phone";
import { getCustomerNotificationBlockReason } from "@/lib/env";
import { addCustomerSystemChatMessage } from "@/lib/system-chat";

/**
 * Estimates: work the shop proposes and the customer approves or declines item
 * by item. An estimate never touches the job's bill on its own — approving an
 * item turns it into an ordinary JobService/JobProduct line, inside the same
 * transaction that flips the estimate from SENT to RESPONDED, so a double tap
 * or a retried request can't add the work twice.
 */

type Tx = Prisma.TransactionClient;

export class EstimateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

/** Stages a job can be in when an estimate goes out (and that it can be moved out of). */
const ESTIMATE_SENDABLE_STAGES: Stage[] = [
  "BOOKED_IN",
  "RECEIVED",
  "WORKING_ON",
  "WAITING_ON_CUSTOMER",
  "WAITING_ON_PARTS",
  "BIKE_READY",
];

export type EstimateItemInput =
  | { serviceId: string; quantity?: number; unitPrice?: number; jobBikeId?: string | null }
  | { productId: string; quantity?: number; unitPrice?: number; jobBikeId?: string | null }
  | { name: string; unitPrice: number; quantity?: number; jobBikeId?: string | null; description?: string | null };

export type EstimateDecisionInput = Record<string, "APPROVED" | "DECLINED">;

const estimateInclude = {
  items: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.JobEstimateInclude;

type EstimateWithItems = Prisma.JobEstimateGetPayload<{ include: typeof estimateInclude }>;

export type SerializedEstimate = {
  id: string;
  jobId: string;
  status: EstimateWithItems["status"];
  message: string | null;
  sentAt: string;
  sentBySms: boolean;
  sentByEmail: boolean;
  sentByPush: boolean;
  respondedAt: string | null;
  respondedByStaff: boolean;
  customerComment: string | null;
  total: number;
  approvedTotal: number;
  items: {
    id: string;
    kind: EstimateWithItems["items"][number]["kind"];
    name: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    jobBikeId: string | null;
    decision: EstimateWithItems["items"][number]["decision"];
  }[];
};

export function serializeEstimate(estimate: EstimateWithItems): SerializedEstimate {
  const items = estimate.items.map((item) => {
    const unitPrice = Number(item.unitPrice);
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unitPrice,
      lineTotal: roundCurrency(unitPrice * item.quantity),
      jobBikeId: item.jobBikeId,
      decision: item.decision,
    };
  });
  return {
    id: estimate.id,
    jobId: estimate.jobId,
    status: estimate.status,
    message: estimate.message,
    sentAt: estimate.sentAt.toISOString(),
    sentBySms: estimate.sentBySms,
    sentByEmail: estimate.sentByEmail,
    sentByPush: estimate.sentByPush,
    respondedAt: estimate.respondedAt?.toISOString() ?? null,
    respondedByStaff: estimate.respondedByStaff,
    customerComment: estimate.customerComment,
    total: roundCurrency(items.reduce((sum, i) => sum + i.lineTotal, 0)),
    approvedTotal: roundCurrency(
      items.filter((i) => i.decision === "APPROVED").reduce((sum, i) => sum + i.lineTotal, 0)
    ),
    items,
  };
}

export async function listJobEstimates(shopId: string, jobId: string): Promise<SerializedEstimate[]> {
  const estimates = await prisma.jobEstimate.findMany({
    where: { shopId, jobId },
    include: estimateInclude,
    orderBy: { sentAt: "desc" },
  });
  return estimates.map(serializeEstimate);
}

/**
 * Moves the job between WAITING_ON_CUSTOMER and the stage it came from without
 * the customer-facing stage notification: the estimate message is the
 * notification. Mirrors the board-pointer bookkeeping a stage PATCH does.
 */
async function moveJobStageForEstimate(
  tx: Tx,
  job: { id: string; shopId: string; workingOnJobBikeId: string | null },
  to: Stage
): Promise<void> {
  const data: Prisma.JobUncheckedUpdateInput = { stage: to, columnSortOrder: null, completedAt: null };
  if (to === "WORKING_ON") {
    const open = await tx.jobBike.findMany({
      where: { jobId: job.id, shopId: job.shopId, completedAt: null },
      select: { id: true },
    });
    if (open.length === 1) data.workingOnJobBikeId = open[0].id;
  } else if (to !== "WAITING_ON_PARTS" && job.workingOnJobBikeId) {
    data.workingOnJobBikeId = null;
  }
  await tx.job.update({ where: { id: job.id, shopId: job.shopId }, data });
}

export async function createEstimate(input: {
  shopId: string;
  jobId: string;
  message?: string | null;
  items: EstimateItemInput[];
  /** Move the job to WAITING_ON_CUSTOMER until the customer answers. */
  waitOnCustomer: boolean;
}): Promise<{ estimate: EstimateWithItems; stageChanged: boolean }> {
  const { shopId, jobId } = input;
  if (input.items.length === 0) {
    throw new EstimateError("no_items", "Add at least one item to the estimate.", 400);
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, shopId },
    select: { id: true, shopId: true, stage: true, workingOnJobBikeId: true },
  });
  if (!job) throw new EstimateError("job_not_found", "Job not found", 404);
  if (!ESTIMATE_SENDABLE_STAGES.includes(job.stage)) {
    throw new EstimateError(
      "job_not_open",
      job.stage === "PENDING_APPROVAL"
        ? "Confirm the booking before sending an estimate."
        : "Estimates can only be sent on open jobs.",
      409
    );
  }

  const serviceIds = input.items.flatMap((i) => ("serviceId" in i ? [i.serviceId] : []));
  const productIds = input.items.flatMap((i) => ("productId" in i ? [i.productId] : []));
  const jobBikeIds = input.items.flatMap((i) => (i.jobBikeId ? [i.jobBikeId] : []));
  const [services, products, jobBikes] = await Promise.all([
    serviceIds.length
      ? prisma.service.findMany({ where: { shopId, id: { in: serviceIds } } })
      : Promise.resolve([]),
    productIds.length
      ? prisma.product.findMany({ where: { shopId, id: { in: productIds } } })
      : Promise.resolve([]),
    jobBikeIds.length
      ? prisma.jobBike.findMany({ where: { shopId, jobId, id: { in: jobBikeIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const jobBikeIdSet = new Set(jobBikes.map((b) => b.id));

  const itemRows = input.items.map((item, sortOrder) => {
    if (item.jobBikeId && !jobBikeIdSet.has(item.jobBikeId)) {
      throw new EstimateError("bike_not_found", "Bike not found on this job", 404);
    }
    const quantity = Math.max(1, Math.floor(item.quantity ?? 1));
    const base = { shopId, quantity, jobBikeId: item.jobBikeId ?? null, sortOrder };
    if ("serviceId" in item) {
      const service = serviceById.get(item.serviceId);
      if (!service) throw new EstimateError("service_not_found", "Service not found", 404);
      if (service.isSystem) {
        throw new EstimateError("system_service", "That service is added automatically.", 400);
      }
      return {
        ...base,
        kind: "SERVICE" as const,
        serviceId: service.id,
        name: service.name,
        description: service.description,
        unitPrice: roundCurrency(item.unitPrice ?? Number(service.price)),
      };
    }
    if ("productId" in item) {
      const product = productById.get(item.productId);
      if (!product) throw new EstimateError("product_not_found", "Product not found", 404);
      return {
        ...base,
        kind: "PRODUCT" as const,
        productId: product.id,
        name: product.name,
        description: product.description,
        unitPrice: roundCurrency(item.unitPrice ?? Number(product.price)),
      };
    }
    const name = item.name.trim();
    if (!name) throw new EstimateError("item_name_required", "Each item needs a name.", 400);
    return {
      ...base,
      kind: "CUSTOM" as const,
      name,
      description: item.description?.trim() || null,
      unitPrice: roundCurrency(item.unitPrice),
    };
  });

  return prisma.$transaction(async (tx) => {
    const open = await tx.jobEstimate.findFirst({
      where: { shopId, jobId, status: "SENT" },
      select: { id: true },
    });
    if (open) {
      throw new EstimateError(
        "estimate_open",
        "This job already has an estimate waiting on the customer. Withdraw it first.",
        409
      );
    }

    let resumeStage: Stage | null = null;
    let stageChanged = false;
    if (input.waitOnCustomer) {
      if (job.stage === "WAITING_ON_CUSTOMER") {
        resumeStage = "WORKING_ON";
      } else {
        resumeStage = job.stage;
        await moveJobStageForEstimate(tx, job, "WAITING_ON_CUSTOMER");
        stageChanged = true;
      }
    }

    const estimate = await tx.jobEstimate.create({
      data: {
        shopId,
        jobId,
        message: input.message?.trim() || null,
        resumeStage,
        items: { create: itemRows },
      },
      include: estimateInclude,
    });
    return { estimate, stageChanged };
  });
}

/** Withdraw an estimate the customer hasn't answered; the job goes back where it was. */
export async function cancelEstimate(input: {
  shopId: string;
  jobId: string;
  estimateId: string;
}): Promise<{ estimate: EstimateWithItems; stageChanged: boolean }> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.jobEstimate.updateMany({
      where: { id: input.estimateId, shopId: input.shopId, jobId: input.jobId, status: "SENT" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) {
      throw new EstimateError("estimate_not_open", "This estimate is no longer waiting on the customer.", 409);
    }
    const estimate = await tx.jobEstimate.findUniqueOrThrow({
      where: { id: input.estimateId },
      include: estimateInclude,
    });
    const stageChanged = await resumeJobAfterEstimate(tx, input.shopId, input.jobId, estimate.resumeStage);
    return { estimate, stageChanged };
  });
}

async function resumeJobAfterEstimate(
  tx: Tx,
  shopId: string,
  jobId: string,
  resumeStage: Stage | null
): Promise<boolean> {
  if (!resumeStage) return false;
  const job = await tx.job.findFirst({
    where: { id: jobId, shopId },
    select: { id: true, shopId: true, stage: true, workingOnJobBikeId: true },
  });
  // Staff may have moved the job on by hand while the estimate was out.
  if (!job || job.stage !== "WAITING_ON_CUSTOMER") return false;
  await moveJobStageForEstimate(tx, job, resumeStage);
  return true;
}

/**
 * Record the customer's answer. Every item needs a decision. Approved items
 * become job lines at the quoted price; the job resumes its previous stage.
 */
export async function respondToEstimate(input: {
  shopId: string;
  jobId: string;
  estimateId: string;
  decisions: EstimateDecisionInput;
  comment?: string | null;
  byStaff: boolean;
}): Promise<{ estimate: EstimateWithItems; stageChanged: boolean }> {
  const { shopId, jobId, estimateId } = input;

  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, shopId }, select: { stage: true } });
    if (!job) throw new EstimateError("job_not_found", "Job not found", 404);
    if (job.stage === "CANCELLED" || job.stage === "COMPLETED") {
      throw new EstimateError("job_closed", "This job is closed. Please contact the shop.", 409);
    }

    const current = await tx.jobEstimate.findFirst({
      where: { id: estimateId, shopId, jobId },
      include: estimateInclude,
    });
    if (!current) throw new EstimateError("estimate_not_found", "Estimate not found", 404);

    const missing = current.items.filter((i) => !input.decisions[i.id]);
    if (missing.length > 0) {
      throw new EstimateError("decision_required", "Approve or decline every item.", 400);
    }

    // The claim: only the first answer gets past this line.
    const claimed = await tx.jobEstimate.updateMany({
      where: { id: estimateId, shopId, status: "SENT" },
      data: {
        status: "RESPONDED",
        respondedAt: new Date(),
        respondedByStaff: input.byStaff,
        customerComment: input.comment?.trim() || null,
      },
    });
    if (claimed.count === 0) {
      throw new EstimateError(
        "already_responded",
        current.status === "CANCELLED"
          ? "The shop withdrew this estimate."
          : "This estimate has already been answered.",
        409
      );
    }

    for (const item of current.items) {
      const decision = input.decisions[item.id];
      let jobLineId: string | null = null;
      if (decision === "APPROVED") {
        if (item.kind === "PRODUCT" && item.productId) {
          const line = await tx.jobProduct.create({
            data: {
              shopId,
              jobId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              jobBikeId: item.jobBikeId,
            },
          });
          await takeStockForLine(tx, line);
          jobLineId = line.id;
        } else {
          // Services, custom work, and products deleted from the catalog since
          // the estimate went out all land as a service line at the quoted price.
          const line = await tx.jobService.create({
            data: {
              shopId,
              jobId,
              serviceId: item.kind === "SERVICE" ? item.serviceId : null,
              customServiceName: item.kind === "SERVICE" && item.serviceId ? null : item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              jobBikeId: item.jobBikeId,
            },
          });
          jobLineId = line.id;
        }
      }
      await tx.jobEstimateItem.update({
        where: { id: item.id },
        data: { decision, jobLineId },
      });
    }

    const stageChanged = await resumeJobAfterEstimate(tx, shopId, jobId, current.resumeStage);
    // New lines change the job; bump updatedAt like a direct line edit does.
    if (!stageChanged) await tx.job.update({ where: { id: jobId, shopId }, data: {} });
    const estimate = await tx.jobEstimate.findUniqueOrThrow({
      where: { id: estimateId },
      include: estimateInclude,
    });
    return { estimate, stageChanged };
  });
}

type JobForEstimateDelivery = {
  id: string;
  shopId: string;
  bikeMake: string;
  bikeModel: string;
  customer: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    emailUpdatesConsent: boolean;
    smsConsent: boolean;
    smsConsentUpdatedAt: Date | null;
  } | null;
  jobBikes: { id: string }[];
};

async function loadJobForDelivery(shopId: string, jobId: string) {
  const [job, shop] = await Promise.all([
    prisma.job.findFirst({
      where: { id: jobId, shopId },
      select: {
        id: true,
        shopId: true,
        bikeMake: true,
        bikeModel: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            emailUpdatesConsent: true,
            smsConsent: true,
            smsConsentUpdatedAt: true,
          },
        },
        jobBikes: { select: { id: true } },
      },
    }),
    prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, subdomain: true } }),
  ]);
  return { job: job as JobForEstimateDelivery | null, shop };
}

function bikeLabel(job: JobForEstimateDelivery): string {
  if (job.jobBikes.length > 1) return "bikes";
  return `${job.bikeMake} ${job.bikeModel}`.trim() || "bike";
}

function money(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export type EstimateDelivery = {
  sms: boolean;
  email: boolean;
  push: boolean;
  chat: boolean;
  reviewUrl: string;
  /** Why no link reached the customer by text or email; null when one did. */
  notSentReason: string | null;
};

/**
 * Tell the customer an estimate is waiting: text (with SMS consent), email
 * (with email consent), an app push for app users, and a line in their chat
 * thread. Records which channels went out on the estimate.
 *
 * Unlike stage updates, app users still get the text: the approval screen is
 * the web tracking page, and the mobile app's status screen can't show
 * estimates yet, so the push alone would leave them with nothing to tap.
 */
export async function deliverEstimate(estimate: EstimateWithItems): Promise<EstimateDelivery> {
  const { job, shop } = await loadJobForDelivery(estimate.shopId, estimate.jobId);
  const result: EstimateDelivery = {
    sms: false,
    email: false,
    push: false,
    chat: false,
    reviewUrl: "",
    notSentReason: null,
  };
  if (!job || !shop) return { ...result, notSentReason: "Job not found." };

  result.reviewUrl = getCustomerStatusUrl(job.id, shop.id, shop.subdomain);
  const customer = job.customer;
  if (!customer) return { ...result, notSentReason: "No customer is linked to this job." };

  const serialized = serializeEstimate(estimate);
  const bike = bikeLabel(job);
  const count = serialized.items.length;
  const itemsLabel = `${count} ${count === 1 ? "item" : "items"}`;
  const features = await getAppFeatures(shop.id);

  const prefersPush = await customerHasPushTokens(shop.id, customer.id).catch(() => false);
  if (prefersPush) {
    try {
      await sendPushToCustomer(shop.id, customer.id, {
        title: shop.name,
        body: `Estimate ready for your ${bike}: ${itemsLabel}, ${money(serialized.total)}. Tap to review.`,
        data: { type: "job_update", jobId: job.id },
      });
      result.push = true;
    } catch (e) {
      console.error("[estimate] customer push failed:", e);
    }
  }

  const smsBody = `${shop.name}: we have an estimate for your ${bike} (${itemsLabel}, ${money(serialized.total)}). Review and approve here: ${result.reviewUrl}`;
  if (getEffectiveSmsConsent(customer) && customer.phone) {
    const sent = await sendPlainSms(customer.phone, smsBody);
    const recipient = normalizePhone(customer.phone);
    if (sent.ok && recipient) {
      result.sms = true;
      await prisma.jobSms
        .create({ data: { shopId: shop.id, jobId: job.id, templateSlug: "estimate_sent", recipient } })
        .catch((e) => console.error("[estimate] jobSms record failed:", e));
    } else if (!sent.ok) {
      console.warn("[estimate] SMS not sent:", sent.error);
    }
  }

  if (getEffectiveEmailUpdatesConsent(customer) && customer.email) {
    const sent = await sendEstimateEmail({
      shopId: shop.id,
      jobId: job.id,
      to: customer.email,
      customerFirstName: customer.firstName,
      bikeName: bike,
      message: serialized.message,
      items: serialized.items,
      total: serialized.total,
      reviewUrl: result.reviewUrl,
    });
    result.email = sent.ok;
    if (!sent.ok) console.warn("[estimate] email not sent:", sent.error);
  }

  if (features.chatEnabled) {
    try {
      await addCustomerSystemChatMessage({ shopId: shop.id, customerId: customer.id, body: smsBody });
      result.chat = true;
    } catch {
      // logged inside addCustomerSystemChatMessage
    }
  }

  if (!result.sms && !result.email) {
    const blocked = getCustomerNotificationBlockReason();
    const reachable = getEffectiveSmsConsent(customer) || getEffectiveEmailUpdatesConsent(customer);
    result.notSentReason = blocked
      ? `${blocked}.`
      : reachable
        ? "The text and email could not be sent."
        : "The customer has no text or email consent on file.";
  }

  await prisma.jobEstimate.update({
    where: { id: estimate.id },
    data: { sentBySms: result.sms, sentByEmail: result.email, sentByPush: result.push },
  });
  return result;
}

/** Tell staff the customer answered (push + shop email), and note it in the customer's chat thread. */
export async function notifyEstimateResponse(estimate: EstimateWithItems): Promise<void> {
  const { job, shop } = await loadJobForDelivery(estimate.shopId, estimate.jobId);
  if (!job || !shop) return;

  const serialized = serializeEstimate(estimate);
  const customerName = job.customer ? formatCustomerName(job.customer) : "Customer";
  const approved = serialized.items.filter((i) => i.decision === "APPROVED");
  const bike = bikeLabel(job);
  const who = estimate.respondedByStaff ? `${customerName} (recorded by staff)` : customerName;
  const summary =
    approved.length === 0
      ? `${who} declined the estimate`
      : approved.length === serialized.items.length
        ? `${who} approved the estimate (${money(serialized.approvedTotal)})`
        : `${who} approved ${approved.length} of ${serialized.items.length} items (${money(serialized.approvedTotal)})`;

  await Promise.all([
    sendPushToAllStaff(shop.id, {
      title: approved.length === 0 ? "Estimate declined" : "Estimate approved",
      body: `${summary} — ${bike}`,
      data: { type: "job_update", jobId: job.id },
    }).catch((e) => console.error("[estimate] staff push failed:", e)),
    sendEstimateResponseNotification({
      shopId: shop.id,
      jobId: job.id,
      customerName,
      bikeName: bike,
      items: serialized.items,
      approvedTotal: serialized.approvedTotal,
      customerComment: serialized.customerComment,
    })
      .then((r) => {
        if (!r.ok) console.warn("[estimate] staff email not sent:", r.error);
      })
      .catch((e) => console.error("[estimate] staff email threw:", e)),
    (async () => {
      if (!job.customer) return;
      const features = await getAppFeatures(shop.id);
      if (!features.chatEnabled) return;
      const lines = serialized.items.map(
        (i) => `${i.decision === "APPROVED" ? "✓" : "✗"} ${i.name} (${money(i.lineTotal)})`
      );
      const body =
        approved.length === 0
          ? `Estimate declined. No changes to your bill.\n${lines.join("\n")}`
          : `Estimate approved: ${money(serialized.approvedTotal)} added to your bill.\n${lines.join("\n")}`;
      await addCustomerSystemChatMessage({ shopId: shop.id, customerId: job.customer.id, body }).catch(() => {});
    })(),
  ]);
}

export async function publishEstimateJobEvent(shopId: string, jobId: string, stageChanged: boolean) {
  await publishJobEvent(stageChanged ? "job:status_changed" : "job:updated", { shopId, jobId });
}
