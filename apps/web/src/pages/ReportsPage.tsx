import type { MonthlyAttendanceReport } from "@teamzeit/contracts";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fetchMonthlyReport, reportCsv } from "../reporting/api";

const currentMonth = () => new Date().toISOString().slice(0, 7);
const hours = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

export function ReportsPage() {
  const { session, activeMembership } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState<MonthlyAttendanceReport>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const context = useMemo(() => session && activeMembership ? {
    accessToken: session.access_token, organizationId: activeMembership.organization.id,
  } : null, [session, activeMembership]);

  useEffect(() => {
    if (!context) return;
    let active = true;
    void fetchMonthlyReport(context, month)
      .then((value) => { if (active) setReport(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Der Bericht konnte nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [context, month]);

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `teamzeit-${report.month}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="attendance-page" aria-labelledby="reports-title">
      <div className="page-heading">
        <p className="eyebrow">Auswertung</p>
        <h1 id="reports-title">Monatsbericht</h1>
        <p className="page-intro">Arbeitszeiten im erlaubten Verantwortungsbereich prüfen und exportieren.</p>
      </div>
      {error && <p className="error-note" role="alert">{error}</p>}
      <section className="panel">
        <div className="panel-header">
          <label>Monat <input type="month" value={month} onChange={(event) => {
            setLoading(true); setError(undefined); setMonth(event.target.value);
          }} /></label>
          <button className="secondary-button compact-button" disabled={!report || loading} onClick={download}>CSV exportieren</button>
        </div>
        {loading ? <p className="hint-text">Bericht wird geladen…</p> : report && report.rows.length > 0 ? (
          <>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead><tr><th>Mitarbeitende</th><th>Arbeitszeit</th><th>Intervalle</th><th>Arbeitstage</th><th>Offen</th></tr></thead>
                <tbody>{report.rows.map((row) => <tr key={row.membershipId}><td>{row.email}</td><td>{hours(row.workedMinutes)}</td><td>{row.sessionCount}</td><td>{row.daysWorked}</td><td>{row.openSessionCount}</td></tr>)}</tbody>
                <tfoot><tr><th>Gesamt</th><th>{hours(report.totals.workedMinutes)}</th><th>{report.totals.sessionCount}</th><th>{report.totals.daysWorked}</th><th>{report.totals.openSessionCount}</th></tr></tfoot>
              </table>
            </div>
            {report.totals.openSessionCount > 0 && <p className="issue-banner">Der Bericht enthält offene Arbeitsintervalle.</p>}
          </>
        ) : <div className="empty-state compact-empty"><p>Für diesen Monat liegen keine Arbeitszeiten vor.</p></div>}
      </section>
    </section>
  );
}
