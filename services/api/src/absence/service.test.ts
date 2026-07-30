import { describe, expect, it } from "vitest";
import { InMemoryAbsenceRepository } from "./memory-repository.js";
import { AbsenceService } from "./service.js";
const actor={organizationId:"20000000-0000-4000-8000-000000000001",membershipId:"30000000-0000-4000-8000-000000000001",userId:"10000000-0000-4000-8000-000000000001",role:"employee" as const};
describe("AbsenceService",()=>{
  it("creates idempotently and cancels an own pending request",async()=>{
    const service=new AbsenceService(new InMemoryAbsenceRepository());const key="00000000-0000-4000-8000-000000000001";
    const first=await service.create(actor,key,{type:"vacation",startsOn:"2026-08-03",endsOn:"2026-08-07"});
    expect(await service.create(actor,key,{type:"vacation",startsOn:"2026-08-03",endsOn:"2026-08-07"})).toEqual(first);
    expect((await service.cancel(actor,first.id,"00000000-0000-4000-8000-000000000002",1)).status).toBe("cancelled");
  });
  it("rejects reversed dates and auditor writes",async()=>{
    const service=new AbsenceService(new InMemoryAbsenceRepository());
    expect(()=>service.create(actor,"00000000-0000-4000-8000-000000000003",{type:"vacation",startsOn:"2026-08-07",endsOn:"2026-08-03"})).toThrow(expect.objectContaining({code:"VALIDATION_ERROR"}));
    expect(()=>service.create({...actor,role:"auditor"},"00000000-0000-4000-8000-000000000004",{type:"other",startsOn:"2026-08-03",endsOn:"2026-08-03"})).toThrow(expect.objectContaining({code:"FORBIDDEN"}));
  });
  it("rejects an overlapping open absence with a field-specific message",async()=>{
    const service=new AbsenceService(new InMemoryAbsenceRepository());
    await service.create(actor,"00000000-0000-4000-8000-000000000005",{type:"vacation",startsOn:"2027-04-10",endsOn:"2027-04-14"});
    await expect(service.create(actor,"00000000-0000-4000-8000-000000000006",{type:"other",startsOn:"2027-04-14",endsOn:"2027-04-15"})).rejects.toMatchObject({
      code:"VALIDATION_ERROR",
      field:"startsOn",
      message:"Für diesen Zeitraum besteht bereits eine offene oder genehmigte Abwesenheit.",
    });
  });
});
