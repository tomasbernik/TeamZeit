import type { MonthClosureDto } from "@teamzeit/contracts";
import { errorMessageFromResponse } from "../auth/api";
import { webConfig } from "../config/env";

interface RequestContext { accessToken: string; organizationId: string; fetcher?: typeof fetch; }

export async function fetchMonthClosure(context: RequestContext, membershipId: string, month: string): Promise<MonthClosureDto> {
  const response = await (context.fetcher ?? fetch)(`${webConfig.apiUrl.replace(/\/$/, "")}/month-closures/${membershipId}/${month}`, {
    headers: { Authorization: `Bearer ${context.accessToken}`, "X-Organization-Id": context.organizationId },
  });
  if (!response.ok) throw new Error(await errorMessageFromResponse(response, "Der Monatsstatus konnte nicht geladen werden."));
  return (await response.json()) as MonthClosureDto;
}
