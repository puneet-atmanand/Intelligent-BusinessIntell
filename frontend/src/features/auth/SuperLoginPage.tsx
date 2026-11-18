import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  AlertTriangle,
  Terminal,
} from "lucide-react";
import { useAuthStore } from "./authStore";

export function SuperLoginPage() {
  const navigate = useNavigate();
  const { superLogin, isLoading, error, clearError } = useAuthStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    clearError();
    const success = await superLogin(email, password);
    if (success) {
      navigate("/admin");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 select-none relative overflow-hidden">
      {/* Subtle security grid backdrop */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      <div className="w-full max-w-md space-y-6 relative z-10">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center p-3.5 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl shadow-xl shadow-indigo-500/20 text-white mb-2 ring-4 ring-indigo-500/20">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-700/50 text-[10px] font-mono font-bold tracking-wider text-indigo-300 uppercase shadow-inner">
            <Lock className="w-3 h-3 text-indigo-400" />
            Restricted System Access
          </div>

          <h1 className="text-xl font-bold tracking-tight text-white">
            Super Administrator Portal
          </h1>
          <p className="text-xs text-slate-400">
            Platform governance, user management, and security infrastructure
          </p>
        </div>

        {/* Security Login Card */}
        <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800 shadow-2xl p-7 space-y-5">
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              Administrative Authentication
            </h2>
            <p className="text-[11px] text-slate-400">
              Enter your master administrator credentials to access platform controls
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase font-mono tracking-wider flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-indigo-400" />
                Administrator Email / Username
              </label>
              <input
                type="text"
                required
                placeholder="admin@yourdomain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                className="w-full px-3.5 py-2.5 text-xs bg-slate-950/70 border border-slate-700/80 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition placeholder:text-slate-600 font-mono"
              />
            </div>

            {/* Password Field */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-300 uppercase font-mono tracking-wider flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                Administrator Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
                  className="w-full px-3.5 py-2.5 pr-10 text-xs bg-slate-950/70 border border-slate-700/80 rounded-xl text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition placeholder:text-slate-600 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/30 transition flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Secure Administrator Sign In</span>
                </>
              )}
            </button>
          </form>

          {/* Security Notice */}
          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Authorized personnel only. All access attempts are recorded in immutable audit logs.
            </p>
          </div>
        </div>

        {/* Back to Client Login */}
        <div className="text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-medium transition"
          >
            <ArrowRight className="w-3.5 h-3.5 rotate-180" />
            <span>Return to Client Workspace</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default SuperLoginPage;
