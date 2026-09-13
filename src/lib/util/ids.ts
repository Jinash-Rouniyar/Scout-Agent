import { randomUUID, createHash } from "node:crypto";

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function contentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export function stableKey(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 40);
}
