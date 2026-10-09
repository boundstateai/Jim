import React, { useEffect, useState } from "react";
import { apiHeaders } from "./apiAuth";

// Wraps the app in a sign-in gate. The server is the real gate; this just
// gives the learner somewhere to sign in and keeps the UI from firing doomed requests.
export function LoginGate({ children }) {
  const [status, setStatus] = useState("checking");
  const [username, setUsername] = useState("micah");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/login", { headers: apiHeaders() })
      .then(r => (r.ok ? r.json() : { authenticated: true, configured: false }))
      .then(data => {
        if (cancelled) return;
        // If login was never configured the app stays open, as it was before.
        setStatus(data.authenticated || !data.configured ? "in" : "out");
      })
      .catch(() => { if (!cancelled) setStatus("in"); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: apiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.authenticated) {
        setPassword("");
        setStatus("in");
      } else {
        setError(data.error || "Sign in failed. Please try again.");
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") {
    return <div className="login-screen"><p className="login-checking">Loading…</p></div>;
  }

  if (status === "in") return children;

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>Micah’s Calculus Lab</h1>
        <p className="login-sub">Sign in to pick up where you left off.</p>

        <label htmlFor="login-user">Username</label>
        <input
          id="login-user"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
        />

        <label htmlFor="login-pass">Password</label>
        <input
          id="login-pass"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {error ? <p className="login-error" role="alert">{error}</p> : null}

        <button type="submit" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
