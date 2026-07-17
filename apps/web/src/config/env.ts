export interface WebConfig {
  apiUrl: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseConfigured: boolean;
}

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readWebConfig(env: ImportMetaEnv = import.meta.env): WebConfig {
  const supabaseUrl = optionalValue(env.VITE_SUPABASE_URL);
  const supabaseAnonKey = optionalValue(env.VITE_SUPABASE_PUBLISHABLE_KEY) ?? optionalValue(env.VITE_SUPABASE_ANON_KEY);

  return {
    apiUrl: optionalValue(env.VITE_API_URL) ?? "/api/v1",
    ...(supabaseUrl ? { supabaseUrl } : {}),
    ...(supabaseAnonKey ? { supabaseAnonKey } : {}),
    supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  };
}

export const webConfig = readWebConfig();
