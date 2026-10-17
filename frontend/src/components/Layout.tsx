import { NavLink, Outlet } from "react-router-dom";
import { useNotifications } from "../api/hooks";
import { useAuth } from "../auth";

export default function Layout() {
  const { me, logout } = useAuth();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Ops Queue</span>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/items" end>
            Items
          </NavLink>
          <NavLink to="/items/new">New item</NavLink>
          <NavLink to="/notifications">
            Notifications{unread > 0 && <span className="count">{unread}</span>}
          </NavLink>
        </nav>
        <div className="who">
          {me && (
            <span title={me.memberships.map((m) => `${m.team.name}: ${m.role}`).join("\n")}>
              {me.name}
              {me.is_admin && <span className="badge">admin</span>}
            </span>
          )}
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
