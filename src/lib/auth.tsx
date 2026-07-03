import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  staffLogin as apiStaffLogin,
  staffLogout as apiStaffLogout,
  customerLogout as apiCustomerLogout,
  isCustomerAuthenticated,
  getCachedStaffSession,
  cacheStaffSession,
  persistCustomerRole,
  clearCustomerRole,
  hasPersistedCustomerRole,
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
      const cachedSession = await getCachedStaffSession();
      if (cachedSession?.user) {
        setRole("staff");
        setStaffUser(cachedSession.user);
        clearCustomerRole().catch(() => {});
        return;
      }

      const customerPersisted = await hasPersistedCustomerRole();
      if (customerPersisted) {
        const stillAuthed = await isCustomerAuthenticated();
        if (stillAuthed) {
          setRole("customer");
          setStaffUser(null);
          return;
        }
        await clearCustomerRole();
      }

      const customerAuth = await isCustomerAuthenticated();
      if (customerAuth) {
        setRole("customer");
        setStaffUser(null);
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
    refresh().finally(() => setLoading(false));
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
        await cacheStaffSession(session);
        setRole("staff");
        setStaffUser(user);
        clearCustomerRole().catch(() => {});
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
    await persistCustomerRole();
    setRole("customer");
  }, [queryClient]);

  const setCustomerAuthenticated = useCallback(async () => {
    queryClient.clear();
    await persistCustomerRole();
    setRole("customer");
  }, [queryClient]);

  const customerLogout = useCallback(async () => {
    await unregisterPushToken("customer");
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
