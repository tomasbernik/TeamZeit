import type { ApiError, CurrentContextResponse } from "@teamzeit/contracts";

import { webConfig } from "../config/env";

export async function fetchCurrentContext(accessToken: string, fetcher: typeof fetch = fetch): Promise<CurrentContextResponse> {
  const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "Die Sitzung ist abgelaufen." : await errorMessageFromResponse(response, "Der Organisationskontext konnte nicht geladen werden."));
  }

  return (await response.json()) as CurrentContextResponse;
}

export async function errorMessageFromResponse(response: Response, fallback: string): Promise<string> {
  if (response.status >= 500) return fallback;

  try {
    const payload = (await response.json()) as Partial<ApiError>;
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}
