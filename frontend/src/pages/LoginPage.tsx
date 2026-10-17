import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { errorText } from "../components/ErrorMessage";

const DEMO_USERS = ["alice", "bob", "carol", "priya", "dana", "victor", "admin"];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      const from = (location.state as { from?: { pathname: string; search: string } } | null)?.from;
      navigate(from ? from.pathname + from.search : "/", { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card">
        <h1>Ops Queue</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="muted small">
          Demo accounts (password <code>password</code>):{" "}
          {DEMO_USERS.map((u, i) => (
            <span key={u}>
              {i > 0 && ", "}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEmail(`${u}@example.com`);
                  setPassword("password");
                }}
              >
                {u}
              </button>
            </span>
          ))}
        </p>
      </form>
    </div>
  );
}
