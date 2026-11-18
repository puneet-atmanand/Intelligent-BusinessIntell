import { create } from "zustand";

export interface Permission {
  id: string;
  code: string;
  name: string;
  resource: string;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  is_system: boolean;
  permissions: Permission[];
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  is_verified?: boolean;
  role: string;
  last_login?: string | null;
  created_at?: string;
  roles: Role[];
  permissions: string[];
}

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<boolean>;
  superLogin: (email: string, password: string) => Promise<boolean>;
  register: (
    fullName: string,
    email: string,
    password: string,
    confirmPassword: string
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,
  error: null,

  clearError: () => set({ error: null }),

  checkAuth: async () => {
    try {
      const token = localStorage.getItem("ayd_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/v1/auth/me", {
        method: "GET",
        headers,
        credentials: "include",
      });

      if (response.ok) {
        const user: UserProfile = await response.json();
        set({ user, isAuthenticated: true, isInitialized: true, isLoading: false, error: null });
      } else {
        localStorage.removeItem("ayd_token");
        set({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false });
      }
    } catch {
      set({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false });
    }
  },

  login: async (email: string, password: string, rememberMe: boolean = false) => {
    try {
      set({ isLoading: true, error: null });
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password, remember_me: rememberMe }),
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.message || data.detail || "Failed to sign in. Please verify your credentials.";
        if (data.details?.errors && Array.isArray(data.details.errors)) {
          const detailMsgs = data.details.errors
            .map((e: { loc?: string[]; msg?: string }) => `${e.loc?.slice(-1)[0]}: ${e.msg}`)
            .join(", ");
          if (detailMsgs) {
            errorMsg = `${errorMsg} (${detailMsgs})`;
          }
        }
        set({ error: errorMsg, isLoading: false });
        return false;
      }

      if (data.access_token) {
        localStorage.setItem("ayd_token", data.access_token);
      }

      set({
        user: data.user,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      set({
        error: `Network error connecting to auth server: ${errMsg}`,
        isLoading: false,
      });
      return false;
    }
  },

  superLogin: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null });
      const response = await fetch("/api/v1/auth/super-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.message || data.detail || "Access denied. Invalid administrator credentials.";
        set({ error: errorMsg, isLoading: false });
        return false;
      }

      if (data.access_token) {
        localStorage.setItem("ayd_token", data.access_token);
      }

      set({
        user: data.user,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      set({
        error: `Network error connecting to administrative service: ${errMsg}`,
        isLoading: false,
      });
      return false;
    }
  },

  register: async (fullName: string, email: string, password: string, confirmPassword: string) => {
    try {
      set({ isLoading: true, error: null });
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          password,
          confirm_password: confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.message || data.detail || "Registration failed. Please check form inputs.";
        if (data.details?.errors && Array.isArray(data.details.errors)) {
          const detailMsgs = data.details.errors
            .map((e: { loc?: string[]; msg?: string }) => `${e.loc?.slice(-1)[0]}: ${e.msg}`)
            .join(", ");
          if (detailMsgs) {
            errorMsg = `${errorMsg} (${detailMsgs})`;
          }
        }
        set({ error: errorMsg, isLoading: false });
        return false;
      }

      if (data.access_token) {
        localStorage.setItem("ayd_token", data.access_token);
      }

      set({
        user: data.user,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      set({
        error: `Network error during account registration: ${errMsg}`,
        isLoading: false,
      });
      return false;
    }
  },

  logout: async () => {
    try {
      localStorage.removeItem("ayd_token");
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      localStorage.removeItem("ayd_token");
      set({ user: null, isAuthenticated: false, isInitialized: true, error: null });
    }
  },
}));
