import type { AbsenceListResponse, AbsenceRequestDto, CreateAbsenceRequest, ReviewAbsenceRequest } from "@teamzeit/contracts";
import { errorMessageFromResponse } from "../auth/api";
import { webConfig } from "../config/env";
interface Context{accessToken:string;organizationId:string;fetcher?:typeof fetch}
const headers=(c:Context,key?:string)=>({Authorization:`Bearer ${c.accessToken}`,"X-Organization-Id":c.organizationId,...(key?{"Idempotency-Key":key}:{}),"Content-Type":"application/json"});
async function json<T>(r:Promise<Response>){const x=await r;if(!x.ok)throw new Error(await errorMessageFromResponse(x,"Abwesenheit konnte nicht verarbeitet werden."));return x.json() as Promise<T>}
export const fetchAbsences=(c:Context)=>json<AbsenceListResponse>((c.fetcher??fetch)(`${webConfig.apiUrl}/absences`,{headers:headers(c)}));
export const createAbsence=(c:Context,input:CreateAbsenceRequest)=>json<AbsenceRequestDto>((c.fetcher??fetch)(`${webConfig.apiUrl}/absences`,{method:"POST",headers:headers(c,crypto.randomUUID()),body:JSON.stringify(input)}));
export const cancelAbsence=(c:Context,item:AbsenceRequestDto)=>json<AbsenceRequestDto>((c.fetcher??fetch)(`${webConfig.apiUrl}/absences/${item.id}/cancel`,{method:"POST",headers:headers(c,crypto.randomUUID()),body:JSON.stringify({expectedVersion:item.version})}));
export const reviewAbsence=(c:Context,item:AbsenceRequestDto,input:ReviewAbsenceRequest)=>json<AbsenceRequestDto>((c.fetcher??fetch)(`${webConfig.apiUrl}/absences/${item.id}/review`,{method:"POST",headers:headers(c,crypto.randomUUID()),body:JSON.stringify(input)}));
