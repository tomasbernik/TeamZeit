import type { ArchiveStructureRequest, NamedStructureRequest, OrganisationStructureDto, SetManagerScopeRequest, SetTeamAssignmentRequest } from "@teamzeit/contracts";
import { errorMessageFromResponse } from "../auth/api";
import { webConfig } from "../config/env";
export interface StructureRequestContext { accessToken:string; organizationId:string; fetcher?:typeof fetch; }
const url=(p:string)=>`${webConfig.apiUrl.replace(/\/$/,"")}${p}`;
const headers=(c:StructureRequestContext,mutate=false):HeadersInit=>({Authorization:`Bearer ${c.accessToken}`,"X-Organization-Id":c.organizationId,"Content-Type":"application/json",...(mutate?{"Idempotency-Key":crypto.randomUUID()}:{})});
async function json<T>(pending:Promise<Response>){const r=await pending;if(!r.ok)throw new Error(await errorMessageFromResponse(r,"Die Organisationsstruktur konnte nicht verarbeitet werden."));return r.json() as Promise<T>;}
export function getStructure(c:StructureRequestContext,on=new Date().toISOString().slice(0,10)){return json<OrganisationStructureDto>((c.fetcher??fetch)(url(`/organisation-structure?on=${on}`),{headers:headers(c)}));}
function command(c:StructureRequestContext,path:string,body:unknown,method="POST"){return json<unknown>((c.fetcher??fetch)(url(path),{method,headers:headers(c,true),body:JSON.stringify(body)}));}
export const createLocation=(c:StructureRequestContext,v:NamedStructureRequest)=>command(c,"/organisation-structure/locations",v);
export const archiveLocation=(c:StructureRequestContext,id:string,v:ArchiveStructureRequest)=>command(c,`/organisation-structure/locations/${id}/archive`,v);
export const createTeam=(c:StructureRequestContext,v:NamedStructureRequest)=>command(c,"/organisation-structure/teams",v);
export const archiveTeam=(c:StructureRequestContext,id:string,v:ArchiveStructureRequest)=>command(c,`/organisation-structure/teams/${id}/archive`,v);
export const setAssignment=(c:StructureRequestContext,v:SetTeamAssignmentRequest)=>command(c,"/organisation-structure/assignments",v);
export const setManagerScope=(c:StructureRequestContext,v:SetManagerScopeRequest)=>command(c,"/organisation-structure/manager-scopes",v);
