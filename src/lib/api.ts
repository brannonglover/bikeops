import * as SecureStore from "expo-secure-store";

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const STAFF_COOKIE_KEY = "staff_session_cookie";
const STAFF_SESSION_CACHE_KEY = "staff_session_cache";
const STAFF_API_URL_KEY = "staff_api_url";
const STAFF_SHOP_SUBDOMAIN_KEY = "staff_shop_subdomain";
const CUSTOMER_COOKIE_KEY = "customer_session_cookie";
const CUSTOMER_ROLE_KEY = "customer_role_persisted";

// In-memory cache so each apiFetch call doesn't hit SecureStore on disk.
// Values are invalidated on write/delete so they stay consistent.
const cookieMemCache = new Map<string, string | null>();
let staffApiUrlMemCache: string | null | undefined;

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

function getCustomerApiUrl(): string {
  const subdomain = process.env.EXPO_PUBLIC_SHOP_SUBDOMAIN;
  if (subdomain) {
    const url = new URL(DEFAULT_API_URL);
    url.hostname = `${subdomain}.${url.hostname}`;
    return trimTrailingSlash(url.toString());
  }
  return DEFAULT_API_URL;
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

export function resolveUrl(url: string): string {
  if (!url || url.startsWith("http")) return url;
  const apiUrl = staffApiUrlMemCache ?? DEFAULT_API_URL;
  return `${apiUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function resolveCustomerUrl(url: string): string {
  if (!url || url.startsWith("http")) return url;
  const apiUrl = getCustomerApiUrl();
  return `${apiUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type AuthRole = "staff" | "customer" | null;

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  role?: "staff" | "customer";
}

/** Extracts the raw JWT value from a stored cookie string like "cookieName=<jwt>". */
function extractJwtFromCookie(cookieString: string | null): string | null {
  if (!cookieString) return null;
  const eqIdx = cookieString.indexOf("=");
  if (eqIdx === -1) return null;
  return cookieString.slice(eqIdx + 1) || null;
}

async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<{ data: T; response: Response }> {
  const { role = "staff", headers: extraHeaders = {}, ...fetchOptions } = options;
  const cookieKey =
    role === "customer" ? CUSTOMER_COOKIE_KEY : STAFF_COOKIE_KEY;
  const storedCookie = await getStoredCookie(cookieKey);

  const headers: Record<string, string> = {
    ...extraHeaders,
  };

  if (storedCookie) {
    headers["Cookie"] = storedCookie;
    // Also send as Bearer so server-side getToken() can authenticate
    // without relying on cookie header parsing (more reliable in native apps).
    if (role === "staff") {
      const jwt = extractJwtFromCookie(storedCookie);
      if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
    }
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
  const response = await fetch(url, {
    ...fetchOptions,
    headers,
    credentials: "omit",
  });

  const setCookie = response.headers.get("set-cookie");
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
}

export async function customerLogout(): Promise<void> {
  try {
    await api.post("/api/chat/logout", undefined, { role: "customer" });
  } catch {
    // ignore
  }
  await clearCookie(CUSTOMER_COOKIE_KEY);
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
