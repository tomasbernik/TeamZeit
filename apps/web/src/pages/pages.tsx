interface PlaceholderPageProps {
  eyebrow: string;
  title: string;
  description: string;
}

function PlaceholderPage({ eyebrow, title, description }: PlaceholderPageProps) {
  return (
    <section className="page-card" aria-labelledby="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1 id="page-title">{title}</h1>
      <p className="page-intro">{description}</p>
      <div className="empty-state">
        <span aria-hidden="true">○</span>
        <p>Dieser Bereich wird in einem eigenen Modul umgesetzt.</p>
      </div>
    </section>
  );
}

export function TodayPage() {
  return <PlaceholderPage eyebrow="Übersicht" title="Heute" description="Dein Arbeitstag auf einen Blick." />;
}

export function AttendancePage() {
  return <PlaceholderPage eyebrow="Arbeitszeit" title="Zeiterfassung" description="Monatsübersicht, Zeitkonto und Korrekturen." />;
}

export function AbsencesPage() {
  return <PlaceholderPage eyebrow="Abwesenheit" title="Abwesenheiten" description="Urlaub und Abwesenheiten übersichtlich verwalten." />;
}

export function EmployeesPage() {
  return <PlaceholderPage eyebrow="Organisation" title="Mitarbeitende" description="Teams und Berechtigungen an einem Ort." />;
}

export function SettingsPage() {
  return <PlaceholderPage eyebrow="Konfiguration" title="Einstellungen" description="Organisation und persönliche Einstellungen verwalten." />;
}
