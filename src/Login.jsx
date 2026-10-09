import React, { useEffect, useState } from "react";
import { readLoginStatus, loginWithSession, SESSION_EXPIRED_EVENT } from "./sessionClient.js";

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
    const expired = () => { setError("Your session ended. Please sign in again."); setStatus("out"); };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    readLoginStatus().then(data => {
      if (!cancelled) setStatus(data.authenticated ? "in" : "out");
    }).catch(error => {
      if (!cancelled) { setError(error.message); setStatus("out"); }
    });
    return () => { cancelled = true; window.removeEventListener(SESSION_EXPIRED_EVENT, expired); };
  }, []);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await loginWithSession(username, password);
      setPassword(""); setStatus("in");
    } catch (error) { setError(error.message || "Could not reach the server."); }
    finally { setBusy(false); }
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
