import type { MembershipRole } from "@teamzeit/contracts";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";

const navigation = [
  { to: "/", label: "Heute", icon: "O", roles: ["owner", "admin", "manager", "employee"] },
  { to: "/attendance", label: "Zeiterfassung", icon: "Z", roles: ["owner", "admin", "manager", "employee", "auditor"] },
  { to: "/absences", label: "Abwesenheiten", icon: "A", roles: ["owner", "admin", "manager", "employee"] },
  { to: "/employees", label: "Mitarbeitende", icon: "M", roles: ["owner", "admin", "manager", "auditor"] },
  { to: "/settings", label: "Einstellungen", icon: "S", roles: ["owner", "admin"] },
] as const satisfies ReadonlyArray<{
  to: string;
  label: string;
  icon: string;
  roles: readonly MembershipRole[];
}>;

const roleLabels: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
  auditor: "Auditor",
};

export function AppLayout() {
  const { activeMembership, activeMemberships, context, selectOrganization, signOut } = useAuth();
  const visibleNavigation = navigation.filter((item) => activeMembership && (item.roles as readonly MembershipRole[]).includes(activeMembership.role));
  const initials = context?.user.displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "TZ";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>TeamZeit</span>
        </a>
        <div className="organization-switcher">
          <label htmlFor="organization">Organisation</label>
          <select
            id="organization"
            value={activeMembership?.organization.id ?? ""}
            onChange={(event) => selectOrganization(event.target.value)}
            disabled={activeMemberships.length < 2}
          >
            {activeMemberships.map((membership) => (
              <option key={membership.organization.id} value={membership.organization.id}>
                {membership.organization.name}
              </option>
            ))}
          </select>
          {activeMembership && <small>{roleLabels[activeMembership.role]}</small>}
        </div>
        <nav aria-label="Hauptnavigation">
          {visibleNavigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar" aria-hidden="true">{initials}</span>
          <div>
            <strong>{context?.user.displayName ?? "TeamZeit"}</strong>
            <small>{context?.user.email}</small>
          </div>
          <button className="icon-button" type="button" onClick={() => void signOut()} aria-label="Abmelden">
            X
          </button>
        </div>
      </aside>
      <div className="content-shell">
        <header className="mobile-header">
          <span className="brand"><span className="brand-mark">T</span><span>TeamZeit</span></span>
          {activeMembership && <span className="mobile-org">{activeMembership.organization.name}</span>}
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  );
}
