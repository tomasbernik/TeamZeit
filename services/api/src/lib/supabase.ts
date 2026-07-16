import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ApiConfig } from "../config/env.js";

export function createSupabaseClient(config: ApiConfig, accessToken?: string): SupabaseClient | null {
  if (!config.supabaseConfigured || !config.supabaseUrl || !config.supabaseAnonKey) return null;

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}
