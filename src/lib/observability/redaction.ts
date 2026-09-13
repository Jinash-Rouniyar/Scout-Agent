/**
 * Redaction utilities. Only SAFE metadata is ever sent to Langfuse: ids,
 * categories, counts, scores, latencies, and outcomes. Credentials and raw
 * private/source content must never leave the server.
 */
const SECRET_KEYS = [
  "api_key",
  "apikey",
  "authorization",
  "token",
  "secret",
  "password",
  "refresh_token",
  "client_secret",
  "cron_secret",
];

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (value == null) return value;
  if (typeof value === "string") {
    // Truncate long raw text so we never ship full source bodies.
    return value.length > 240 ? `${value.slice(0, 240)}…[${value.length}b]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return "[unserializable]";
}
