import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, type AuthProviderDependencies } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { AttendancePage, EmployeesPage, OrganisationStructurePage, ReportsPage, TodayPage } from "./pages/pages";

export function App({ authDependencies }: { authDependencies?: AuthProviderDependencies }) {
  return (
    <AuthProvider {...(authDependencies ? { dependencies: authDependencies } : {})}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<TodayPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="organisation-structure" element={<OrganisationStructurePage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
