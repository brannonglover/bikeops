import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  staffLogin as apiStaffLogin,
  staffLogout as apiStaffLogout,
  customerLogout as apiCustomerLogout,
  isStaffAuthenticated,
  isCustomerAuthenticated,
  getStaffSession,
  type AuthRole,
} from "./api";

interface StaffUser {
  id: string;
  email: string;
  name?: string;
}

interface AuthState {
  role: AuthRole;
  staffUser: StaffUser | null;
  loading: boolean;
  staffLogin: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  staffLogout: () => Promise<void>;
  customerLogin: () => void;
  customerLogout: () => Promise<void>;
  setCustomerAuthenticated: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AuthRole>(null);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const session = await getStaffSession();
      if (session?.user) {
        setRole("staff");
        setStaffUser(session.user);
        return;
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
    async (email: string, password: string) => {
      const result = await apiStaffLogin(email, password);
      if (result.ok) {
        const session = await getStaffSession();
        if (session?.user) {
          setRole("staff");
          setStaffUser(session.user);
        }
      }
      return result;
    },
    []
  );

  const staffLogout = useCallback(async () => {
    await apiStaffLogout();
    setRole(null);
    setStaffUser(null);
  }, []);

  const customerLogin = useCallback(() => {
    setRole("customer");
  }, []);

  const setCustomerAuthenticated = useCallback(() => {
    setRole("customer");
  }, []);

  const customerLogout = useCallback(async () => {
    await apiCustomerLogout();
    setRole(null);
  }, []);

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
