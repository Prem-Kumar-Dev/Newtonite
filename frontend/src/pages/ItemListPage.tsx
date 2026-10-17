import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useItems } from "../api/hooks";
import { ITEM_TYPES, PRIORITIES, STATUSES, type ItemFilters, type Priority, type Status, type View } from "../api/types";
import { useAuth } from "../auth";
import { statusLabel, typeLabel } from "../format";
import ErrorMessage from "../components/ErrorMessage";
import ItemTable from "../components/ItemTable";

const VIEW_TITLES: Record<View, string> = {
  assigned_to_me: "Assigned to me",
  unassigned_urgent: "Unassigned urgent",
  awaiting_my_approval: "Awaiting my approval",
};

/** Filters live in the URL, so a filtered list can be bookmarked, shared and survives a reload. */
function useFilters(): [ItemFilters, (patch: Partial<Record<keyof ItemFilters, string | string[] | null>>) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<ItemFilters>(() => {
    const f: ItemFilters = {
      view: (params.get("view") as View) || undefined,
      team_id: params.get("team_id") || undefined,
      status: params.getAll("status") as Status[],
      priority: params.getAll("priority") as Priority[],
      type: params.getAll("type") as ItemFilters["type"],
      assignee: params.get("assignee") || undefined,
      q: params.get("q") || undefined,
      sort: (params.get("sort") as ItemFilters["sort"]) || undefined,
    };
    return f;
  }, [params]);

  const update = (patch: Partial<Record<keyof ItemFilters, string | string[] | null>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      for (const v of Array.isArray(value) ? value : value ? [value] : []) next.append(key, v);
    }
    setParams(next, { replace: true });
  };
  return [filters, update];
}

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const l = list ?? [];
  return l.includes(value) ? l.filter((v) => v !== value) : [...l, value];
}

export default function ItemListPage() {
  const { me } = useAuth();
  const [filters, setFilters] = useFilters();

  // Debounce search so typing doesn't fire a request per keystroke.
  const [search, setSearch] = useState(filters.q ?? "");
  useEffect(() => setSearch(filters.q ?? ""), [filters.q]);
  useEffect(() => {
    if (search === (filters.q ?? "")) return;
    const t = setTimeout(() => setFilters({ q: search.trim() || null }), 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useItems(filters);
  const rows = items.data?.pages.flatMap((p) => p.items) ?? [];
  const teams = me?.memberships.map((m) => m.team) ?? [];

  return (
    <div>
      <h1>{filters.view ? VIEW_TITLES[filters.view] : "Items"}</h1>
      {filters.view && (
        <p className="muted">
          Showing the “{VIEW_TITLES[filters.view]}” view.{" "}
          <button className="link" onClick={() => setFilters({ view: null })}>
            Show all items
          </button>
        </p>
      )}

      <div className="filters">
        <input
          type="search"
          placeholder="Search title and description, or #id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search"
        />
        <select value={filters.team_id ?? ""} onChange={(e) => setFilters({ team_id: e.target.value })} aria-label="Team">
          <option value="">All my teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          value={filters.type?.[0] ?? ""}
          onChange={(e) => setFilters({ type: e.target.value })}
          aria-label="Type"
        >
          <option value="">Any type</option>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeLabel[t]}
            </option>
          ))}
        </select>
        <select
          value={filters.assignee ?? ""}
          onChange={(e) => setFilters({ assignee: e.target.value })}
          aria-label="Assignee"
        >
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="none">Unassigned</option>
        </select>
        <select
          value={filters.sort ?? "-updated_at"}
          onChange={(e) => setFilters({ sort: e.target.value === "-updated_at" ? null : e.target.value })}
          aria-label="Sort"
        >
          <option value="-updated_at">Recently updated</option>
          <option value="priority">Priority</option>
        </select>
      </div>
      <div className="filters chips">
        {STATUSES.map((s) => (
          <label key={s} className={`chip ${filters.status?.includes(s) ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={filters.status?.includes(s) ?? false}
              onChange={() => setFilters({ status: toggle(filters.status, s) })}
            />
            {statusLabel[s]}
          </label>
        ))}
        <span className="sep" />
        {PRIORITIES.map((p) => (
          <label key={p} className={`chip ${filters.priority?.includes(p) ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={filters.priority?.includes(p) ?? false}
              onChange={() => setFilters({ priority: toggle(filters.priority, p) })}
            />
            {p}
          </label>
        ))}
      </div>

      <ErrorMessage error={items.error} onRetry={() => items.refetch()} />
      {items.isPending ? <p className="muted">Loading…</p> : <ItemTable items={rows} />}
      {items.hasNextPage && (
        <button className="load-more" onClick={() => items.fetchNextPage()} disabled={items.isFetchingNextPage}>
          {items.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
