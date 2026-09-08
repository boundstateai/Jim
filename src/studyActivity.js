export const IDLE_MS = 120000;
export function pauseReason({ now, lastActivity, visible, focused, online }) {
  if (!online) return "Connection lost. Reconnect, then resume.";
  if (!visible || !focused) return "Paused while you were away from the app.";
  if (now - lastActivity >= IDLE_MS) return "Paused after two minutes without activity. Ready to continue?";
  return "";
}
export function duration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
