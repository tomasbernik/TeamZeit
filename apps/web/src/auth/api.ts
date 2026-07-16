import type { CurrentContextResponse } from "@teamzeit/contracts";

import { webConfig } from "../config/env";

export async function fetchCurrentContext(accessToken: string, fetcher: typeof fetch = fetch): Promise<CurrentContextResponse> {
  const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
  const response = await fetcher(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(response.status === 401 ? "Die Sitzung ist abgelaufen." : "Der Organisationskontext konnte nicht geladen werden.");
  }

  return (await response.json()) as CurrentContextResponse;
}
