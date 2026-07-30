import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ApiConfig } from "../config/env.js";
import { resolveCurrentContext, type IdentityContextDependencies } from "../identity/context.js";
import { TimeTrackingError } from "../time-tracking/errors.js";
import { AbsenceService } from "./service.js";
const uuid=z.string().uuid(), date=z.string().date();
const create=z.object({type:z.enum(["vacation","sickness","other"]),startsOn:date,endsOn:date,employeeNote:z.string().max(1000).optional()});
const review=z.object({decision:z.enum(["approved","rejected"]),reviewNote:z.string().max(1000).optional(),expectedVersion:z.number().int().positive()});
export interface AbsenceRouteDependencies {service:AbsenceService;identity?:IdentityContextDependencies}
export function registerAbsenceRoutes(app:FastifyInstance,config:ApiConfig,d:AbsenceRouteDependencies){
  const actor=async(r:FastifyRequest)=>{const org=one(r.headers["x-organization-id"]);if(!org||!uuid.safeParse(org).success)throw new TimeTrackingError("FORBIDDEN","Organisation erforderlich.");const c=await resolveCurrentContext(config,r.headers.authorization,d.identity);const m=c.memberships.find(x=>x.organization.id===org);if(!m)throw new TimeTrackingError("FORBIDDEN","Keine aktive Mitgliedschaft.");return{organizationId:org,membershipId:m.id,userId:c.user.id,role:m.role}};
  app.get("/api/v1/absences",async(r,p)=>run(p,r,async()=>d.service.list(await actor(r))));
  app.post("/api/v1/absences",async(r,p)=>run(p,r,async()=>d.service.create(await actor(r),key(r),create.parse(r.body))));
  app.post("/api/v1/absences/:id/cancel",async(r,p)=>run(p,r,async()=>{const q=z.object({id:uuid}).parse(r.params);const b=z.object({expectedVersion:z.number().int().positive()}).parse(r.body);return d.service.cancel(await actor(r),q.id,key(r),b.expectedVersion)}));
  app.post("/api/v1/absences/:id/review",async(r,p)=>run(p,r,async()=>{const q=z.object({id:uuid}).parse(r.params);return d.service.review(await actor(r),q.id,key(r),review.parse(r.body))}));
}
async function run(p:FastifyReply,r:FastifyRequest,f:()=>Promise<unknown>){try{return await f()}catch(e){if(e instanceof TimeTrackingError)return p.status(e.code==="FORBIDDEN"?403:e.code==="NOT_FOUND"?404:e.code==="VALIDATION_ERROR"?400:e.code==="CONFLICT"?409:500).send({error:{code:e.code,message:e.message,...(e.field?{field:e.field}:{}),requestId:r.id}});if(e instanceof z.ZodError)return p.status(400).send({error:{code:"VALIDATION_ERROR",message:"Ungültige Anfragedaten.",requestId:r.id}});r.log.error(e);return p.status(500).send({error:{code:"INTERNAL_ERROR",message:"Interner Fehler.",requestId:r.id}})}}
function key(r:FastifyRequest){const v=one(r.headers["idempotency-key"]);if(!v||!uuid.safeParse(v).success)throw new TimeTrackingError("VALIDATION_ERROR","Gültiger Idempotency-Key erforderlich.");return v}
function one(v:string|string[]|undefined){return Array.isArray(v)?v[0]:v}
