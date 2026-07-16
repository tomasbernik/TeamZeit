import { webConfig } from "../config/env";

export function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <a className="brand brand-centered" href="/">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>TeamZeit</span>
        </a>
        <p className="eyebrow">Willkommen</p>
        <h1 id="login-title">Einfach im Team arbeiten.</h1>
        <p className="page-intro">Melde dich an, um deine Arbeitszeit und Abwesenheiten zu verwalten.</p>
        <button className="primary-button" type="button" disabled={!webConfig.supabaseConfigured}>
          Mit E-Mail anmelden
        </button>
        <button className="secondary-button" type="button" disabled={!webConfig.supabaseConfigured}>
          Mit Google fortfahren
        </button>
        {!webConfig.supabaseConfigured && (
          <p className="config-note" role="status">Für die Anmeldung muss zuerst Supabase in der lokalen Umgebung konfiguriert werden.</p>
        )}
      </section>
    </main>
  );
}
