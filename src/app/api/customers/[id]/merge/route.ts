import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mergeSmsConsentFields } from "@/lib/sms-consent";
import { z } from "zod";
import { requireStaffShop } from "@/lib/api-auth";
import { resolveGeneralConversation } from "@/lib/conversation";
import type { Customer, Prisma } from "@prisma/client";

/** Details the merged customer takes from the source when it has none of its own. */
const FILL_IN_FIELDS = [
  "lastName",
  "email",
  "phone",
  "address",
  "notes",
  "imageUrl",
] as const;

/**
 * Who the merged customer is. A placeholder (a stranger's number standing in
 * for a name) gives way to a real contact's name whichever side it is on, the
 * result is only provisional if both were, and otherwise the target's own
 * details win with blanks filled from the source.
 */
function mergedCustomerFields(
  target: Customer,
  source: Customer
): Prisma.CustomerUncheckedUpdateInput {
  const update: Prisma.CustomerUncheckedUpdateInput = {};
  const takeIdentity = target.provisional && !source.provisional;

  if (takeIdentity) {
    update.firstName = source.firstName;
    update.lastName = source.lastName ?? target.lastName;
  }
  for (const key of FILL_IN_FIELDS) {
    if (takeIdentity && key === "lastName") continue;
    if (target[key] == null && source[key] != null) update[key] = source[key];
  }

  const provisional = target.provisional && source.provisional;
  if (provisional !== target.provisional) update.provisional = provisional;
  if (provisional && !target.provisionalSeenAt && source.provisionalSeenAt) {
    update.provisionalSeenAt = source.provisionalSeenAt;
  }
  return update;
}

const mergeSchema = z.object({
  sourceCustomerId: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;
  const { shopId } = auth;

  try {
    const { id: targetId } = await params;
    const body = await request.json();
    const { sourceCustomerId } = mergeSchema.parse(body);

    if (sourceCustomerId === targetId) {
      return NextResponse.json(
        { error: "Cannot merge a customer into themselves" },
        { status: 400 }
      );
    }

    const [target, source] = await Promise.all([
      // Both must be this shop's customers; another shop's id is "not found".
      prisma.customer.findFirst({ where: { id: targetId, shopId } }),
      prisma.customer.findFirst({ where: { id: sourceCustomerId, shopId } }),
    ]);

    if (!target) {
      return NextResponse.json(
        { error: "Target customer not found" },
        { status: 404 }
      );
    }
    if (!source) {
      return NextResponse.json(
        { error: "Source customer not found" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      const customerUpdate = {
        ...mergedCustomerFields(target, source),
        ...mergeSmsConsentFields(target, source),
      };
      if (Object.keys(customerUpdate).length > 0) {
        await tx.customer.update({
          where: { id: targetId },
          data: customerUpdate,
        });
      }

      await tx.bike.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      await tx.job.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      await tx.conversation.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      // Each side brought a general thread; fold them into one so staff and the
      // customer see a single conversation.
      // resolveGeneralConversation runs consolidateCustomerConversations under
      // the same advisory lock inbound texts take, so one can't race the fold.
      const thread = await resolveGeneralConversation(shopId, targetId, tx);

      // Call.customerId is SetNull on delete, so anything not moved here would
      // lose its link to the customer when the source row goes.
      await tx.call.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });
      if (thread) {
        // Calls filed on a thread the consolidation just archived follow the
        // messages to the surviving one.
        await tx.call.updateMany({
          where: {
            shopId,
            customerId: targetId,
            conversationId: { not: null },
            NOT: { conversationId: thread.id },
          },
          data: { conversationId: thread.id },
        });
      }

      await tx.waitlistEntry.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      await tx.reviewRequest.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      await tx.rentalReservation.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      // Cascade-deleted with the customer, so a device signed in as the source
      // would stop getting notifications.
      await tx.pushToken.updateMany({
        where: { customerId: sourceCustomerId, shopId },
        data: { customerId: targetId },
      });

      await tx.magicLinkToken.deleteMany({
        where: { customerId: sourceCustomerId },
      });

      await tx.chatSession.deleteMany({
        where: { customerId: sourceCustomerId },
      });

      await tx.customer.delete({ where: { id: sourceCustomerId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "sourceCustomerId is required" },
        { status: 400 }
      );
    }
    console.error("POST /api/customers/[id]/merge error:", error);
    return NextResponse.json(
      { error: "Failed to merge customers" },
      { status: 500 }
    );
  }
}
