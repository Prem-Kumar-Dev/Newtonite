import { Link } from "react-router-dom";
import { useMarkRead, useNotifications } from "../api/hooks";
import { timeAgo } from "../format";
import ErrorMessage from "../components/ErrorMessage";

export default function NotificationsPage() {
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const list = notifications.data ?? [];
  return (
    <div>
      <h1>Notifications</h1>
      <ErrorMessage error={notifications.error} onRetry={() => notifications.refetch()} />
      {!notifications.isPending && !list.length && <p className="muted">No notifications yet.</p>}
      <ul className="notifications">
        {list.map((n) => (
          <li key={n.id} className={n.read_at ? "read" : "unread"}>
            <Link to={`/items/${n.item_id}`} onClick={() => !n.read_at && markRead.mutate(n.id)}>
              {n.message}
            </Link>
            <span className="muted small">{timeAgo(n.created_at)}</span>
            {!n.read_at && (
              <button className="link small" onClick={() => markRead.mutate(n.id)}>
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
