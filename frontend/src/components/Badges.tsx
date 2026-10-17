import type { Priority, Status } from "../api/types";
import { statusLabel } from "../format";

export const StatusBadge = ({ status }: { status: Status }) => (
  <span className={`badge status-${status.toLowerCase()}`}>{statusLabel[status]}</span>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <span className={`badge prio-${priority.toLowerCase()}`} title={priority === "P1" ? "Urgent" : undefined}>
    {priority}
  </span>
);
