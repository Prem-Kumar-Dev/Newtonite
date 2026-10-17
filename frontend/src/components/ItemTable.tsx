import { Link } from "react-router-dom";
import type { ItemSummary } from "../api/types";
import { typeLabel, timeAgo } from "../format";
import { PriorityBadge, StatusBadge } from "./Badges";

export default function ItemTable({ items, compact = false }: { items: ItemSummary[]; compact?: boolean }) {
  if (!items.length) return <p className="muted">Nothing here.</p>;
  return (
    <table className="items">
      <thead>
        <tr>
          <th>#</th>
          <th>Title</th>
          <th>Priority</th>
          <th>Status</th>
          {!compact && <th>Type</th>}
          <th>Team</th>
          <th>Assignee</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td className="muted">{item.id}</td>
            <td>
              <Link to={`/items/${item.id}`}>{item.title}</Link>
              {item.requires_approval && <span className="tag">approval</span>}
            </td>
            <td>
              <PriorityBadge priority={item.priority} />
            </td>
            <td>
              <StatusBadge status={item.status} />
            </td>
            {!compact && <td>{typeLabel[item.type]}</td>}
            <td>{item.team.name}</td>
            <td>{item.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
            <td className="muted" title={item.updated_at}>
              {timeAgo(item.updated_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
