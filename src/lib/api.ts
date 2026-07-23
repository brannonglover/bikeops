import * as SecureStore from "expo-secure-store";

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const STAFF_COOKIE_KEY = "staff_session_cookie";
const STAFF_SESSION_CACHE_KEY = "staff_session_cache";
const STAFF_API_URL_KEY = "staff_api_url";
const STAFF_SHOP_SUBDOMAIN_KEY = "staff_shop_subdomain";
const CUSTOMER_COOKIE_KEY = "customer_session_cookie";
const CUSTOMER_ROLE_KEY = "customer_role_persisted";
const CUSTOMER_SHOP_SUBDOMAIN_KEY = "customer_shop_subdomain";
const CUSTOMER_SHOP_NAME_KEY = "customer_shop_name";

// In-memory cache so each apiFetch call doesn't hit SecureStore on disk.
// Values are invalidated on write/delete so they stay consistent.
const cookieMemCache = new Map<string, string | null>();
let staffApiUrlMemCache: string | null | undefined;
let customerApiUrlMemCache: string | null | undefined;
let customerShopSubdomainMemCache: string | null | undefined;
let customerShopNameMemCache: string | null | undefined;

async function getStoredCookie(key: string): Promise<string | null> {
  if (cookieMemCache.has(key)) return cookieMemCache.get(key) ?? null;
  try {
    const value = await SecureStore.getItemAsync(key);
    cookieMemCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

async function storeCookie(key: string, value: string): Promise<void> {
  cookieMemCache.set(key, value);
  await SecureStore.setItemAsync(key, value);
}

async function clearCookie(key: string): Promise<void> {
  cookieMemCache.delete(key);
  await SecureStore.deleteItemAsync(key);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getDefaultApiUrl(): URL {
  return new URL(DEFAULT_API_URL);
}

function normalizeShopSubdomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
}

function isValidSubdomain(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

export function getShopApiUrl(shop: string): string {
  const normalized = normalizeShopSubdomain(shop);
  if (!normalized) {
    throw new Error("Enter your shop subdomain.");
  }

  if (normalized.includes(".")) {
    const protocol = getDefaultApiUrl().protocol;
    return trimTrailingSlash(`${protocol}//${normalized}`);
  }

  if (!isValidSubdomain(normalized)) {
    throw new Error("Enter a valid shop subdomain.");
  }

  const defaultUrl = getDefaultApiUrl();
  const rootHost = defaultUrl.hostname;
  const host = `${normalized}.${rootHost}`;
  return trimTrailingSlash(`${defaultUrl.protocol}//${host}${defaultUrl.port ? `:${defaultUrl.port}` : ""}`);
}

async function storeStaffApiUrl(apiUrl: string, shopSubdomain: string): Promise<void> {
  const normalizedUrl = trimTrailingSlash(apiUrl);
  staffApiUrlMemCache = normalizedUrl;
  await storeCookie(STAFF_API_URL_KEY, normalizedUrl);
  await storeCookie(STAFF_SHOP_SUBDOMAIN_KEY, normalizeShopSubdomain(shopSubdomain));
}

async function getStaffApiUrl(): Promise<string> {
  if (staffApiUrlMemCache !== undefined) {
    return staffApiUrlMemCache ?? DEFAULT_API_URL;
  }
  const stored = await getStoredCookie(STAFF_API_URL_KEY);
  staffApiUrlMemCache = stored ? trimTrailingSlash(stored) : null;
  return staffApiUrlMemCache ?? DEFAULT_API_URL;
}

export async function getLastStaffShopSubdomain(): Promise<string | null> {
  return getStoredCookie(STAFF_SHOP_SUBDOMAIN_KEY);
}

function buildCustomerApiUrlFromSubdomain(subdomain: string): string {
  return getShopApiUrl(subdomain);
}

async function getCustomerApiUrl(): Promise<string> {
  if (customerApiUrlMemCache) {
    return customerApiUrlMemCache;
  }
  if (customerApiUrlMemCache === null) {
    throw new Error("Select a bike shop before continuing.");
  }
  const stored = await getStoredCookie(CUSTOMER_SHOP_SUBDOMAIN_KEY);
  customerShopSubdomainMemCache = stored;
  const name = await getStoredCookie(CUSTOMER_SHOP_NAME_KEY);
  customerShopNameMemCache = name;
  if (!stored) {
    customerApiUrlMemCache = null;
    throw new Error("Select a bike shop before continuing.");
  }
  customerApiUrlMemCache = buildCustomerApiUrlFromSubdomain(stored);
  return customerApiUrlMemCache;
}

export async function setCustomerShop(
  subdomain: string,
  name?: string
): Promise<void> {
  const normalized = normalizeShopSubdomain(subdomain);
  if (!normalized || !isValidSubdomain(normalized)) {
    throw new Error("Enter a valid shop subdomain.");
  }

  let previous = customerShopSubdomainMemCache;
  if (previous === undefined) {
    previous = await getStoredCookie(CUSTOMER_SHOP_SUBDOMAIN_KEY);
    customerShopSubdomainMemCache = previous;
  }
  if (previous && previous !== normalized) {
    // Drop the prior shop's session so it is never sent to another tenant.
    await clearCookie(CUSTOMER_COOKIE_KEY);
    await clearCookie(CUSTOMER_ROLE_KEY);
  }

  const apiUrl = getShopApiUrl(normalized);
  const shopName = name?.trim() || normalized;
  customerApiUrlMemCache = apiUrl;
  customerShopSubdomainMemCache = normalized;
  customerShopNameMemCache = shopName;
  await storeCookie(CUSTOMER_SHOP_SUBDOMAIN_KEY, normalized);
  await storeCookie(CUSTOMER_SHOP_NAME_KEY, shopName);
}

export async function getCustomerShop(): Promise<{
  subdomain: string | null;
  name: string | null;
} | null> {
  if (customerShopSubdomainMemCache !== undefined) {
    if (!customerShopSubdomainMemCache) return null;
    return {
      subdomain: customerShopSubdomainMemCache,
      name: customerShopNameMemCache ?? customerShopSubdomainMemCache,
    };
  }
  const subdomain = await getStoredCookie(CUSTOMER_SHOP_SUBDOMAIN_KEY);
  const name = await getStoredCookie(CUSTOMER_SHOP_NAME_KEY);
  customerShopSubdomainMemCache = subdomain;
  customerShopNameMemCache = name;
  if (subdomain) {
    customerApiUrlMemCache = buildCustomerApiUrlFromSubdomain(subdomain);
  }
  if (!subdomain) return null;
  return { subdomain, name: name ?? subdomain };
}

export function getDefaultCustomerShopName(): string {
  return process.env.EXPO_PUBLIC_SHOP_NAME?.trim() || "Bike Shop";
}

/**
 * Extract a shop subdomain from a magic-link / deep-link URL host.
 * e.g. https://pedal-forge.bikeops.co/open/login#token=… → "pedal-forge"
 * Returns null for platform hosts (app., www.) or non-tenant URLs.
 */
export function parseShopSubdomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === "localhost") return null;

    const defaultHost = getDefaultApiUrl().hostname.toLowerCase();
    const rootDomain = (
      process.env.EXPO_PUBLIC_ROOT_DOMAIN ?? "bikeops.co"
    ).toLowerCase();

    // shop.localhost:port (local multi-tenant)
    if (hostname.endsWith(".localhost")) {
      const sub = hostname.slice(0, -".localhost".length);
      if (sub && isValidSubdomain(sub) && sub !== "app" && sub !== "www") {
        return sub;
      }
      return null;
    }

    const stripHost = (host: string, root: string): string | null => {
      if (host === root || host === `app.${root}` || host === `www.${root}`) {
        return null;
      }
      if (!host.endsWith(`.${root}`)) return null;
      const sub = host.slice(0, -(root.length + 1));
      if (!sub || sub.includes(".") || !isValidSubdomain(sub)) return null;
      if (sub === "app" || sub === "www") return null;
      return sub;
    };

    return (
      stripHost(hostname, defaultHost) ?? stripHost(hostname, rootDomain)
    );
  } catch {
    return null;
  }
}

async function getApiUrl(role: "staff" | "customer"): Promise<string> {
  if (role === "staff") return getStaffApiUrl();
  return getCustomerApiUrl();
}

function extractCookieValue(
  setCookieHeaders: string | null,
  cookieName: string
): string | null {
  if (!setCookieHeaders) return null;
  const cookies = setCookieHeaders.split(",").map((c) => c.trim());
  for (const cookie of cookies) {
    const parts = cookie.split(";")[0];
    const [name, ...rest] = parts.split("=");
    if (name.trim() === cookieName) {
      return rest.join("=").trim();
    }
  }
  return null;
}

function isAbsoluteOrLocalUri(url: string): boolean {
  return /^(https?:|file:|content:|ph:|assets-library:)/i.test(url);
}

export function resolveUrl(url: string): string {
  if (!url || isAbsoluteOrLocalUri(url)) return url;
  const apiUrl = staffApiUrlMemCache ?? DEFAULT_API_URL;
  return `${apiUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function resolveCustomerUrl(url: string): string {
  if (!url || isAbsoluteOrLocalUri(url)) return url;
  const apiUrl = customerApiUrlMemCache;
  if (!apiUrl) return url;
  return `${apiUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type AuthRole = "staff" | "customer" | null;

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  role?: "staff" | "customer";
  /** Use this cookie instead of the one in SecureStore (e.g. post-logout cleanup). */
  cookie?: string;
  /** When false, ignore Set-Cookie / sessionToken in the response. Default true. */
  persistSession?: boolean;
}

/** Extracts the raw token value from a stored cookie string like "cookieName=<token>". */
function extractTokenFromCookie(cookieString: string | null): string | null {
  if (!cookieString) return null;
  const eqIdx = cookieString.indexOf("=");
  if (eqIdx === -1) return null;
  return cookieString.slice(eqIdx + 1) || null;
}

async function storeCustomerSessionToken(sessionToken: string): Promise<void> {
  await storeCookie(CUSTOMER_COOKIE_KEY, `${getCustomerSessionCookieName()}=${sessionToken}`);
}

function getCustomerSessionCookieName(): string {
  return "chat_session";
}

function extractCustomerSessionFromResponse(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("sessionToken" in data)) return null;
  const sessionToken = (data as { sessionToken?: unknown }).sessionToken;
  return typeof sessionToken === "string" && sessionToken.length > 0
    ? sessionToken
    : null;
}

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<{ data: T; response: Response }> {
  const {
    role = "staff",
    headers: extraHeaders = {},
    cookie: cookieOverride,
    persistSession = true,
    ...fetchOptions
  } = options;
  const cookieKey =
    role === "customer" ? CUSTOMER_COOKIE_KEY : STAFF_COOKIE_KEY;
  const storedCookie = cookieOverride ?? (await getStoredCookie(cookieKey));

  const headers: Record<string, string> = {
    ...extraHeaders,
  };

  if (storedCookie) {
    headers["Cookie"] = storedCookie;
    // Also send as Bearer so server-side auth works without relying on
    // cookie header parsing (more reliable in native apps).
    const token = extractTokenFromCookie(storedCookie);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  if (
    fetchOptions.body &&
    typeof fetchOptions.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const apiUrl = await getApiUrl(role);
  const url = `${apiUrl}${path}`;
  const timeout = createTimeoutSignal(DEFAULT_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: "omit",
      signal: timeout.signal,
    });
  } catch (err) {
    if (timeout.signal.aborted) {
      throw new ApiError("Request timed out. Please try again.", 408);
    }
    throw err;
  } finally {
    timeout.clear();
  }

  const setCookie = persistSession ? response.headers.get("set-cookie") : null;
  if (setCookie) {
    const staffToken = extractCookieValue(
      setCookie,
      "next-auth.session-token"
    );
    const secureStaffToken = extractCookieValue(
      setCookie,
      "__Secure-next-auth.session-token"
    );
    if (staffToken || secureStaffToken) {
      const tokenVal = staffToken || secureStaffToken;
      const cookieName = secureStaffToken
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token";
      await storeCookie(STAFF_COOKIE_KEY, `${cookieName}=${tokenVal}`);
    }

    const chatToken = extractCookieValue(setCookie, "chat_session");
    if (chatToken) {
      if (chatToken === "" || setCookie.includes("Max-Age=0")) {
        await clearCookie(CUSTOMER_COOKIE_KEY);
      } else {
        await storeCookie(CUSTOMER_COOKIE_KEY, `chat_session=${chatToken}`);
      }
    }
  }

  let data: T;
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    data = (await response.json()) as T;
  } else {
    data = (await response.text()) as unknown as T;
  }

  if (persistSession && role === "customer") {
    const sessionToken = extractCustomerSessionFromResponse(data);
    if (sessionToken) {
      await storeCustomerSessionToken(sessionToken);
    }
  }

  if (!response.ok) {
    const raw =
      typeof data === "object" && data !== null && "error" in data
        ? (data as Record<string, unknown>).error
        : undefined;
    const errMsg =
      typeof raw === "string" ? raw : `Request failed: ${response.status}`;
    throw new ApiError(errMsg, response.status, data);
  }

  return { data, response };
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export const api = {
  get: <T = unknown>(path: string, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "GET" }),

  post: <T = unknown>(path: string, body?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T = unknown>(path: string, body?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = unknown>(path: string, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "DELETE" }),

  postForm: <T = unknown>(path: string, formData: FormData, opts?: FetchOptions) =>
    apiFetch<T>(path, {
      ...opts,
      method: "POST",
      body: formData as unknown as string,
      headers: { ...opts?.headers },
    }),
};

export interface StaffBillingStatus {
  shopId: string;
  status: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  hasSubscription: boolean;
  billingProvider: string | null;
  hasAppleSubscription: boolean;
  appleCurrentPeriodEnd: string | null;
  billingExempt: boolean;
  billingActive: boolean;
  monthlyPrice: number;
}

export async function getStaffBillingStatus(): Promise<StaffBillingStatus> {
  const { data } = await api.get<StaffBillingStatus>("/api/billing/status", {
    role: "staff",
  });
  return data;
}

export async function persistCustomerRole(): Promise<void> {
  await storeCookie(CUSTOMER_ROLE_KEY, "true");
}

export async function clearCustomerRole(): Promise<void> {
  await clearCookie(CUSTOMER_ROLE_KEY);
}

export async function hasPersistedCustomerRole(): Promise<boolean> {
  const val = await getStoredCookie(CUSTOMER_ROLE_KEY);
  return val === "true";
}

interface StaffLoginResult {
  ok: boolean;
  error?: string;
  user?: { id: string; email: string; name?: string; shopSubdomain?: string };
}

export async function staffLogin(
  email: string,
  password: string,
  shopSubdomain: string
): Promise<StaffLoginResult> {
  try {
    const apiUrl = getShopApiUrl(shopSubdomain);
    const res = await fetch(`${apiUrl}/api/auth/mobile-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "omit",
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return { ok: false, error: "Server error — please try again later." };
    }

    const data = await res.json();

    if (!res.ok) {
      return { ok: false, error: data.error ?? "Login failed" };
    }

    const { token, user } = data as {
      token: string;
      user?: { id: string; email: string; name?: string; shopSubdomain?: string };
    };
    // On HTTPS production NextAuth uses the __Secure- prefix; on HTTP (local) it does not.
    const cookieName = apiUrl.startsWith("https://")
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token";
    await storeStaffApiUrl(apiUrl, user?.shopSubdomain ?? shopSubdomain);
    await storeCookie(STAFF_COOKIE_KEY, `${cookieName}=${token}`);
    return { ok: true, user };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Login failed",
    };
  }
}

export async function staffLogout(): Promise<void> {
  await clearCookie(STAFF_COOKIE_KEY);
  await clearCachedStaffSession();
  await clearStaffApiUrl();
}

async function clearStaffApiUrl(): Promise<void> {
  staffApiUrlMemCache = undefined;
  await clearCookie(STAFF_API_URL_KEY);
  await clearCookie(STAFF_SHOP_SUBDOMAIN_KEY);
}

export async function peekCustomerSessionCookie(): Promise<string | null> {
  return getStoredCookie(CUSTOMER_COOKIE_KEY);
}

/**
 * Clears the local customer session immediately. Server logout is best-effort
 * in the background so the UI is not blocked; pass the captured cookie so the
 * request stays authenticated after local clear, and skip persisting Set-Cookie
 * so a late logout response cannot wipe a newly created session.
 */
export async function customerLogout(): Promise<void> {
  const cookie = await getStoredCookie(CUSTOMER_COOKIE_KEY);
  await clearCookie(CUSTOMER_COOKIE_KEY);
  if (!cookie) return;
  void api
    .post("/api/chat/logout", undefined, {
      role: "customer",
      cookie,
      persistSession: false,
    })
    .catch(() => {});
}

export async function isStaffAuthenticated(): Promise<boolean> {
  const cookie = await getStoredCookie(STAFF_COOKIE_KEY);
  if (!cookie) return false;
  try {
    const { data } = await api.get<{ user?: { email?: string } }>(
      "/api/auth/session",
      { role: "staff" }
    );
    return !!data?.user?.email;
  } catch {
    return false;
  }
}

export async function isCustomerAuthenticated(): Promise<boolean> {
  const cookie = await getStoredCookie(CUSTOMER_COOKIE_KEY);
  if (!cookie) return false;
  try {
    const { data } = await api.get<{ id: string }>("/api/chat/me", {
      role: "customer",
    });
    return !!data?.id;
  } catch {
    return false;
  }
}

type StaffSession = { user: { id: string; email: string; name?: string } };

export async function cacheStaffSession(
  session: StaffSession
): Promise<void> {
  await storeCookie(STAFF_SESSION_CACHE_KEY, JSON.stringify(session));
}

export async function getCachedStaffSession(): Promise<StaffSession | null> {
  try {
    const raw = await getStoredCookie(STAFF_SESSION_CACHE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StaffSession;
    return session?.user?.email ? session : null;
  } catch {
    return null;
  }
}

export async function clearCachedStaffSession(): Promise<void> {
  await clearCookie(STAFF_SESSION_CACHE_KEY);
}

export async function getStaffSession(): Promise<StaffSession | null> {
  const cookie = await getStoredCookie(STAFF_COOKIE_KEY);
  if (!cookie) return null;
  try {
    const { data } = await api.get<StaffSession>("/api/auth/session", {
      role: "staff",
    });
    if (data?.user?.email) {
      await cacheStaffSession(data);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
