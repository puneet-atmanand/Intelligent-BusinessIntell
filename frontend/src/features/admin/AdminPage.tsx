import React, { useState, useEffect } from "react";
import {
  Users,
  Database,
  Activity,
  Search,
  Filter,
  CheckCircle2,
  Trash2,
  UserCheck,
  UserX,
  RefreshCw,
  HardDrive,
  Cpu,
  Layers,
  Sparkles,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { api, AdminDashboardStats, AdminUser, AdminDataset } from "@/app/api";
import { useAuthStore } from "@/features/auth/authStore";

export function AdminPage() {
  const { user: currentAdmin } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "datasets" | "system">("overview");

  // State
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [datasets, setDatasets] = useState<AdminDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // User Management Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  // Delete User Confirmation Modal State
  const [userToDelete, setUserToDelete] = useState<AdminUser | null>(null);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [statsData, usersData, datasetsData] = await Promise.all([
        api.getAdminDashboard(),
        api.getAdminUsers({ search: searchQuery, status: statusFilter, limit: 50 }),
        api.getAdminDatasets(),
      ]);
      setStats(statsData);
      setUsers(usersData.users);
      setTotalUsers(usersData.total);
      setDatasets(datasetsData);
    } catch (err: any) {
      setFeedbackMsg({
        type: "error",
        text: err.message || "Failed to load administrator telemetry.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [statusFilter]);

  // Handle Search Debounce / Trigger
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsersOnly();
  };

  const fetchUsersOnly = async () => {
    try {
      setActionLoading("search");
      const res = await api.getAdminUsers({ search: searchQuery, status: statusFilter, limit: 50 });
      setUsers(res.users);
      setTotalUsers(res.total);
    } catch (err: any) {
      setFeedbackMsg({ type: "error", text: err.message || "Error searching users." });
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle user status (Activate / Deactivate)
  const handleToggleStatus = async (user: AdminUser) => {
    if (user.id === currentAdmin?.id) {
      setFeedbackMsg({ type: "error", text: "You cannot change status of your own account." });
      return;
    }
    const targetStatus = !user.is_active;
    try {
      setActionLoading(user.id);
      await api.updateUserStatus(user.id, targetStatus);
      setFeedbackMsg({
        type: "success",
        text: `Account for '${user.email}' is now ${targetStatus ? "ACTIVE" : "DEACTIVATED"}.`,
      });
      fetchDashboardData();
    } catch (err: any) {
      setFeedbackMsg({ type: "error", text: err.message || "Failed to update account status." });
    } finally {
      setActionLoading(null);
    }
  };

  // Confirm delete user
  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    try {
      setActionLoading("delete-" + userToDelete.id);
      await api.deleteUser(userToDelete.id);
      setFeedbackMsg({
        type: "success",
        text: `User '${userToDelete.email}' has been safely deleted.`,
      });
      setUserToDelete(null);
      fetchDashboardData();
    } catch (err: any) {
      setFeedbackMsg({ type: "error", text: err.message || "Failed to delete user." });
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "Never";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(dateStr);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 select-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Super Administrator Control Panel
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 uppercase tracking-wider">
              Governance Mode
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Platform-wide identity governance, user management, and dataset usage telemetry
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDashboardData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
            feedbackMsg.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMsg.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedbackMsg.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-600 font-bold ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 text-xs font-medium">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 font-semibold transition ${
            activeTab === "overview"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Activity className="w-4 h-4" />
          Overview & Telemetry
        </button>

        <button
          onClick={() => setActiveTab("users")}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 font-semibold transition ${
            activeTab === "users"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Users className="w-4 h-4" />
          User Management ({totalUsers})
        </button>

        <button
          onClick={() => setActiveTab("datasets")}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 font-semibold transition ${
            activeTab === "datasets"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Database className="w-4 h-4" />
          Dataset Governance ({datasets.length})
        </button>

        <button
          onClick={() => setActiveTab("system")}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 font-semibold transition ${
            activeTab === "system"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Cpu className="w-4 h-4" />
          Infrastructure & AI
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Users
              </span>
              <p className="text-2xl font-extrabold text-slate-900">{stats?.total_users ?? 0}</p>
              <span className="text-[10px] text-slate-400">Registered platform accounts</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                Active Users
              </span>
              <p className="text-2xl font-extrabold text-emerald-600">{stats?.active_users ?? 0}</p>
              <span className="text-[10px] text-slate-400">Can log in and run queries</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wider">
                Inactive Users
              </span>
              <p className="text-2xl font-extrabold text-rose-500">{stats?.inactive_users ?? 0}</p>
              <span className="text-[10px] text-slate-400">Deactivated / Suspended</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
                Total Datasets
              </span>
              <p className="text-2xl font-extrabold text-blue-600">{stats?.total_datasets ?? 0}</p>
              <span className="text-[10px] text-slate-400">In SQLite & DuckDB tables</span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
              <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider">
                Visualizations
              </span>
              <p className="text-2xl font-extrabold text-indigo-600">{stats?.total_charts ?? 0}</p>
              <span className="text-[10px] text-slate-400">Saved charts created</span>
            </div>
          </div>

          {/* Infrastructure Quick Health Panel */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-md space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Infrastructure Health & Architecture
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                OPERATIONAL
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
              <div className="space-y-1 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-sans">Metadata Store</span>
                <p className="font-semibold text-slate-200">{stats?.system_status?.database_type || "SQLite"}</p>
                <p className="text-[10px] text-slate-500 truncate">{stats?.system_status?.database_path}</p>
              </div>

              <div className="space-y-1 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-sans">Analytical Store</span>
                <p className="font-semibold text-slate-200">{stats?.system_status?.analytical_engine || "DuckDB"}</p>
                <p className="text-[10px] text-slate-500">In-process OLAP columnar</p>
              </div>

              <div className="space-y-1 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-sans">Active AI Model</span>
                <p className="font-semibold text-indigo-300 truncate">
                  {stats?.system_status?.llm_model || "openai/gpt-oss-120b"}
                </p>
                <p className="text-[10px] text-slate-500">Provider: {stats?.system_status?.llm_provider}</p>
              </div>

              <div className="space-y-1 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase font-sans">Security Guardrails</span>
                <p className="font-semibold text-emerald-400">Strict RBAC & Tenant Isolation</p>
                <p className="text-[10px] text-slate-500">Cookies HttpOnly / Fernet encryption</p>
              </div>
            </div>
          </div>

          {/* Recent Registrations Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Recent User Registrations
              </h3>
              <button
                onClick={() => setActiveTab("users")}
                className="text-xs text-blue-600 hover:text-blue-700 font-bold"
              >
                View All Users →
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">User</th>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Registered</th>
                    <th className="py-2.5 px-4">Last Login</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats?.recent_registrations?.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
                            {u.full_name?.charAt(0) || "U"}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">{u.full_name}</p>
                            <p className="text-[11px] text-slate-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            u.role === "SUPERADMIN"
                              ? "bg-purple-100 text-purple-700 border border-purple-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            u.is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.is_active ? "bg-emerald-500" : "bg-rose-500"
                            }`}
                          />
                          {u.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                        {formatDate(u.created_at)}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                        {formatDate(u.last_login)}
                      </td>
                    </tr>
                  ))}
                  {(!stats?.recent_registrations || stats.recent_registrations.length === 0) && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No registrations recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USER MANAGEMENT */}
      {activeTab === "users" && (
        <div className="space-y-4">
          {/* Controls: Search & Filter */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="Search by full name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            </form>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> Filter:
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                {(["all", "active", "inactive"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-md capitalize font-medium transition ${
                      statusFilter === s
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Datasets Owned</th>
                    <th className="py-3 px-4">Registered Date</th>
                    <th className="py-3 px-4">Last Activity</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => {
                    const isSelf = u.id === currentAdmin?.id;
                    const isTargetSuper = u.role === "SUPERADMIN";

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/50 transition">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
                              {u.full_name?.charAt(0) || "U"}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold text-slate-900">{u.full_name}</p>
                                {isSelf && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 font-mono">{u.email}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              u.role === "SUPERADMIN"
                                ? "bg-purple-100 text-purple-700 border border-purple-200"
                                : "bg-blue-50 text-blue-700 border border-blue-200"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              u.is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                u.is_active ? "bg-emerald-500" : "bg-rose-500"
                              }`}
                            />
                            {u.is_active ? "Active" : "Deactivated"}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-700">{u.dataset_count}</span>
                          <span className="text-[10px] text-slate-400 ml-1">datasets</span>
                        </td>

                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                          {formatDate(u.created_at)}
                        </td>

                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                          {formatDate(u.last_login)}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Toggle Status Button */}
                            <button
                              onClick={() => handleToggleStatus(u)}
                              disabled={isSelf || (isTargetSuper && u.is_active) || actionLoading === u.id}
                              title={
                                isSelf
                                  ? "Cannot change self"
                                  : isTargetSuper && u.is_active
                                  ? "Cannot deactivate Super Admin"
                                  : u.is_active
                                  ? "Deactivate user"
                                  : "Activate user"
                              }
                              className={`p-1.5 rounded-lg border transition ${
                                u.is_active
                                  ? "text-rose-600 hover:bg-rose-50 border-slate-200 hover:border-rose-200"
                                  : "text-emerald-600 hover:bg-emerald-50 border-slate-200 hover:border-emerald-200"
                              } disabled:opacity-30 disabled:cursor-not-allowed`}
                            >
                              {u.is_active ? (
                                <UserX className="w-3.5 h-3.5" />
                              ) : (
                                <UserCheck className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Delete User Button */}
                            <button
                              onClick={() => setUserToDelete(u)}
                              disabled={isSelf || isTargetSuper || actionLoading === u.id}
                              title={
                                isSelf
                                  ? "Cannot delete self"
                                  : isTargetSuper
                                  ? "Super Admins cannot be deleted"
                                  : "Delete user"
                              }
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        No registered users found matching the filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DATASET GOVERNANCE */}
      {activeTab === "datasets" && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Cross-Platform Dataset Inventory
              </h3>
              <p className="text-[11px] text-slate-500">
                Audit data isolation boundaries and inspect dataset table ownership across all registered clients
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-100 text-slate-700">
              {datasets.length} Total Registered
            </span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Dataset Name</th>
                    <th className="py-3 px-4">Owner / Client</th>
                    <th className="py-3 px-4">Engine / Connection</th>
                    <th className="py-3 px-4">Underlying Table</th>
                    <th className="py-3 px-4">Columns</th>
                    <th className="py-3 px-4">Created Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {datasets.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Database className="w-4 h-4 text-blue-600 shrink-0" />
                          <div>
                            <p className="font-semibold text-slate-900">{d.name}</p>
                            {d.description && (
                              <p className="text-[10px] text-slate-400 truncate max-w-xs">
                                {d.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div>
                          <p className="font-semibold text-slate-800">{d.owner_name || "System"}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{d.owner_email || "System/Built-in"}</p>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {d.database_name}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px] text-slate-700">
                        {d.table_name || "(Virtual SQL)"}
                      </td>

                      <td className="py-3 px-4 font-semibold text-slate-700">
                        {d.column_count} cols
                      </td>

                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                        {formatDate(d.created_at)}
                      </td>
                    </tr>
                  ))}
                  {datasets.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        No datasets registered in system.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SYSTEM MONITORING */}
      {activeTab === "system" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Database & Storage */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
                <HardDrive className="w-4 h-4 text-blue-600" />
                Storage & Database Architecture
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Metadata Database:</span>
                  <span className="font-mono font-semibold text-slate-800">SQLite (aiosqlite)</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Database File Location:</span>
                  <span className="font-mono text-slate-700">backend/data/intelligent_business.db</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Analytical DuckDB Engine:</span>
                  <span className="font-mono font-semibold text-slate-800">DuckDB Columnar Store</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">DuckDB Database File:</span>
                  <span className="font-mono text-slate-700">backend/data/askyourdata.duckdb</span>
                </div>
              </div>
            </div>

            {/* AI Assistant Architecture */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                AI Analyst & LLM Governance
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">AI Engine Status:</span>
                  <span className="font-semibold text-emerald-600">Active & Grounded</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Configured LLM Provider:</span>
                  <span className="font-mono font-semibold text-slate-800">{stats?.system_status?.llm_provider}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Active LLM Model:</span>
                  <span className="font-mono font-semibold text-indigo-700">{stats?.system_status?.llm_model}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Safety Guardrails:</span>
                  <span className="font-semibold text-slate-700">Strict Read-Only SQL & Per-Dataset Grounding</span>
                </div>
              </div>
            </div>

            {/* Authentication & Session Security */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
                <Lock className="w-4 h-4 text-purple-600" />
                Authentication & Cryptography
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Password Hashing:</span>
                  <span className="font-mono font-semibold text-slate-800">Bcrypt (Salt rounds 12)</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Credential Encryption at Rest:</span>
                  <span className="font-mono font-semibold text-slate-800">Fernet 256-bit AES</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Token Transport:</span>
                  <span className="font-mono text-slate-700">HttpOnly Secure Cookies + Bearer Header</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Access Token Lifespan:</span>
                  <span className="font-mono text-slate-700">60 Minutes with Refresh Rotation</span>
                </div>
              </div>
            </div>

            {/* Access Policies */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
                <Layers className="w-4 h-4 text-amber-600" />
                Tenant & Data Isolation
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Dataset Isolation Policy:</span>
                  <span className="font-semibold text-slate-700">Per-user ownership validated</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">AI Context Scope:</span>
                  <span className="font-semibold text-slate-700">Grounded to active dataset/dashboard</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Super Admin Override:</span>
                  <span className="font-semibold text-purple-700">Granted to SUPERADMIN role</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {userToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Delete User Account</h3>
                <p className="text-xs text-slate-500">This action requires administrator confirmation</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to delete the user account for{" "}
              <strong className="text-slate-800">{userToDelete.email}</strong>? The user will immediately lose all access to the analytics workspace and saved dashboards.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={actionLoading === "delete-" + userToDelete.id}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
