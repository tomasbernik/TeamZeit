import type { AbsenceListResponse, AbsenceRequestDto } from "@teamzeit/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TimeTrackingError } from "../time-tracking/errors.js";
import type { AbsenceActor, AbsenceRepository } from "./types.js";
export class PostgresAbsenceRepository implements AbsenceRepository {
  constructor(private readonly client: SupabaseClient) {}
  async list(actor: AbsenceActor): Promise<AbsenceListResponse> {
    const {data,error}=await this.client.rpc("absence_list",{
      target_organization_id:actor.organizationId,
      actor_membership_id:actor.membershipId,
      actor_user_id:actor.userId,
    });
    if(error)throw mapped(error.message);
    return {items:(data??[]).map(map)};
  }
  async command(actor:AbsenceActor,operation:"create"|"cancel"|"review",requestId:string,input:Record<string,unknown>){
    const {data,error}=await this.client.rpc("absence_apply",{target_organization_id:actor.organizationId,actor_membership_id:actor.membershipId,actor_user_id:actor.userId,command_operation:operation,command_request_id:requestId,command:input});
    if(error||!data)throw mapped(error?.message??""); return data as AbsenceRequestDto;
  }
}
function map(r:Record<string,unknown>):AbsenceRequestDto{return {id:String(r.id),organizationId:String(r.organization_id),membershipId:String(r.membership_id),type:r.type as AbsenceRequestDto["type"],startsOn:String(r.starts_on),endsOn:String(r.ends_on),status:r.status as AbsenceRequestDto["status"],...(r.employee_note?{employeeNote:String(r.employee_note)}:{}),...(r.review_note?{reviewNote:String(r.review_note)}:{}),...(r.reviewed_by_membership_id?{reviewedByMembershipId:String(r.reviewed_by_membership_id)}:{}),...(r.reviewed_at?{reviewedAt:String(r.reviewed_at)}:{}),createdAt:String(r.created_at),version:Number(r.version)}}
function mapped(m:string){if(m.includes("absence_forbidden"))return new TimeTrackingError("FORBIDDEN","Keine Berechtigung.");if(m.includes("absence_not_found"))return new TimeTrackingError("NOT_FOUND","Antrag nicht gefunden.");if(m.includes("absence_conflict"))return new TimeTrackingError("CONFLICT","Der Antrag wurde bereits geändert.");if(m.includes("absence_overlap"))return new TimeTrackingError("VALIDATION_ERROR","Für diesen Zeitraum besteht bereits eine offene oder genehmigte Abwesenheit.","startsOn");if(m.includes("absence_validation"))return new TimeTrackingError("VALIDATION_ERROR","Ungültige Abwesenheitsdaten.");return new TimeTrackingError("INTERNAL_ERROR","Abwesenheit konnte nicht verarbeitet werden.");}
