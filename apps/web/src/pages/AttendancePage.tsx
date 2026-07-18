import type { DailyAttendanceOverview, MonthlyAttendanceOverview, TodayAttendanceResponse, WorkSessionDto } from "@teamzeit/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { createWorkSession, deleteWorkSession, fetchDailyAttendance, fetchMonthlyAttendance, fetchTodayAttendance, sendClockCommand, updateWorkSession, type ClockCommand } from "../time-tracking/api";

const dateToday = () => new Date().toISOString().slice(0, 10);
const monthToday = () => dateToday().slice(0, 7);
const key = () => crypto.randomUUID();
const time = (value?: string) => value ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "–";
const dateTimeInput = (value?: string) => { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const duration = (minutes = 0) => `${Math.floor(minutes / 60)} h ${(minutes % 60).toString().padStart(2, "0")} min`;
const message = (error: unknown, fallback: string) => error instanceof TypeError ? "Die Verbindung zum Server wurde unterbrochen. Bitte versuche es erneut." : error instanceof Error ? error.message : fallback;

export function AttendancePage({ todayOnly = false }: { todayOnly?: boolean } = {}) {
  const { activeMembership, session } = useAuth();
  const [today, setToday] = useState<TodayAttendanceResponse | null>(null);
  const [daily, setDaily] = useState<DailyAttendanceOverview | null>(null);
  const [monthly, setMonthly] = useState<MonthlyAttendanceOverview | null>(null);
  const [selectedDate, setSelectedDate] = useState(dateToday);
  const [selectedMonth, setSelectedMonth] = useState(monthToday);
  const [editing, setEditing] = useState<WorkSessionDto | "new" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const commandKey = useRef<string | null>(null);
  const context = useMemo(() => session && activeMembership ? { accessToken: session.access_token, organizationId: activeMembership.organization.id } : null, [session, activeMembership]);
  const canWrite = activeMembership?.role !== "auditor";

  const load = useCallback(async () => {
    if (!context) return;
    try {
      const current = await fetchTodayAttendance(context); setToday(current);
      if (!todayOnly) {
        const [day, month] = await Promise.all([fetchDailyAttendance(context, selectedDate), fetchMonthlyAttendance(context, selectedMonth)]);
        setDaily(day); setMonthly(month);
      }
    } catch (cause) { setError(message(cause, "Die Zeiterfassung konnte nicht geladen werden.")); }
  }, [context, selectedDate, selectedMonth, todayOnly]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function clock(command: ClockCommand) {
    if (!context || pending) return;
    setPending(true); setError(null); setSuccess(null); commandKey.current ??= key();
    try { await sendClockCommand(context, command, commandKey.current); commandKey.current = null; setSuccess(command === "clock-in" ? "Eingestempelt." : "Ausgestempelt."); await load(); }
    catch (cause) { if (!(cause instanceof TypeError)) commandKey.current = null; setError(message(cause, "Die Aktion konnte nicht ausgeführt werden.")); }
    finally { setPending(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!context || !editing || pending) return;
    const data = new FormData(event.currentTarget); const startedAt = new Date(String(data.get("startedAt"))).toISOString(); const endedAt = new Date(String(data.get("endedAt"))).toISOString();
    const workDate = String(data.get("workDate")); setPending(true); setError(null); setSuccess(null);
    try {
      if (editing === "new") await createWorkSession(context, { workDate, startedAt, endedAt }, key());
      else await updateWorkSession(context, editing.id, { workDate, startedAt, endedAt, expectedVersion: editing.version }, key());
      setEditing(null); setSuccess("Arbeitszeit wurde sofort gespeichert."); await load();
    } catch (cause) { setError(message(cause, "Der Arbeitszeitraum konnte nicht gespeichert werden.")); }
    finally { setPending(false); }
  }

  async function remove(item: WorkSessionDto) {
    if (!context || pending || !window.confirm("Arbeitszeitraum wirklich löschen?")) return;
    setPending(true); setError(null);
    try { await deleteWorkSession(context, item, key()); setSuccess("Arbeitszeitraum wurde gelöscht."); if (editing !== "new" && editing?.id === item.id) setEditing(null); await load(); }
    catch (cause) { setError(message(cause, "Der Arbeitszeitraum konnte nicht gelöscht werden.")); }
    finally { setPending(false); }
  }

  const overview = todayOnly ? today : daily;
  return <section className={`attendance-page${todayOnly ? " today-page" : ""}`} aria-labelledby="attendance-title">
    <div className="page-heading"><p className="eyebrow">{todayOnly ? "Übersicht" : "Arbeitszeit"}</p><h1 id="attendance-title">{todayOnly ? "Heute" : "Zeiterfassung"}</h1><p className="page-intro">Arbeitsintervalle direkt erfassen und korrigieren.</p></div>
    {error && <p className="error-note" role="alert">{error}</p>}{success && <p className="success-note">{success}</p>}
    <div className="attendance-grid">
      <section className="panel workday-panel"><div className="panel-header"><div><p className="eyebrow">Heute</p><h2>Aktueller Status</h2></div><span className={`state-pill state-${today?.state ?? "not_started"}`}>{today?.state === "working" ? "Eingestempelt" : "Ausgestempelt"}</span></div>
        <div className="command-grid"><button className="primary-button command-button" disabled={!canWrite || pending} onClick={() => void clock(today?.state === "working" ? "clock-out" : "clock-in")}>{pending ? "Wird gesendet…" : today?.state === "working" ? "Ausstempeln" : "Einstempeln"}</button></div>
      </section>
      <section className="panel"><div className="panel-header"><div><p className="eyebrow">Intervalle</p><h2>{todayOnly ? "Heute" : "Tagesübersicht"}</h2></div>{!todayOnly && <input aria-label="Arbeitstag" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />}</div>
        <div className="summary-row"><span>{duration(overview?.workedMinutes)} Arbeitszeit</span><span>{duration(overview?.breakMinutes)} Pause</span></div>
        <div className="overview-list">{(overview?.sessions ?? []).map((item) => <article className="session-row" key={item.id}><span>{time(item.startedAt)} – {time(item.endedAt)}</span><strong>{duration(item.workedMinutes)}</strong>{canWrite && item.endedAt && <span><button className="secondary-button compact-button" onClick={() => setEditing(item)}>Bearbeiten</button> <button className="secondary-button compact-button" onClick={() => void remove(item)}>Löschen</button></span>}</article>)}</div>
        {canWrite && <button className="secondary-button compact-button" onClick={() => setEditing("new")}>Intervall hinzufügen</button>}
      </section>
      {editing && <section className="panel"><h2>{editing === "new" ? "Intervall hinzufügen" : "Intervall bearbeiten"}</h2><form className="correction-form" onSubmit={(event) => void save(event)}>
        <label>Arbeitstag<input name="workDate" type="date" defaultValue={editing === "new" ? (todayOnly ? today?.workDate : selectedDate) : editing.workDate} required /></label>
        <label>Beginn<input name="startedAt" type="datetime-local" defaultValue={editing === "new" ? "" : dateTimeInput(editing.startedAt)} required /></label>
        <label>Ende<input name="endedAt" type="datetime-local" defaultValue={editing === "new" ? "" : dateTimeInput(editing.endedAt)} required /></label>
        <button className="primary-button" disabled={pending}>Sofort speichern</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Abbrechen</button>
      </form></section>}
      {!todayOnly && <section className="panel"><div className="panel-header"><h2>Monatsübersicht</h2><input aria-label="Monat" type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></div><div className="summary-row"><span>{duration(monthly?.workedMinutes)} Arbeitszeit</span><span>{duration(monthly?.breakMinutes)} Pause</span></div></section>}
    </div>
  </section>;
}
