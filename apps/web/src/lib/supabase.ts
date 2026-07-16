import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { webConfig } from "../config/env";

let client: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  client =
    webConfig.supabaseConfigured && webConfig.supabaseUrl && webConfig.supabaseAnonKey
      ? createClient(webConfig.supabaseUrl, webConfig.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      : null;

  return client;
}
