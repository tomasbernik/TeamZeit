import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ApiConfig } from "../config/env.js";
import { IdentityError, resolveCurrentContext, type IdentityContextDependencies } from "../identity/context.js";
import { OrganisationStructureError, OrganisationStructureService } from "./service.js";

const uuid = z.string().uuid(), date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const named = z.object({ name: z.string().trim().min(1).max(120), locationId: uuid.nullable().optional() });
const archive = z.object({ archived: z.boolean() });
const assignment = z.object({ membershipId: uuid, teamId: uuid, validFrom: date, validUntil: date.nullable().optional(), primary: z.boolean().optional() });
const scope = z.object({ managerMembershipId: uuid, scopeType: z.enum(["location","team"]), locationId: uuid.optional(), teamId: uuid.optional(), validFrom: date, validUntil: date.nullable().optional() })
  .refine(v => v.scopeType === "team" ? !!v.teamId && !v.locationId : !!v.locationId && !v.teamId);
export interface OrganisationStructureRouteDependencies { service: OrganisationStructureService; identity?: IdentityContextDependencies; }

export function registerOrganisationStructureRoutes(app: FastifyInstance, config: ApiConfig, deps: OrganisationStructureRouteDependencies) {
  app.get("/api/v1/organisation-structure", (q,r) => handle(q,r,config,deps,a => deps.service.read(a, parse(z.object({ on: date.optional() }), q.query).on ?? new Date().toISOString().slice(0,10))));
  app.post("/api/v1/organisation-structure/locations", (q,r) => handle(q,r,config,deps,a => deps.service.createLocation(a,key(q),parse(named,q.body))));
  app.patch("/api/v1/organisation-structure/locations/:id", (q,r) => handle(q,r,config,deps,a => deps.service.updateLocation(a,parseId(q),key(q),parse(named,q.body))));
  app.post("/api/v1/organisation-structure/locations/:id/archive", (q,r) => handle(q,r,config,deps,a => deps.service.archiveLocation(a,parseId(q),key(q),parse(archive,q.body))));
  app.post("/api/v1/organisation-structure/teams", (q,r) => handle(q,r,config,deps,a => deps.service.createTeam(a,key(q),parse(named,q.body))));
  app.patch("/api/v1/organisation-structure/teams/:id", (q,r) => handle(q,r,config,deps,a => deps.service.updateTeam(a,parseId(q),key(q),parse(named,q.body))));
  app.post("/api/v1/organisation-structure/teams/:id/archive", (q,r) => handle(q,r,config,deps,a => deps.service.archiveTeam(a,parseId(q),key(q),parse(archive,q.body))));
  app.post("/api/v1/organisation-structure/assignments", (q,r) => handle(q,r,config,deps,a => deps.service.assignTeam(a,key(q),parse(assignment,q.body))));
  app.post("/api/v1/organisation-structure/manager-scopes", (q,r) => handle(q,r,config,deps,a => deps.service.setScope(a,key(q),parse(scope,q.body))));
}
async function handle<T>(request: FastifyRequest, reply: FastifyReply, config: ApiConfig, deps: OrganisationStructureRouteDependencies, action: (a:{organizationId:string;membershipId:string;userId:string;role:"owner"|"admin"|"manager"|"employee"|"auditor"})=>Promise<T>) {
  try { const organizationId = one(request.headers["x-organization-id"]); if (!organizationId || !uuid.safeParse(organizationId).success) throw new OrganisationStructureError("FORBIDDEN","Organisation erforderlich."); const current=await resolveCurrentContext(config,request.headers.authorization,deps.identity); const m=current.memberships.find(x=>x.organization.id===organizationId&&x.status==="active"); if(!m) throw new OrganisationStructureError("FORBIDDEN","Keine aktive Mitgliedschaft für diese Organisation."); return await action({organizationId,membershipId:m.id,userId:current.user.id,role:m.role}); }
  catch(error){ if(error instanceof IdentityError)return reply.status(error.statusCode).send({error:{code:error.code,message:error.message,requestId:request.id}}); if(error instanceof OrganisationStructureError)return reply.status(error.code==="FORBIDDEN"?403:error.code==="NOT_FOUND"?404:error.code==="VALIDATION_ERROR"?400:error.code==="CONFLICT"?409:500).send({error:{code:error.code,message:error.message,requestId:request.id}}); request.log.error(error); return reply.status(500).send({error:{code:"INTERNAL_ERROR",message:"Interner Fehler.",requestId:request.id}}); }
}
function parse<T>(s:z.ZodType<T>,v:unknown):T{const x=s.safeParse(v);if(!x.success)throw new OrganisationStructureError("VALIDATION_ERROR","Anfrageinhalt ist ungültig.");return x.data;}
function parseId(q:FastifyRequest){return parse(z.object({id:uuid}),q.params).id;}
function key(q:FastifyRequest){const v=one(q.headers["idempotency-key"]);if(!v||!uuid.safeParse(v).success)throw new OrganisationStructureError("VALIDATION_ERROR","Gültiger Idempotency-Key erforderlich.");return v;}
function one(v:string|string[]|undefined){return Array.isArray(v)?v[0]:v;}
