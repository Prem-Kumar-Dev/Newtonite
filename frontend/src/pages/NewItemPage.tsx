import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateItem } from "../api/hooks";
import { ITEM_TYPES, PRIORITIES, type ItemType, type Priority } from "../api/types";
import { useAuth } from "../auth";
import { fromLocalInput, typeLabel } from "../format";
import ErrorMessage from "../components/ErrorMessage";

const ALWAYS_APPROVAL: ItemType[] = ["payment", "compliance"];

export default function NewItemPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const create = useCreateItem();
  const teams = me?.is_admin
    ? me.memberships.map((m) => m.team)
    : (me?.memberships.filter((m) => m.role !== "VIEWER").map((m) => m.team) ?? []);

  const [teamId, setTeamId] = useState<number | "">(teams[0]?.id ?? "");
  const [type, setType] = useState<ItemType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("P3");
  const [due, setDue] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);

  if (me && !teams.length) {
    return <p className="muted">You're a viewer in all your teams, so you can't create items.</p>;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (teamId === "" || create.isPending) return;
    create.run(
      {
        data: {
          team_id: teamId,
          type,
          title,
          description,
          priority,
          due_at: fromLocalInput(due),
          requires_approval: requiresApproval,
        },
      },
      { onSuccess: (item) => navigate(`/items/${item.id}`, { replace: true }) },
    );
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h1>New item</h1>
      <div className="row">
        <label>
          Team
          <select value={teamId} onChange={(e) => setTeamId(Number(e.target.value))} required>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Due
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={200} required />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
      </label>
      <label className="inline">
        <input
          type="checkbox"
          checked={requiresApproval || ALWAYS_APPROVAL.includes(type)}
          disabled={ALWAYS_APPROVAL.includes(type)}
          onChange={(e) => setRequiresApproval(e.target.checked)}
        />
        Needs a Lead's approval before it's resolved
        {ALWAYS_APPROVAL.includes(type) && <span className="muted small"> (always, for {typeLabel[type]})</span>}
      </label>
      <ErrorMessage error={create.error} onRetry={create.retry} />
      <button type="submit" className="primary" disabled={create.isPending}>
        {create.isPending ? "Creating…" : "Create item"}
      </button>
    </form>
  );
}
