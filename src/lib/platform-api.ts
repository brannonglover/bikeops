const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const ROOT_DOMAIN = process.env.EXPO_PUBLIC_ROOT_DOMAIN ?? "bikeops.co";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Platform host (app.bikeops.co) for signup and other shared routes — not tenant subdomains. */
export function getPlatformApiUrl(): string {
  const url = new URL(DEFAULT_API_URL);
  const hostname = url.hostname;

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return trimTrailingSlash(`${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`);
  }

  if (hostname.startsWith("app.")) {
    return trimTrailingSlash(`${url.protocol}//${hostname}`);
  }

  return trimTrailingSlash(`${url.protocol}//app.${ROOT_DOMAIN}`);
}

export const PLATFORM_ROOT_DOMAIN = ROOT_DOMAIN;

export class PlatformApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
  }
}

async function platformFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const base = getPlatformApiUrl();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${base}${path}`, { ...options, headers });
  let data: unknown;
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const raw =
      typeof data === "object" && data !== null && "error" in data
        ? (data as Record<string, unknown>).error
        : undefined;
    const message =
      typeof raw === "string" ? raw : `Request failed (${response.status})`;
    throw new PlatformApiError(message, response.status);
  }

  return data as T;
}

export interface SignupPayload {
  shopName: string;
  subdomain: string;
  ownerName: string;
  email: string;
  password: string;
}

export interface SignupStartResponse {
  message: string;
  email: string;
}

export interface SignupVerifyResponse {
  shop: { id: string; name: string; subdomain: string };
  loginUrl: string;
}

export interface ApplePurchaseVerifyPayload {
  shopId: string;
  productId: string;
  transactionId: string;
  originalTransactionId?: string;
}

export interface ApplePurchaseVerifyResponse {
  ok: boolean;
  billingActive: boolean;
}

export interface NearbyShop {
  id: string;
  name: string;
  subdomain: string;
  address: string | null;
  distanceKm: number;
  lat: number;
  lng: number;
}

export interface NearbyShopsResponse {
  shops: NearbyShop[];
}

export const platformApi = {
  startSignup: (body: SignupPayload) =>
    platformFetch<SignupStartResponse>("/api/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verifySignup: (token: string) =>
    platformFetch<SignupVerifyResponse>("/api/signup", {
      method: "PUT",
      body: JSON.stringify({ token }),
    }),

  resendSignup: (email: string, subdomain?: string) =>
    platformFetch<{ message: string }>("/api/signup/resend", {
      method: "POST",
      body: JSON.stringify({ email, ...(subdomain ? { subdomain } : {}) }),
    }),

  verifyApplePurchase: (body: ApplePurchaseVerifyPayload) =>
    platformFetch<ApplePurchaseVerifyResponse>("/api/billing/apple/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getNearbyShops: (lat: number, lng: number, radiusKm = 50) => {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      radiusKm: String(radiusKm),
    });
    return platformFetch<NearbyShopsResponse>(
      `/api/shops/nearby?${params.toString()}`
    );
  },
};

export function slugifySubdomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 30);
}
