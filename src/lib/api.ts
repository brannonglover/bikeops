import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

const STAFF_COOKIE_KEY = "staff_session_cookie";
const CUSTOMER_COOKIE_KEY = "customer_session_cookie";

async function getStoredCookie(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function storeCookie(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

async function clearCookie(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
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

export type AuthRole = "staff" | "customer" | null;

interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  role?: "staff" | "customer";
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
  }

  if (
    fetchOptions.body &&
    typeof fetchOptions.body === "string" &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const url = `${API_URL}${path}`;
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
    const errMsg =
      typeof data === "object" && data && "error" in data
        ? (data as { error: string }).error
        : `Request failed: ${response.status}`;
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

export async function staffLogin(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_URL}/api/auth/mobile-login`, {
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

    const { token } = data as { token: string };
    await storeCookie(
      STAFF_COOKIE_KEY,
      `next-auth.session-token=${token}`
    );
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Login failed",
    };
  }
}

export async function staffLogout(): Promise<void> {
  await clearCookie(STAFF_COOKIE_KEY);
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
    const res = await fetch(`${API_URL}/api/auth/session`, {
      headers: { Cookie: cookie },
      credentials: "omit",
    });
    if (!res.ok) return false;
    const session = await res.json();
    return !!session?.user?.email;
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

export async function getStaffSession(): Promise<{
  user: { id: string; email: string; name?: string };
} | null> {
  const cookie = await getStoredCookie(STAFF_COOKIE_KEY);
  if (!cookie) return null;
  try {
    const res = await fetch(`${API_URL}/api/auth/session`, {
      headers: { Cookie: cookie },
      credentials: "omit",
    });
    if (!res.ok) return null;
    const session = await res.json();
    return session?.user?.email ? session : null;
  } catch {
    return null;
  }
}
