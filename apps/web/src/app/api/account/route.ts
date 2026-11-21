import { NextRequest, NextResponse } from "next/server";
import { deleteStaffLogin } from "@/lib/account-deletion";
import { requireStaffShop } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * A staff member deletes their own login. The shop and its data stay, and so
 * does any subscription: an App Store one is cancelled in the App Store. Every
 * session for the login stops working at once, since isSessionCurrent finds
 * no user behind it.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const deleted = await deleteStaffLogin({ shopId: auth.shopId, userId: auth.userId });
    if (!deleted) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/account error:", error);
    return NextResponse.json({ error: "Could not delete the account. Try again." }, { status: 500 });
  }
}
