import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import type { CurrentContextResponse, MembershipSummary, UUID } from "@teamzeit/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { webConfig } from "../config/env";
import { getSupabaseClient } from "../lib/supabase";
import { fetchCurrentContext } from "./api";

const activeOrganizationStorageKey = "teamzeit.activeOrganizationId";

export interface AuthState {
  session: Session | null;
  context: CurrentContextResponse | null;
  activeMembership: MembershipSummary | null;
  activeMemberships: MembershipSummary[];
  loading: boolean;
  error: string | null;
  supabaseConfigured: boolean;
}

interface AuthContextValue extends AuthState {
  signInWithEmail: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  selectOrganization: (organizationId: UUID) => void;
  refreshContext: () => Promise<void>;
}

export interface AuthProviderDependencies {
  supabaseClient?: SupabaseClient | null;
  fetchContext?: (accessToken: string) => Promise<CurrentContextResponse>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function activeMembershipsFrom(context: CurrentContextResponse | null): MembershipSummary[] {
  return context?.memberships.filter((membership) => membership.status === "active") ?? [];
}

function chooseActiveMembership(
  memberships: MembershipSummary[],
  preferredOrganizationId: string | null,
): MembershipSummary | null {
  return memberships.find((membership) => membership.organization.id === preferredOrganizationId) ?? memberships[0] ?? null;
}

export function AuthProvider({ children, dependencies = {} }: { children: ReactNode; dependencies?: AuthProviderDependencies }) {
  const supabase = dependencies.supabaseClient !== undefined ? dependencies.supabaseClient : getSupabaseClient();
  const storage = dependencies.storage ?? window.localStorage;
  const loadContext = dependencies.fetchContext ?? fetchCurrentContext;
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<CurrentContextResponse | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(() =>
    storage.getItem(activeOrganizationStorageKey),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyContext = useCallback(
    (nextContext: CurrentContextResponse | null) => {
      setContext(nextContext);
      const memberships = activeMembershipsFrom(nextContext);
      const selected = chooseActiveMembership(memberships, storage.getItem(activeOrganizationStorageKey));

      if (selected) {
        storage.setItem(activeOrganizationStorageKey, selected.organization.id);
        setActiveOrganizationId(selected.organization.id);
      } else {
        storage.removeItem(activeOrganizationStorageKey);
        setActiveOrganizationId(null);
      }
    },
    [storage],
  );

  const refreshContext = useCallback(async () => {
    if (!session) {
      applyContext(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      applyContext(await loadContext(session.access_token));
    } catch (loadError) {
      applyContext(null);
      setError(loadError instanceof Error ? loadError.message : "Der Organisationskontext konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [applyContext, loadContext, session]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!supabase) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await supabase.auth.getSession();
      if (cancelled) return;

      if (result.error) {
        setError("Die Sitzung konnte nicht wiederhergestellt werden.");
        setLoading(false);
        return;
      }

      setSession(result.data.session);
      if (!result.data.session) setLoading(false);
    }

    void restoreSession();

    const subscription = supabase?.auth.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);
      if (event === "SIGNED_OUT" || !nextSession) {
        applyContext(null);
      }
    }).data.subscription;

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, [applyContext, supabase]);

  useEffect(() => {
    if (!session) return;

    void Promise.resolve().then(() => refreshContext());
  }, [refreshContext, session]);

  const activeMemberships = activeMembershipsFrom(context);
  const activeMembership = chooseActiveMembership(activeMemberships, activeOrganizationId);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      context,
      activeMembership,
      activeMemberships,
      loading,
      error,
      supabaseConfigured: dependencies.supabaseClient !== undefined ? Boolean(supabase) : webConfig.supabaseConfigured && Boolean(supabase),
      async signInWithEmail(email: string) {
        if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
        setError(null);
        const result = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (result.error) throw new Error(result.error.message);
      },
      async signInWithGoogle() {
        if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
        setError(null);
        const result = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
        if (result.error) throw new Error(result.error.message);
      },
      async signOut() {
        try {
          const result = await supabase?.auth.signOut();
          if (result?.error) setError(result.error.message);
        } catch {
          setError("Die Abmeldung konnte nicht mit Supabase synchronisiert werden.");
        } finally {
          setSession(null);
          applyContext(null);
        }
      },
      selectOrganization(organizationId: UUID) {
        if (!activeMemberships.some((membership) => membership.organization.id === organizationId)) return;
        storage.setItem(activeOrganizationStorageKey, organizationId);
        setActiveOrganizationId(organizationId);
      },
      refreshContext,
    }),
    [
      activeMembership,
      activeMemberships,
      applyContext,
      context,
      dependencies.supabaseClient,
      error,
      loading,
      refreshContext,
      session,
      storage,
      supabase,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
