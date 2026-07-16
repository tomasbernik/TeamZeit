import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "Heute", icon: "◷" },
  { to: "/attendance", label: "Zeiterfassung", icon: "◴" },
  { to: "/absences", label: "Abwesenheiten", icon: "◇" },
  { to: "/employees", label: "Mitarbeitende", icon: "◎" },
  { to: "/settings", label: "Einstellungen", icon: "⚙" },
] as const;

export function AppLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>TeamZeit</span>
        </a>
        <nav aria-label="Hauptnavigation">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">TZ</span>
          <div><strong>Lokale Vorschau</strong><small>Nicht angemeldet</small></div>
        </div>
      </aside>
      <div className="content-shell">
        <header className="mobile-header">
          <span className="brand"><span className="brand-mark">T</span><span>TeamZeit</span></span>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  );
}
