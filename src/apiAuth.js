const TOKEN_HEADER = "x-leo-api-token";

export function apiHeaders(base = {}) {
  const token = import.meta.env.VITE_LEO_API_TOKEN || "";
  return token ? { ...base, [TOKEN_HEADER]: token } : base;
}
