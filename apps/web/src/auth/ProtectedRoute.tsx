import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "./AuthProvider";

export function ProtectedRoute() {
  const location = useLocation();
  const { activeMembership, error, loading, session, signOut, supabaseConfigured } = useAuth();

  if (loading) {
    return (
      <main className="center-shell" aria-busy="true">
        <section className="status-panel">
          <p className="eyebrow">Anmeldung</p>
          <h1>Sitzung wird geladen.</h1>
        </section>
      </main>
    );
  }

  if (!supabaseConfigured || !session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (error) {
    return (
      <main className="center-shell">
        <section className="status-panel" role="alert">
          <p className="eyebrow">Fehler</p>
          <h1>Zugriff nicht möglich.</h1>
          <p className="page-intro">{error}</p>
          <button className="secondary-button compact-button" type="button" onClick={() => void signOut()}>
            Abmelden
          </button>
        </section>
      </main>
    );
  }

  if (!activeMembership) {
    return (
      <main className="center-shell">
        <section className="status-panel" role="alert">
          <p className="eyebrow">Organisation</p>
          <h1>Keine aktive Mitgliedschaft.</h1>
          <p className="page-intro">Dein Konto hat aktuell keinen Zugriff auf eine TeamZeit-Organisation.</p>
          <button className="secondary-button compact-button" type="button" onClick={() => void signOut()}>
            Abmelden
          </button>
        </section>
      </main>
    );
  }

  return <Outlet />;
}
