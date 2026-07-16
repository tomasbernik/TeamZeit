import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, type AuthProviderDependencies } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { AbsencesPage, AttendancePage, EmployeesPage, SettingsPage, TodayPage } from "./pages/pages";

export function App({ authDependencies }: { authDependencies?: AuthProviderDependencies }) {
  return (
    <AuthProvider {...(authDependencies ? { dependencies: authDependencies } : {})}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<TodayPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="absences" element={<AbsencesPage />} />
            <Route path="employees" element={<EmployeesPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
