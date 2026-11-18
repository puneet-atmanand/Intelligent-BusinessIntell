import React, { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/features/auth/authStore";

interface AdminRouteProps {
  children: React.ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const { user, isAuthenticated, isInitialized, checkAuth } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (!isInitialized) {
      checkAuth();
    }
  }, [isInitialized, checkAuth]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
        <p className="text-xs text-slate-400 font-mono tracking-wide">
          Verifying Super Administrator privileges...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/super-login" replace state={{ from: location }} />;
  }

  const isSuperAdmin =
    user?.is_superuser ||
    user?.role === "SUPERADMIN" ||
    user?.roles?.some((r) => r.name === "Admin" || r.name === "Superadmin");

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Administrator Privileges Required</h2>
        <p className="text-xs text-slate-500 max-w-md mb-6 leading-relaxed">
          Your current account does not hold Super Administrator authorization to access system governance.
        </p>
        <a
          href="/"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
        >
          Return to Analytics Workspace
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
