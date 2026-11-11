import { NextRequest, NextResponse } from "next/server";
import { deleteCustomerAccount } from "@/lib/account-deletion";
import { getRequestShop } from "@/lib/api-auth";
import { customerSessionFromRequest } from "@/lib/blob-access";
import { getSessionCookieName } from "@/lib/chat-session";

export const dynamic = "force-dynamic";

/**
 * The signed-in customer deletes their account. Works whether or not the
 * shop has chat turned on: deleting an account is never a feature flag.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await customerSessionFromRequest(request);
    const shop = session ? await getRequestShop(request) : null;
    // A session only works on its own shop's host, as everywhere else.
    if (!session || !shop || shop.id !== session.shopId) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const result = await deleteCustomerAccount({
      shopId: session.shopId,
      customerId: session.customerId,
    });
    if (!result) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const response = NextResponse.json({ ok: true, records: result.customerIds.length });
    response.cookies.set(getSessionCookieName(), "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("DELETE /api/chat/account error:", error);
    return NextResponse.json({ error: "Could not delete the account. Try again." }, { status: 500 });
  }
}
