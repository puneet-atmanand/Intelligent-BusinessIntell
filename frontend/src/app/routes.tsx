import { createBrowserRouter, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { AppShell } from "@/app/layout/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { SuperLoginPage } from "@/features/auth/SuperLoginPage";
import { HomePage } from "@/features/home/HomePage";
import { DashboardsPage } from "@/features/dashboards/DashboardsPage";
import { ChartsPage } from "@/features/charts/ChartsPage";
import { DatasetsPage } from "@/features/datasets/DatasetsPage";
import { SqlLabPage } from "@/features/sqllab/SqlLabPage";
import { DatabasesPage } from "@/features/databases/DatabasesPage";
import { UploadsPage } from "@/features/uploads/UploadsPage";
import { ApiConnectionsPage } from "@/features/api_connect/ApiConnectionsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { AdminPage } from "@/features/admin/AdminPage";

export const router = createBrowserRouter([
  // Public Authentication Portals
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/register",
    element: <RegisterPage />,
  },
  {
    path: "/forgot-password",
    element: <ForgotPasswordPage />,
  },
  {
    path: "/super-login",
    element: <SuperLoginPage />,
  },

  // Protected Application Shell (Client / BI Workspace)
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "dashboards",
        element: <DashboardsPage />,
      },
      {
        path: "dashboards/:slug",
        element: <DashboardsPage />,
      },
      {
        path: "charts",
        element: <ChartsPage />,
      },
      {
        path: "datasets",
        element: <DatasetsPage />,
      },
      {
        path: "datasets/:id",
        element: <DatasetsPage />,
      },
      {
        path: "sqllab",
        element: <SqlLabPage />,
      },
      {
        path: "databases",
        element: <DatabasesPage />,
      },
      {
        path: "uploads",
        element: <UploadsPage />,
      },
      {
        path: "api-connect",
        element: <ApiConnectionsPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "admin",
        element: (
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        ),
      },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
