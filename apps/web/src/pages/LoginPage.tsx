import { FormEvent, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";

export function LoginPage() {
  const location = useLocation();
  const { activeMembership, error: authError, loading, session, signInWithEmail, signInWithGoogle, supabaseConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"email" | "google" | null>(null);

  if (!loading && session && activeMembership) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting("email");
    setFormError(null);
    setNotice(null);

    try {
      await signInWithEmail(email);
      setNotice("Pruefe dein Postfach fuer den Anmeldelink.");
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "Die Anmeldung ist fehlgeschlagen.");
    } finally {
      setSubmitting(null);
    }
  }

  async function submitGoogle() {
    setSubmitting("google");
    setFormError(null);
    setNotice(null);

    try {
      await signInWithGoogle();
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "Die Anmeldung ist fehlgeschlagen.");
      setSubmitting(null);
    }
  }

  const disabled = !supabaseConfigured || Boolean(submitting);

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
        <form className="login-form" onSubmit={(event) => void submitEmail(event)}>
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            autoComplete="email"
            inputMode="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={disabled}
          />
          <button className="primary-button" type="submit" disabled={disabled}>
            {submitting === "email" ? "Link wird gesendet" : "Mit E-Mail anmelden"}
          </button>
        </form>
        <button className="secondary-button" type="button" disabled={disabled} onClick={() => void submitGoogle()}>
          {submitting === "google" ? "Weiterleitung" : "Mit Google fortfahren"}
        </button>
        {!supabaseConfigured && (
          <p className="config-note" role="status">Fuer die Anmeldung muss zuerst Supabase in der lokalen Umgebung konfiguriert werden.</p>
        )}
        {(formError || authError) && <p className="error-note" role="alert">{formError ?? authError}</p>}
        {notice && <p className="success-note" role="status">{notice}</p>}
      </section>
    </main>
  );
}
