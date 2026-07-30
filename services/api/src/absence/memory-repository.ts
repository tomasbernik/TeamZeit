import { randomUUID } from "node:crypto";
import type { AbsenceListResponse, AbsenceRequestDto } from "@teamzeit/contracts";
import { TimeTrackingError } from "../time-tracking/errors.js";
import type { AbsenceActor, AbsenceRepository } from "./types.js";
export class InMemoryAbsenceRepository implements AbsenceRepository {
  private items: AbsenceRequestDto[] = []; private results = new Map<string, AbsenceRequestDto>();
  async list(actor: AbsenceActor): Promise<AbsenceListResponse> { return { items: structuredClone(this.items.filter(x => x.organizationId === actor.organizationId && (x.membershipId === actor.membershipId || actor.role !== "employee"))) }; }
  async command(actor: AbsenceActor, op: "create"|"cancel"|"review", key: string, input: Record<string, unknown>) {
    const k=`${actor.organizationId}:${actor.membershipId}:${key}`; const prior=this.results.get(k); if(prior)return structuredClone(prior);
    let item: AbsenceRequestDto;
    if(op==="create"){const startsOn=String(input.startsOn),endsOn=String(input.endsOn);const overlap=this.items.some(x=>x.organizationId===actor.organizationId&&x.membershipId===actor.membershipId&&["pending","approved"].includes(x.status)&&x.startsOn<=endsOn&&x.endsOn>=startsOn);if(overlap)throw new TimeTrackingError("VALIDATION_ERROR","Für diesen Zeitraum besteht bereits eine offene oder genehmigte Abwesenheit.","startsOn");item={id:randomUUID(),organizationId:actor.organizationId,membershipId:actor.membershipId,type:input.type as AbsenceRequestDto["type"],startsOn,endsOn,status:"pending",...(input.employeeNote?{employeeNote:String(input.employeeNote)}:{}),createdAt:new Date().toISOString(),version:1};this.items.push(item);}
    else {const found=this.items.find(x=>x.id===input.id);if(!found)throw new Error("absence_not_found");item={...found,status:op==="cancel"?"cancelled":input.decision as "approved"|"rejected",version:found.version+1};this.items=this.items.map(x=>x.id===item.id?item:x);}
    this.results.set(k,item);return structuredClone(item);
  }
}
