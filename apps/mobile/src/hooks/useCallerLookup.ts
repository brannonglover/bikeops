import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { unformatPhoneNumber } from "@/lib/format";

/** Last 10 digits — the shape /api/customers stores and searches on. */
function searchDigits(number: string | null): string | null {
  if (!number) return null;
  const digits = unformatPhoneNumber(number);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Puts a name on a raw phone number. Twilio only ever hands us E.164, so
 * without this an incoming call from a regular is indistinguishable from a
 * stranger's. Resolves to null for numbers with no customer record.
 */
export function useCallerLookup(number: string | null): Customer | null {
  const digits = searchDigits(number);

  const { data } = useQuery({
    queryKey: ["caller-lookup", digits],
    enabled: digits !== null,
    // Shop customers don't churn mid-call, and a ringing phone shouldn't wait
    // on the network twice for the same number.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await api.get<Customer[]>(
        `/api/customers?q=${encodeURIComponent(digits as string)}`
      );
      // The endpoint matches loosely (name, email, partial phone), so confirm
      // the phone actually matches before claiming an identity for the caller.
      return data.find((c) => searchDigits(c.phone) === digits) ?? null;
    },
  });

  return data ?? null;
}
