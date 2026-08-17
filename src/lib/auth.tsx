import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  staffLogin as apiStaffLogin,
  staffLogout as apiStaffLogout,
  customerLogout as apiCustomerLogout,
  peekCustomerSessionCookie,
  isCustomerAuthenticated,
  getCachedStaffSession,
  cacheStaffSession,
  persistCustomerRole,
  clearCustomerRole,
  hasPersistedCustomerRole,
  warmStaffRequestCredentials,
  warmCustomerRequestCredentials,
  type AuthRole,
} from "./api";
import { unregisterPushToken } from "./notifications";

interface StaffUser {
  id: string;
  email: string;
  name?: string;
  shopSubdomain?: string;
}

interface AuthState {
  role: AuthRole;
  staffUser: StaffUser | null;
  loading: boolean;
  staffLogin: (
    email: string,
    password: string,
    shopSubdomain: string
  ) => Promise<{ ok: boolean; error?: string }>;
  staffLogout: () => Promise<void>;
  customerLogin: () => Promise<void>;
  customerLogout: () => Promise<void>;
  setCustomerAuthenticated: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<AuthRole>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // Start session-cookie / shop-URL reads alongside role restore so a
      // notification tap doesn't fetch chat before the keychain answers.
      warmStaffRequestCredentials();
      // Parallel keychain reads — sequential SecureStore at cold start is a
      // common hang on iOS (unblocks when the app is backgrounded).
      const [cachedSession, customerPersisted] = await Promise.all([
        getCachedStaffSession(),
        hasPersistedCustomerRole(),
      ]);

      if (cachedSession?.user) {
        setRole("staff");
        setStaffUser(cachedSession.user);
        warmStaffRequestCredentials();
        clearCustomerRole().catch(() => {});
        return;
      }

      if (customerPersisted) {
        // Optimistic: let Home paint immediately. Confirm the session in the
        // background — don't block startup on /api/chat/me.
        setRole("customer");
        setStaffUser(null);
        warmCustomerRequestCredentials();
        void isCustomerAuthenticated().then(async (stillAuthed) => {
          if (stillAuthed) return;
          await clearCustomerRole();
          setRole(null);
          setStaffUser(null);
        });
        return;
      }

      const customerAuth = await isCustomerAuthenticated();
      if (customerAuth) {
        setRole("customer");
        setStaffUser(null);
        void persistCustomerRole();
        return;
      }

      setRole(null);
      setStaffUser(null);
    } catch {
      setRole(null);
      setStaffUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const AUTH_BOOT_BUDGET_MS = 1200;

    void (async () => {
      try {
        // Never leave the startup bike spinner waiting on a hung keychain read.
        await Promise.race([
          refresh(),
          new Promise<void>((resolve) =>
            setTimeout(resolve, AUTH_BOOT_BUDGET_MS)
          ),
        ]);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // If the timeout won, refresh may still complete and update role.
    })();

    // Same transition that was manually unblocking users — retry auth when
    // the app becomes active again so a cold keychain can catch up.
    const onAppState = (next: AppStateStatus) => {
      if (next === "active") void refresh();
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [refresh]);

  const staffLogin = useCallback(
    async (email: string, password: string, shopSubdomain: string) => {
      const result = await apiStaffLogin(email, password, shopSubdomain);
      if (result.ok) {
        // Drop any previous tenant's cached data before showing this shop, so a
        // different bike shop's content can never flash on screen after login.
        queryClient.clear();
        const user = result.user ?? { id: "", email, name: "" };
        const session = { user };
        setRole("staff");
        setStaffUser(user);
        void cacheStaffSession(session);
        void clearCustomerRole();
      }
      return result;
    },
    [queryClient]
  );

  const staffLogout = useCallback(async () => {
    await unregisterPushToken("staff");
    await apiStaffLogout();
    queryClient.clear();
    setRole(null);
    setStaffUser(null);
  }, [queryClient]);

  const customerLogin = useCallback(async () => {
    queryClient.clear();
    setRole("customer");
    void persistCustomerRole();
  }, [queryClient]);

  const setCustomerAuthenticated = useCallback(async () => {
    queryClient.clear();
    // Paint customer routes immediately; SecureStore can finish in the background.
    setRole("customer");
    void persistCustomerRole();
  }, [queryClient]);

  const customerLogout = useCallback(async () => {
    const cookie = await peekCustomerSessionCookie();
    // Local clear first so the UI can exit immediately; server cleanup is
    // best-effort in the background with the captured cookie.
    void unregisterPushToken("customer", { cookie });
    await apiCustomerLogout();
    queryClient.clear();
    await clearCustomerRole();
    setRole(null);
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{
        role,
        staffUser,
        loading,
        staffLogin,
        staffLogout,
        customerLogin,
        customerLogout,
        setCustomerAuthenticated,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
