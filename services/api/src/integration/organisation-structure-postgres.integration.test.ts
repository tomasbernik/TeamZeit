import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PostgresOrganisationStructureRepository } from "../organisation-structure/postgres-repository.js";
import { ids, requireLocalSupabase, serviceClient, userClient } from "./supabase-local.js";
const env=requireLocalSupabase();
describe("organisation structure PostgreSQL and RLS",()=>{
  beforeAll(async()=>{const c=serviceClient(env);const {error}=await c.from("locations").select("id").limit(1);if(error)throw new Error(error.message);});
  it("denies anonymous and employee structure rows while admin and owner see tenant rows",async()=>{
    const anon=(await fetch(`${env.url}/rest/v1/locations?select=id`,{headers:{apikey:env.publishableKey}}));expect(anon.ok).toBe(false);
    const employee=await userClient(env,ids.employeeOneUser).from("locations").select("id");expect(employee.data).toEqual([]);
    const admin=await userClient(env,ids.adminUser).from("locations").select("id");expect(admin.data?.length).toBeGreaterThan(0);
    const owner=await userClient(env,ids.ownerUser).from("locations").select("id");expect(owner.data?.length).toBeGreaterThan(0);
    const foreign=await userClient(env,ids.employeeOneUser).from("locations").select("id").eq("organization_id",ids.orgSouth);expect(foreign.data).toEqual([]);
  });
  it("denies an inactive account immediately",async()=>{
    const inactive=await userClient(env,ids.inactiveAdminUser).from("locations").select("id");expect(inactive.data).toEqual([]);
  });
  it("limits a manager to scope and evaluates assignments on the target historical date",async()=>{
    const repo=new PostgresOrganisationStructureRepository(userClient(env,ids.managerUser));
    const actor={organizationId:ids.orgNorth,membershipId:ids.managerMembership,userId:ids.managerUser,role:"manager" as const};
    const current=await repo.read(actor,"2026-07-15");expect(current.teams.map(x=>x.id)).toContain("50000000-0000-4000-8000-000000000001");expect(current.assignments.map(x=>x.membershipId)).toContain(ids.employeeOneMembership);expect(current.assignments.map(x=>x.membershipId)).not.toContain(ids.employeeTwoMembership);
    const before=await repo.read(actor,"2025-12-31");expect(before.assignments).toEqual([]);
  });
  it("makes admin commands idempotent and creates one immutable audit event",async()=>{
    const repo=new PostgresOrganisationStructureRepository(serviceClient(env));
    const actor={organizationId:ids.orgNorth,membershipId:ids.adminMembership,userId:ids.adminUser,role:"admin" as const};
    const key=randomUUID();const name=`Integration ${key.slice(0,8)}`;
    const first=await repo.command(actor,"create_location",key,{name});const second=await repo.command(actor,"create_location",key,{name:"ignored"});
    expect(second).toEqual(first);
    const audits=await serviceClient(env).from("audit_events").select("id").eq("organization_id",ids.orgNorth).eq("request_id",key);
    expect(audits.data).toHaveLength(1);
  });
  it("keeps archived locations and teams instead of deleting them",async()=>{
    const repo=new PostgresOrganisationStructureRepository(serviceClient(env));const actor={organizationId:ids.orgNorth,membershipId:ids.ownerMembership,userId:ids.ownerUser,role:"owner" as const};
    const location=await repo.command(actor,"create_location",randomUUID(),{name:`Archiv ${randomUUID().slice(0,8)}`}) as unknown as {id:string};
    const team=await repo.command(actor,"create_team",randomUUID(),{name:`Archiv-Team ${randomUUID().slice(0,8)}`,locationId:location.id}) as unknown as {id:string};
    await repo.command(actor,"archive_location",randomUUID(),{id:location.id,archived:true});
    await repo.command(actor,"archive_team",randomUUID(),{id:team.id,archived:true});
    const row=await serviceClient(env).from("locations").select("id,archived_at").eq("id",location.id).single();expect(row.data?.archived_at).toBeTruthy();
    const teamRow=await serviceClient(env).from("teams").select("id,archived_at").eq("id",team.id).single();expect(teamRow.data?.archived_at).toBeTruthy();
  });
});
