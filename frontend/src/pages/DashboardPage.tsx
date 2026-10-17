import { Link } from "react-router-dom";
import { useDashboard, useItems } from "../api/hooks";
import type { View } from "../api/types";
import ErrorMessage from "../components/ErrorMessage";
import ItemTable from "../components/ItemTable";

const PANELS: { view: View; title: string; hint: string }[] = [
  { view: "assigned_to_me", title: "Assigned to me", hint: "Open work you own" },
  { view: "unassigned_urgent", title: "Unassigned urgent", hint: "P1 and P2 items nobody has claimed" },
  { view: "awaiting_my_approval", title: "Awaiting my approval", hint: "Submitted work you can approve as a Lead" },
];

export default function DashboardPage() {
  const counts = useDashboard();
  return (
    <div>
      <h1>Dashboard</h1>
      <ErrorMessage error={counts.error} onRetry={() => counts.refetch()} />
      <div className="tiles">
        {PANELS.map((p) => (
          <Link key={p.view} to={`/items?view=${p.view}`} className="tile">
            <span className="tile-count">{counts.data ? counts.data[p.view] : "–"}</span>
            <span className="tile-title">{p.title}</span>
            <span className="muted small">{p.hint}</span>
          </Link>
        ))}
      </div>
      {PANELS.map((p) => (
        <Panel key={p.view} view={p.view} title={p.title} />
      ))}
    </div>
  );
}

function Panel({ view, title }: { view: View; title: string }) {
  // Urgent work first; the rest by most recently touched.
  const items = useItems({ view, sort: view === "unassigned_urgent" ? "priority" : "-updated_at" }, 5);
  const rows = items.data?.pages[0]?.items ?? [];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <Link to={`/items?view=${view}`}>See all</Link>
      </div>
      {items.isPending ? (
        <p className="muted">Loading…</p>
      ) : items.error ? (
        <ErrorMessage error={items.error} onRetry={() => items.refetch()} />
      ) : (
        <ItemTable items={rows} compact />
      )}
    </section>
  );
}
