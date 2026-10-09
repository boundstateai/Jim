export const SESSION_EXPIRED_EVENT = "calculus-session-expired";

export async function readLoginStatus(fetchImpl = fetch) {
  const response = await fetchImpl("/api/login", {credentials: "same-origin", cache: "no-store"});
  if (!response.ok) throw new Error("Could not verify your sign-in. Please sign in again.");
  const state = await response.json();
  if (typeof state.authenticated !== "boolean" || typeof state.configured !== "boolean") {
    throw new Error("Could not verify your sign-in. Please try again.");
  }
  return state;
}

export async function loginWithSession(username, password, fetchImpl = fetch) {
  const response = await fetchImpl("/api/login", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: {"Content-Type": "application/json"}, body: JSON.stringify({username,password}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.authenticated) throw new Error(data.error || "Sign in failed. Please try again.");
  // A successful password check is insufficient if the browser did not retain the cookie.
  const verified = await readLoginStatus(fetchImpl);
  if (!verified.authenticated) throw new Error("Your browser did not keep the sign-in cookie. Allow cookies for this site and try again.");
  return verified;
}

export async function sessionFetch(url, options = {}, fetchImpl = fetch, onExpired = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}) {
  const response = await fetchImpl(url, {...options, credentials: "same-origin"});
  if (response.status === 401) onExpired();
  return response;
}
