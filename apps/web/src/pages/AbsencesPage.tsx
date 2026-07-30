import type { AbsenceRequestDto, AbsenceStatus, AbsenceType } from "@teamzeit/contracts";
import { useCallback,useEffect,useMemo,useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { cancelAbsence,createAbsence,fetchAbsences,reviewAbsence } from "../absence/api";
const labels:Record<AbsenceType,string>={vacation:"Urlaub",sickness:"Krankheit",other:"Sonstige"};
const statusLabels:Record<AbsenceStatus,string>={pending:"Ausstehend",approved:"Genehmigt",rejected:"Abgelehnt",cancelled:"Storniert"};
export function AbsencesPage(){
 const {session,activeMembership}=useAuth(),[items,setItems]=useState<AbsenceRequestDto[]>([]),[error,setError]=useState<string>(),[busy,setBusy]=useState(false);
 const [type,setType]=useState<AbsenceType>("vacation"),[startsOn,setStart]=useState(""),[endsOn,setEnd]=useState("");
 const c=useMemo(()=>session&&activeMembership?{accessToken:session.access_token,organizationId:activeMembership.organization.id}:null,[session,activeMembership]);
 const load=useCallback(()=>c&&fetchAbsences(c).then(x=>setItems(x.items)).catch(e=>setError(e instanceof Error?e.message:String(e))),[c]);
 useEffect(()=>{void load()},[load]);
 const run=async(f:()=>Promise<unknown>)=>{setBusy(true);setError(undefined);try{await f();await load()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
 const reviewer=activeMembership&&["owner","admin","manager"].includes(activeMembership.role);
 return <section className="attendance-page"><div className="page-heading"><p className="eyebrow">Abwesenheit</p><h1>Abwesenheitsanträge</h1><p className="page-intro">Urlaub und andere Abwesenheiten beantragen und prüfen.</p></div>
 {error&&<p className="error-note" role="alert">{error}</p>}
 {activeMembership?.role!=="auditor"&&<form className="panel form-grid" onSubmit={e=>{e.preventDefault();if(c)void run(()=>createAbsence(c,{type,startsOn,endsOn}))}}><label>Art<select value={type} onChange={e=>setType(e.target.value as AbsenceType)}>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>Von<input required type="date" value={startsOn} onChange={e=>setStart(e.target.value)}/></label><label>Bis<input required type="date" value={endsOn} onChange={e=>setEnd(e.target.value)}/></label><button className="primary-button" disabled={busy}>Antrag senden</button></form>}
 <section className="panel"><div className="overview-list">{items.map(x=><article className="session-row" key={x.id}><span>{labels[x.type]} · {x.startsOn} – {x.endsOn}</span><strong>{statusLabels[x.status]}</strong><span>{x.membershipId===activeMembership?.id&&x.status==="pending"&&<button className="secondary-button compact-button" disabled={busy} onClick={()=>c&&void run(()=>cancelAbsence(c,x))}>Stornieren</button>} {reviewer&&x.membershipId!==activeMembership?.id&&x.status==="pending"&&<><button className="primary-button compact-button" disabled={busy} onClick={()=>c&&void run(()=>reviewAbsence(c,x,{decision:"approved",expectedVersion:x.version}))}>Genehmigen</button> <button className="secondary-button compact-button" disabled={busy} onClick={()=>c&&void run(()=>reviewAbsence(c,x,{decision:"rejected",expectedVersion:x.version}))}>Ablehnen</button></>}</span></article>)}</div>{items.length===0&&<p className="hint-text">Keine Abwesenheitsanträge vorhanden.</p>}</section></section>
}
