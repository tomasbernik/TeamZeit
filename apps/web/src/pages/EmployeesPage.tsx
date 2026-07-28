import type { EmployeeAdministrationSummary, EmployeeWorkRuleDto, MembershipRole, WeekdayMinutes } from "@teamzeit/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  createEmployee,
  deactivateEmployee,
  getEmployeeWorkRule,
  listEmployees,
  sendEmployeeInvitation,
  setEmployeeWorkRule,
  updateEmployee,
} from "../employees/api";

const defaultMinutes: WeekdayMinutes = {
  monday: 480,
  tuesday: 480,
  wednesday: 480,
  thursday: 480,
  friday: 480,
  saturday: 0,
  sunday: 0,
};
const weekdays: Array<[keyof WeekdayMinutes, string]> = [
  ["monday", "Mo"],
  ["tuesday", "Di"],
  ["wednesday", "Mi"],
  ["thursday", "Do"],
  ["friday", "Fr"],
  ["saturday", "Sa"],
  ["sunday", "So"],
];
const today = () => new Date().toISOString().slice(0, 10);
const statusLabels = { invited: "Eingeladen", active: "Aktiv", inactive: "Inaktiv" } as const;

export function EmployeesPage() {
  const { session, activeMembership } = useAuth();
  const [items, setItems] = useState<EmployeeAdministrationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [workRule, setWorkRule] = useState<EmployeeWorkRuleDto>();
  const [ruleLoadedFor, setRuleLoadedFor] = useState<string>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [pending, setPending] = useState(false);
  const context = useMemo(
    () => session && activeMembership
      ? { accessToken: session.access_token, organizationId: activeMembership.organization.id }
      : null,
    [session, activeMembership],
  );
  const selected = items.find((item) => item.id === selectedId);
  const selectedWorkRule = workRule?.membershipId === selectedId ? workRule : undefined;
  const ruleLoading = Boolean(selectedId && ruleLoadedFor !== selectedId);
  const isOwner = activeMembership?.role === "owner";
  const canEditSelected = selected?.status !== "inactive" && (isOwner || selected?.role !== "owner");
  const canEditWorkRule = selected?.status === "active" && canEditSelected;

  const load = useCallback(async () => {
    if (!context) return;
    try {
      const result = await listEmployees(context);
      setItems(result);
      setSelectedId((current) => result.some((item) => item.id === current) ? current : result[0]?.id);
    } catch (cause) {
      setError(message(cause, "Mitarbeitende konnten nicht geladen werden."));
    }
  }, [context]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!context || !selectedId) {
      return;
    }
    let active = true;
    void getEmployeeWorkRule(context, selectedId, today())
      .then(({ rule }) => { if (active) setWorkRule(rule); })
      .catch((cause) => { if (active) setError(message(cause, "Die Arbeitszeit konnte nicht geladen werden.")); })
      .finally(() => { if (active) setRuleLoadedFor(selectedId); });
    return () => { active = false; };
  }, [context, selectedId]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      await action();
      setSuccess(successMessage);
      await load();
    } catch (cause) {
      setError(message(cause, "Die Änderung konnte nicht gespeichert werden."));
    } finally {
      setPending(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const row = await createEmployee(context, {
        email: String(data.get("email")),
        role: String(data.get("role")) as Exclude<MembershipRole, "owner">,
      });
      setSelectedId(row.id);
      form.reset();
    }, "Mitarbeiter wurde angelegt.");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !selected || !canEditSelected) return;
    const data = new FormData(event.currentTarget);
    const weekdayMinutes = Object.fromEntries(
      weekdays.map(([key]) => [key, Math.round(Number(data.get(key)) * 60)]),
    ) as unknown as WeekdayMinutes;
    setPending(true);
    setError(undefined);
    setSuccess(undefined);
    let assignmentSaved = false;
    try {
      const updated = await updateEmployee(context, selected.id, {
        role: String(data.get("role")) as MembershipRole,
        expectedVersion: selected.version,
      });
      assignmentSaved = true;
      if (selected.status !== "active") {
        setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
        setSuccess("Die Rolle wurde gespeichert.");
        await load();
        return;
      }
      const rule = await setEmployeeWorkRule(context, selected.id, {
        effectiveFrom: String(data.get("effectiveFrom")),
        weekdayMinutes,
      });
      setWorkRule(rule);
      setRuleLoadedFor(selected.id);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setSuccess("Mitarbeiter und Arbeitszeit wurden gespeichert.");
      await load();
    } catch (cause) {
      setError(assignmentSaved
        ? `Rolle gespeichert, Arbeitszeit jedoch nicht: ${message(cause, "Unbekannter Fehler.")}`
        : message(cause, "Die Änderung konnte nicht gespeichert werden."));
      await load();
    } finally {
      setPending(false);
    }
  }

  function deactivate() {
    if (!context || !selected || selected.status !== "active" || selected.id === activeMembership?.id) return;
    if (!window.confirm(`Mitgliedschaft von ${selected.email} wirklich deaktivieren?`)) return;
    void run(
      () => deactivateEmployee(context, selected.id, selected.version),
      "Die Mitgliedschaft wurde deaktiviert.",
    );
  }

  const minutes = selectedWorkRule?.weekdayMinutes ?? defaultMinutes;

  return (
    <section className="attendance-page" aria-labelledby="employees-title">
      <div className="page-heading">
        <p className="eyebrow">Organisation</p>
        <h1 id="employees-title">Mitarbeitende</h1>
        <p className="page-intro">Profile, Zugänge und Arbeitszeiten gemeinsam verwalten.</p>
      </div>
      {error && <p className="error-note" role="alert">{error}</p>}
      {success && <p className="success-note" role="status">{success}</p>}
      <div className="employee-admin-grid">
        <section className="panel">
          <h2>Neuer Mitarbeiter</h2>
          <form className="employee-form" onSubmit={create}>
            <label>E-Mail<input name="email" type="email" required /></label>
            <label>Rolle
              <select name="role" defaultValue="employee">
                <option value="employee">Mitarbeiter</option>
                <option value="manager">Vorgesetzter</option>
                {isOwner && <option value="admin">Administrator</option>}
                <option value="auditor">Prüfer</option>
              </select>
            </label>
            <button className="primary-button" disabled={pending}>Mitarbeiter anlegen</button>
          </form>
          <div className="employee-list">
            {items.map((item) => (
              <button
                key={item.id}
                className={`employee-card${item.id === selectedId ? " selected" : ""}`}
                onClick={() => { setSelectedId(item.id); setError(undefined); setSuccess(undefined); }}
              >
                <strong>{item.email}</strong>
                <span>{item.role} · {statusLabels[item.status]}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          {selected ? (
            <>
              <div className="panel-header">
                <div><p className="eyebrow">Mitarbeiter</p><h2>{selected.email}</h2></div>
                <span className={`state-pill state-${selected.status === "active" ? "completed" : "idle"}`}>
                  {statusLabels[selected.status]}
                </span>
              </div>
              <form
                className="employee-form"
                onSubmit={(event) => { void save(event); }}
                key={`${selected.id}-${selectedWorkRule?.id ?? "default"}`}
              >
                <label>Rolle
                  <select name="role" defaultValue={selected.role} disabled={!canEditSelected}>
                    {isOwner && <option value="owner">Inhaber</option>}
                    {isOwner && <option value="admin">Administrator</option>}
                    <option value="employee">Mitarbeiter</option>
                    <option value="manager">Vorgesetzter</option>
                    <option value="auditor">Prüfer</option>
                  </select>
                </label>
                <label>Gültig ab<input name="effectiveFrom" type="date" defaultValue={today()} required disabled={!canEditSelected} /></label>
                <fieldset disabled={!canEditWorkRule || ruleLoading}>
                  <legend>Geplante Stunden pro Tag</legend>
                  <div className="weekday-grid">
                    {weekdays.map(([key, label]) => (
                      <label key={key}>{label}
                        <input name={key} type="number" min="0" max="24" step="0.25" defaultValue={minutes[key] / 60} required />
                      </label>
                    ))}
                  </div>
                </fieldset>
                {ruleLoading && <p className="hint-text">Arbeitszeit wird geladen…</p>}
                {!ruleLoading && selectedWorkRule && <p className="hint-text">Aktuelle Regel gültig seit {formatDate(selectedWorkRule.effectiveFrom)}.</p>}
                <p className="hint-text">Bei mehr als 6 Stunden werden mindestens 30 Minuten Pause berücksichtigt.</p>
                {canEditSelected && <button className="primary-button" disabled={pending || (canEditWorkRule && ruleLoading)}>
                  {canEditWorkRule ? "Änderungen speichern" : "Rolle speichern"}
                </button>}
              </form>
              {selected.status === "invited" && canEditSelected && (
                <button className="secondary-button" disabled={pending} onClick={() => context && void run(
                  () => sendEmployeeInvitation(context, selected.id),
                  "Einladung wurde für den Versand vorgemerkt.",
                )}>
                  {selected.invitationSentAt ? "Versand erneut vormerken" : "Versand vormerken"}
                </button>
              )}
              {selected.status === "active" && selected.id !== activeMembership?.id && canEditSelected && (
                <button className="danger-button" disabled={pending} onClick={deactivate}>Mitgliedschaft deaktivieren</button>
              )}
              {selected.status === "inactive" && <p className="hint-text">Inaktive Mitgliedschaften können nicht bearbeitet werden.</p>}
              {!canEditSelected && selected.role === "owner" && !isOwner && <p className="hint-text">Nur ein Inhaber darf diese Mitgliedschaft bearbeiten.</p>}
            </>
          ) : <div className="empty-state"><p>Wähle einen Mitarbeiter aus.</p></div>}
        </section>
      </div>
    </section>
  );
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE").format(new Date(`${value}T00:00:00`));
}
