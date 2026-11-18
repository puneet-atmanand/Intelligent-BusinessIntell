import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sun, Moon, RotateCcw, LogOut, Shield } from "lucide-react";
import { useAuthStore } from "@/features/auth/authStore";

export function TopBar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const isSuperAdmin =
    user?.is_superuser ||
    user?.role === "SUPERADMIN" ||
    user?.roles?.some((r) => r.name === "Admin" || r.name === "Superadmin");

  const toggleTheme = () => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.remove("dark");
      setIsDark(false);
    } else {
      root.classList.add("dark");
      setIsDark(true);
    }
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await logout();
    navigate("/login");
  };

  return (
    <header className="h-14 border-b border-border/80 bg-card px-6 flex items-center justify-between z-10">
      {/* Title / Breadcrumb */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Analytics Workspace</h2>
        {isSuperAdmin && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            SUPERADMIN
          </span>
        )}
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Toggle light/dark theme"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 p-1.5 rounded-full hover:bg-accent text-xs font-medium transition-colors"
          >
            <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
              {user?.full_name?.charAt(0) || "U"}
            </div>
            <span className="text-xs text-foreground font-medium hidden sm:inline-block">
              {user?.full_name || user?.email}
            </span>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl z-50">
              <div className="px-3 py-2 border-b border-border text-xs">
                <p className="font-semibold text-foreground truncate">{user?.full_name}</p>
                <p className="text-muted-foreground truncate text-[11px] font-mono">{user?.email}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      isSuperAdmin
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                        : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                    }`}
                  >
                    {isSuperAdmin ? "Super Administrator" : "Standard User"}
                  </span>
                </div>
              </div>

              {isSuperAdmin && (
                <Link
                  to="/admin"
                  onClick={() => setUserMenuOpen(false)}
                  className="w-full mt-1 flex items-center gap-2 px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Admin Control Panel
                </Link>
              )}

              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  window.location.reload();
                }}
                className="w-full mt-1 flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent rounded-lg transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Refresh Workspace
              </button>

              <button
                onClick={handleLogout}
                className="w-full mt-1 flex items-center gap-2 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors font-medium border-t border-border"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
