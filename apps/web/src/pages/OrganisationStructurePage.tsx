import type { OrganisationStructureDto } from "@teamzeit/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { archiveLocation, archiveTeam, createLocation, createTeam, getStructure, setAssignment, setManagerScope } from "../organisation-structure/api";

export function OrganisationStructurePage() {
  const {session,activeMembership}=useAuth();
  const [data,setData]=useState<OrganisationStructureDto>({locations:[],teams:[],assignments:[],managerScopes:[]});
  const [notice,setNotice]=useState<string>();
  const context=useMemo(()=>session&&activeMembership?{accessToken:session.access_token,organizationId:activeMembership.organization.id}:null,[session,activeMembership]);
  const load=useCallback(async()=>{if(context)setData(await getStructure(context));},[context]);
  useEffect(()=>{const timer=window.setTimeout(()=>{void load().catch(e=>setNotice(e instanceof Error?e.message:"Fehler"));},0);return()=>window.clearTimeout(timer);},[load]);
  async function run(action:()=>Promise<unknown>){try{await action();setNotice("Änderung gespeichert.");await load();}catch(e){setNotice(e instanceof Error?e.message:"Änderung fehlgeschlagen.");}}
  function values(e:FormEvent<HTMLFormElement>){e.preventDefault();return new FormData(e.currentTarget);}
  return <section className="attendance-page" aria-labelledby="structure-title">
    <div className="page-heading"><p className="eyebrow">Organisation</p><h1 id="structure-title">Organisationsstruktur</h1><p className="page-intro">Standorte, Teams, zeitliche Zuordnungen und Verantwortungsbereiche verwalten.</p></div>
    {notice&&<p role="status" className="success-note">{notice}</p>}
    <div className="employee-admin-grid">
      <section className="panel"><h2>Standorte</h2><form className="employee-form" onSubmit={e=>{const d=values(e);if(context)void run(()=>createLocation(context,{name:String(d.get("name"))}));}}><label>Name<input name="name" required maxLength={120}/></label><button className="primary-button">Standort anlegen</button></form>{data.locations.map(x=><div className="employee-card" key={x.id}><strong>{x.name}</strong><span>{x.archivedAt?"Archiviert":"Aktiv"}</span><button className="secondary-button" onClick={()=>context&&void run(()=>archiveLocation(context,x.id,{archived:!x.archivedAt}))}>{x.archivedAt?"Reaktivieren":"Archivieren"}</button></div>)}</section>
      <section className="panel"><h2>Teams</h2><form className="employee-form" onSubmit={e=>{const d=values(e);if(context)void run(()=>createTeam(context,{name:String(d.get("name")),locationId:String(d.get("locationId"))}));}}><label>Name<input name="name" required/></label><label>Standort<select name="locationId" required>{data.locations.filter(x=>!x.archivedAt).map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><button className="primary-button">Team anlegen</button></form>{data.teams.map(x=><div className="employee-card" key={x.id}><strong>{x.name}</strong><span>{x.archivedAt?"Archiviert":"Aktiv"}</span><button className="secondary-button" onClick={()=>context&&void run(()=>archiveTeam(context,x.id,{archived:!x.archivedAt}))}>{x.archivedAt?"Reaktivieren":"Archivieren"}</button></div>)}</section>
      <section className="panel"><h2>Teamzuordnung</h2><form className="employee-form" onSubmit={e=>{const d=values(e);if(context)void run(()=>setAssignment(context,{membershipId:String(d.get("membershipId")),teamId:String(d.get("teamId")),validFrom:String(d.get("validFrom")),primary:true}));}}><label>Mitgliedschaft-ID<input name="membershipId" required/></label><label>Hauptteam<select name="teamId">{data.teams.filter(x=>!x.archivedAt).map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Gültig ab<input name="validFrom" type="date" required/></label><button className="primary-button">Zuordnung speichern</button></form></section>
      <section className="panel"><h2>Manager-Bereich</h2><form className="employee-form" onSubmit={e=>{const d=values(e);if(context)void run(()=>setManagerScope(context,{managerMembershipId:String(d.get("managerMembershipId")),scopeType:"team",teamId:String(d.get("teamId")),validFrom:String(d.get("validFrom"))}));}}><label>Manager-Mitgliedschaft-ID<input name="managerMembershipId" required/></label><label>Team<select name="teamId">{data.teams.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><label>Gültig ab<input name="validFrom" type="date" required/></label><button className="primary-button">Bereich zuweisen</button></form></section>
    </div>
  </section>;
}
