import { describe, expect, it } from "vitest";
import { InMemoryOrganisationStructureRepository } from "./memory-repository.js";
import { OrganisationStructureError, OrganisationStructureService } from "./service.js";
const admin={organizationId:"20000000-0000-4000-8000-000000000001",membershipId:"30000000-0000-4000-8000-000000000004",userId:"10000000-0000-4000-8000-000000000004",role:"admin" as const};
const employee={...admin,role:"employee" as const};
describe("OrganisationStructureService",()=>{
  it("denies employee mutations",()=>{const service=new OrganisationStructureService(new InMemoryOrganisationStructureRepository());expect(()=>service.createLocation(employee,crypto.randomUUID(),{name:"Berlin"})).toThrow(OrganisationStructureError);});
  it("returns the same logical result for a repeated command",async()=>{const service=new OrganisationStructureService(new InMemoryOrganisationStructureRepository());const key=crypto.randomUUID();const a=await service.createLocation(admin,key,{name:"Berlin"});const b=await service.createLocation(admin,key,{name:"Anders"});expect(b).toEqual(a);});
  it("limits manager reads to assigned teams at the requested date",async()=>{const repo=new InMemoryOrganisationStructureRepository();const service=new OrganisationStructureService(repo);const location=await service.createLocation(admin,crypto.randomUUID(),{name:"Berlin"}) as unknown as {id:string};const team=await service.createTeam(admin,crypto.randomUUID(),{name:"Nord",locationId:location.id}) as unknown as {id:string};await service.setScope(admin,crypto.randomUUID(),{managerMembershipId:"30000000-0000-4000-8000-000000000005",scopeType:"team",teamId:team.id,validFrom:"2026-01-01"});const result=await service.read({...admin,membershipId:"30000000-0000-4000-8000-000000000005",role:"manager"},"2026-07-01");expect(result.teams).toHaveLength(1);});
});
