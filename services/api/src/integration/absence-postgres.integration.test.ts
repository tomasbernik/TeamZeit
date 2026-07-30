import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ids, requireLocalSupabase, serviceClient, userClient } from "./supabase-local.js";
import { PostgresAbsenceRepository } from "../absence/postgres-repository.js";
const env=requireLocalSupabase();
describe("absence PostgreSQL and RLS",()=>{
  it("creates idempotently, audits, and isolates employee reads",async()=>{
    const db=serviceClient(env),repo=new PostgresAbsenceRepository(db);
    const actor={organizationId:ids.orgNorth,membershipId:ids.employeeOneMembership,userId:ids.employeeOneUser,role:"employee" as const};
    const key=randomUUID(), input={type:"vacation",startsOn:"2037-09-01",endsOn:"2037-09-02"};
    const created=await repo.command(actor,"create",key,input);
    expect(await repo.command(actor,"create",key,input)).toEqual(created);
    const own=await userClient(env,ids.employeeOneUser).from("absence_requests").select("id").eq("id",created.id);
    const colleague=await userClient(env,ids.employeeTwoUser).from("absence_requests").select("id").eq("id",created.id);
    expect(own.data).toHaveLength(1);expect(colleague.data).toHaveLength(0);
    const audit=await db.from("audit_events").select("action").eq("request_id",key);
    expect(audit.data).toEqual([{action:"absence_request.create"}]);
    await repo.command(actor,"cancel",randomUUID(),{id:created.id,expectedVersion:created.version});
  });
  it("allows scoped manager review and rejects self review",async()=>{
    const repo=new PostgresAbsenceRepository(serviceClient(env));
    const employee={organizationId:ids.orgNorth,membershipId:ids.employeeOneMembership,userId:ids.employeeOneUser,role:"employee" as const};
    const item=await repo.command(employee,"create",randomUUID(),{type:"other",startsOn:"2026-06-11",endsOn:"2026-06-11"});
    const manager={organizationId:ids.orgNorth,membershipId:ids.managerMembership,userId:ids.managerUser,role:"manager" as const};
    expect((await repo.command(manager,"review",randomUUID(),{id:item.id,decision:"rejected",expectedVersion:1})).status).toBe("rejected");
    await expect(repo.command(employee,"review",randomUUID(),{id:item.id,decision:"rejected",expectedVersion:2})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("lists only own and effectively scoped requests for a manager",async()=>{
    const repo=new PostgresAbsenceRepository(serviceClient(env));
    const inScopeEmployee={organizationId:ids.orgNorth,membershipId:ids.employeeOneMembership,userId:ids.employeeOneUser,role:"employee" as const};
    const outOfScopeEmployee={organizationId:ids.orgNorth,membershipId:ids.employeeTwoMembership,userId:ids.employeeTwoUser,role:"employee" as const};
    const manager={organizationId:ids.orgNorth,membershipId:ids.managerMembership,userId:ids.managerUser,role:"manager" as const};
    const inScope=await repo.command(inScopeEmployee,"create",randomUUID(),{type:"vacation",startsOn:"2026-06-18",endsOn:"2026-06-18"});
    const outOfScope=await repo.command(outOfScopeEmployee,"create",randomUUID(),{type:"other",startsOn:"2026-06-18",endsOn:"2026-06-18"});
    const listed=await repo.list(manager);
    expect(listed.items.map(item=>item.id)).toContain(inScope.id);
    expect(listed.items.map(item=>item.id)).not.toContain(outOfScope.id);
    await repo.command(inScopeEmployee,"cancel",randomUUID(),{id:inScope.id,expectedVersion:inScope.version});
    await repo.command(outOfScopeEmployee,"cancel",randomUUID(),{id:outOfScope.id,expectedVersion:outOfScope.version});
  });
  it("rejects overlapping pending requests for the same employee",async()=>{
    const repo=new PostgresAbsenceRepository(serviceClient(env));
    const employee={organizationId:ids.orgNorth,membershipId:ids.employeeOneMembership,userId:ids.employeeOneUser,role:"employee" as const};
    const day=String(10+Math.floor(Math.random()*10)).padStart(2,"0");
    const startsOn=`2038-05-${day}`,endsOn=`2038-05-${Number(day)+2}`;
    const first=await repo.command(employee,"create",randomUUID(),{type:"vacation",startsOn,endsOn});
    await expect(repo.command(employee,"create",randomUUID(),{type:"other",startsOn:endsOn,endsOn})).rejects.toMatchObject({
      code:"VALIDATION_ERROR",
      field:"startsOn",
    });
    await repo.command(employee,"cancel",randomUUID(),{id:first.id,expectedVersion:first.version});
  });
});
