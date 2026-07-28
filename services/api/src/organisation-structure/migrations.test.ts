import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
const canonical=new URL("../../../../database/migrations/20260728190000_organisation_structure.sql",import.meta.url);
const applied=new URL("../../../../supabase/migrations/20260728190000_organisation_structure.sql",import.meta.url);
describe("organisation structure migration",()=>{
  it("keeps canonical and Supabase copies identical",async()=>expect(await readFile(applied,"utf8")).toBe(await readFile(canonical,"utf8")));
  it("contains tenant, RLS, idempotency, history and audit safeguards",async()=>{const sql=await readFile(canonical,"utf8");for(const token of ["organization_id","enable row level security","team_members_one_primary_effective","valid_from","organisation_structure_idempotency","audit_events","structure_forbidden"])expect(sql).toContain(token);});
});
