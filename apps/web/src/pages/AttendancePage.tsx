import type {
  AttendanceState,
  CreateCorrectionRequest,
  DailyAttendanceOverview,
  MonthlyAttendanceOverview,
  WorkSessionDto,
} from "@teamzeit/contracts";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import {
  createCorrectionRequest,
  fetchDailyAttendance,
  fetchMonthlyAttendance,
  fetchTodayAttendance,
  sendClockCommand,
  type ClockCommand,
} from "../time-tracking/api";

const stateLabels: Record<AttendanceState, string> = {
  not_started: "Nicht gestartet",
  working: "Arbeitszeit läuft",
  on_break: "Pause läuft",
  completed: "Abgeschlossen",
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth(): string {
  return todayIsoDate().slice(0, 7);
}

function formatTime(value?: string): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function formatMinutes(minutes: number | undefined): string {
  const total = minutes ?? 0;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${hours} h ${rest.toString().padStart(2, "0")} min`;
}

function localDateTimeValue(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoInstant(value: string): string {
  return new Date(value).toISOString();
}

function breakMinutes(session: WorkSessionDto | undefined): number {
  return session?.breaks.reduce((total, item) => total + (item.durationMinutes ?? 0), 0) ?? 0;
}

function firstSession(overview: DailyAttendanceOverview | null, activeSession: WorkSessionDto | undefined): WorkSessionDto | undefined {
  return activeSession ?? overview?.sessions[0];
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function messageFromError(error: unknown, fallback: string): string {
  if (isNetworkError(error)) return "Die Verbindung zum Server wurde unterbrochen. Bitte versuche es erneut.";
  return error instanceof Error ? error.message : fallback;
}

function operationKey(): string {
  return crypto.randomUUID();
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="empty-state compact-empty">
      <span aria-hidden="true">○</span>
      <p>{children}</p>
    </div>
  );
}

export function AttendancePage() {
  const { activeMembership, session } = useAuth();
  const [today, setToday] = useState<{ serverTime: string; state: AttendanceState; activeSession?: WorkSessionDto } | null>(null);
  const [daily, setDaily] = useState<DailyAttendanceOverview | null>(null);
  const [monthly, setMonthly] = useState<MonthlyAttendanceOverview | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayIsoDate);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(true);
  const [commandPending, setCommandPending] = useState<string | null>(null);
  const [correctionPending, setCorrectionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const latestLoadRef = useRef(0);
  const pendingCommandRef = useRef<ClockCommand | null>(null);
  const commandKeysRef = useRef<Partial<Record<ClockCommand, string>>>({});
  const pendingCorrectionRef = useRef(false);
  const correctionOperationRef = useRef<{ signature: string; key: string } | null>(null);

  const requestContext = useMemo(() => {
    if (!session || !activeMembership) return null;
    return { accessToken: session.access_token, organizationId: activeMembership.organization.id };
  }, [activeMembership, session]);
  const loadKey = requestContext ? `${requestContext.accessToken}:${requestContext.organizationId}:${selectedDate}:${selectedMonth}` : null;

  const loadAttendance = useCallback(async () => {
    if (!requestContext || !loadKey) return;

    const loadId = latestLoadRef.current + 1;
    latestLoadRef.current = loadId;
    setLoading(true);
    setError(null);
    try {
      const [todayResult, dailyResult, monthlyResult] = await Promise.all([
        fetchTodayAttendance(requestContext),
        fetchDailyAttendance(requestContext, selectedDate),
        fetchMonthlyAttendance(requestContext, selectedMonth),
      ]);
      if (latestLoadRef.current !== loadId) return;
      setToday(todayResult);
      setDaily(dailyResult);
      setMonthly(monthlyResult);
      setDataKey(loadKey);
    } catch (loadError) {
      if (latestLoadRef.current !== loadId) return;
      setError(messageFromError(loadError, "Die Zeiterfassung konnte nicht geladen werden."));
    } finally {
      if (latestLoadRef.current === loadId) setLoading(false);
    }
  }, [loadKey, requestContext, selectedDate, selectedMonth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAttendance();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadAttendance]);

  const visibleToday = dataKey === loadKey ? today : null;
  const visibleDaily = dataKey === loadKey ? daily : null;
  const visibleMonthly = dataKey === loadKey ? monthly : null;
  const isLoading = loading || dataKey !== loadKey;
  const state = visibleToday?.state ?? "not_started";
  const selectedSession = firstSession(visibleDaily, visibleToday?.activeSession);
  const canWrite = activeMembership?.role !== "auditor";
  const commands = [
    { key: "clock-in", label: "Príchod", enabled: state === "not_started" },
    { key: "break-start", label: "Začať prestávku", enabled: state === "working" },
    { key: "break-end", label: "Ukončiť prestávku", enabled: state === "on_break" },
    { key: "clock-out", label: "Odchod", enabled: state === "working" },
  ] as const;

  async function runCommand(command: ClockCommand) {
    if (!requestContext || pendingCommandRef.current) return;

    pendingCommandRef.current = command;
    setCommandPending(command);
    setError(null);
    setSuccess(null);
    const key = commandKeysRef.current[command] ?? operationKey();
    commandKeysRef.current[command] = key;
    try {
      await sendClockCommand(requestContext, command, key);
      delete commandKeysRef.current[command];
      setSuccess("Arbeitszeit wurde aktualisiert.");
      await loadAttendance();
    } catch (commandError) {
      if (!isNetworkError(commandError)) delete commandKeysRef.current[command];
      setError(messageFromError(commandError, "Die Aktion konnte nicht ausgeführt werden."));
    } finally {
      pendingCommandRef.current = null;
      setCommandPending(null);
    }
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestContext || !selectedSession || pendingCorrectionRef.current) return;

    pendingCorrectionRef.current = true;
    const data = new FormData(event.currentTarget);
    const startedAt = String(data.get("startedAt") ?? "");
    const endedAt = String(data.get("endedAt") ?? "");
    const reason = String(data.get("reason") ?? "").trim();
    const breakMinutesValue = Number(data.get("breakMinutes") ?? 0);

    const request: CreateCorrectionRequest = {
      sessionId: selectedSession.id,
      expectedVersion: selectedSession.version,
      proposed: {
        workDate: selectedSession.workDate,
        startedAt: toIsoInstant(startedAt),
        endedAt: toIsoInstant(endedAt),
        breakMinutes: breakMinutesValue,
      },
      reason,
    };
    const signature = JSON.stringify(request);
    const existingOperation = correctionOperationRef.current?.signature === signature ? correctionOperationRef.current : null;
    const operation = existingOperation ?? { signature, key: operationKey() };
    correctionOperationRef.current = operation;

    setCorrectionPending(true);
    setError(null);
    setSuccess(null);
    try {
      await createCorrectionRequest(requestContext, request, operation.key);
      correctionOperationRef.current = null;
      setSuccess("Korrekturanfrage wurde gesendet.");
      event.currentTarget.reset();
    } catch (correctionError) {
      if (!isNetworkError(correctionError)) correctionOperationRef.current = null;
      setError(messageFromError(correctionError, "Die Korrekturanfrage konnte nicht gesendet werden."));
    } finally {
      pendingCorrectionRef.current = false;
      setCorrectionPending(false);
    }
  }

  return (
    <section className="attendance-page" aria-labelledby="attendance-title">
      <div className="page-heading">
        <p className="eyebrow">Arbeitszeit</p>
        <h1 id="attendance-title">Dochádzka</h1>
        <p className="page-intro">Erfasse deinen Arbeitstag und prüfe Tages- und Monatswerte.</p>
      </div>

      {error && <p className="error-note" role="alert">{error}</p>}
      {success && <p className="success-note">{success}</p>}

      <div className="attendance-grid">
        <section className="panel workday-panel" aria-busy={isLoading}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">Heute</p>
              <h2>Aktueller Status</h2>
            </div>
            <span className={`state-pill state-${state}`}>{stateLabels[state]}</span>
          </div>

          {isLoading ? (
            <EmptyState>Arbeitsstand wird geladen.</EmptyState>
          ) : (
            <>
              <dl className="metric-grid">
                <div>
                  <dt>Beginn</dt>
                  <dd>{formatTime(visibleToday?.activeSession?.startedAt)}</dd>
                </div>
                <div>
                  <dt>Ende</dt>
                  <dd>{formatTime(visibleToday?.activeSession?.endedAt)}</dd>
                </div>
                <div>
                  <dt>Arbeitszeit</dt>
                  <dd>{formatMinutes(visibleToday?.activeSession?.workedMinutes)}</dd>
                </div>
                <div>
                  <dt>Pausen</dt>
                  <dd>{formatMinutes(breakMinutes(visibleToday?.activeSession))}</dd>
                </div>
              </dl>

              <div className="command-grid">
                {commands.map((command) => (
                  <button
                    key={command.key}
                    className="primary-button command-button"
                    type="button"
                    disabled={!canWrite || !command.enabled || Boolean(commandPending)}
                    onClick={() => void runCommand(command.key)}
                  >
                    {commandPending === command.key ? "Wird gesendet." : command.label}
                  </button>
                ))}
              </div>
              {!canWrite && <p className="hint-text">Auditoren können Arbeitszeiten nur lesen.</p>}
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Tag</p>
              <h2>Tagesüberblick</h2>
            </div>
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          {isLoading ? (
            <EmptyState>Tageswerte werden geladen.</EmptyState>
          ) : visibleDaily && visibleDaily.sessions.length > 0 ? (
            <div className="overview-list">
              <div className="summary-row">
                <strong>{formatDate(visibleDaily.workDate)}</strong>
                <span>{formatMinutes(visibleDaily.workedMinutes)} Arbeitszeit</span>
                <span>{formatMinutes(visibleDaily.breakMinutes)} Pause</span>
              </div>
              {visibleDaily.sessions.map((item) => (
                <article className="session-row" key={item.id}>
                  <span>{formatTime(item.startedAt)} - {formatTime(item.endedAt)}</span>
                  <strong>{stateLabels[item.state]}</strong>
                  <small>Version {item.version}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>Für diesen Tag gibt es noch keine Einträge.</EmptyState>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Monat</p>
              <h2>Monatsüberblick</h2>
            </div>
            <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
          </div>
          {isLoading ? (
            <EmptyState>Monatswerte werden geladen.</EmptyState>
          ) : visibleMonthly && visibleMonthly.days.length > 0 ? (
            <div className="overview-list">
              <div className="summary-row">
                <strong>{visibleMonthly.month}</strong>
                <span>{formatMinutes(visibleMonthly.workedMinutes)} Arbeitszeit</span>
                <span>{formatMinutes(visibleMonthly.breakMinutes)} Pause</span>
              </div>
              {visibleMonthly.days.map((day) => (
                <article className="session-row" key={day.workDate}>
                  <span>{formatDate(day.workDate)}</span>
                  <strong>{formatMinutes(day.workedMinutes)}</strong>
                  <small>{stateLabels[day.state]}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>Für diesen Monat gibt es noch keine freigegebenen Tageswerte.</EmptyState>
          )}
        </section>

        <section className="panel correction-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Korrektur</p>
              <h2>Änderung beantragen</h2>
            </div>
          </div>
          {selectedSession ? (
            <form className="correction-form" onSubmit={(event) => void submitCorrection(event)}>
              <label>
                Arbeitsbeginn
                <input name="startedAt" type="datetime-local" defaultValue={localDateTimeValue(selectedSession.startedAt)} required />
              </label>
              <label>
                Arbeitsende
                <input name="endedAt" type="datetime-local" defaultValue={localDateTimeValue(selectedSession.endedAt)} required />
              </label>
              <label>
                Pausenminuten
                <input name="breakMinutes" type="number" min="0" max="1440" defaultValue={breakMinutes(selectedSession)} required />
              </label>
              <label>
                Begründung
                <textarea name="reason" minLength={3} maxLength={1000} required />
              </label>
              <button className="secondary-button compact-button" type="submit" disabled={!canWrite || correctionPending}>
                {correctionPending ? "Wird gesendet." : "Korrektur senden"}
              </button>
            </form>
          ) : (
            <EmptyState>Wähle einen Tag mit Arbeitszeit, um eine Korrektur anzufragen.</EmptyState>
          )}
        </section>
      </div>
    </section>
  );
}
