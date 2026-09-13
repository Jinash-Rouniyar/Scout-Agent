import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FetchConnector, FetchedPage } from "@/lib/connectors/types";
import { contentHash } from "@/lib/util/ids";

const MAX_BYTES = 2_000_000; // 2 MB cap
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** True for loopback / private / link-local / reserved ranges. */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.replace("::ffff:", ""));
  return false;
}

async function assertPublicHttps(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("blocked:invalid-url");
  }
  if (url.protocol !== "https:") throw new Error("blocked:non-https");
  const host = url.hostname;
  if (host === "localhost") throw new Error("blocked:localhost");

  // If host is a literal IP, check directly; else resolve and check every A/AAAA.
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("blocked:private-ip");
    return url;
  }
  const records = await lookup(host, { all: true }).catch(() => []);
  if (records.length === 0) throw new Error("blocked:dns");
  for (const rec of records) {
    if (isPrivateIp(rec.address)) throw new Error("blocked:private-ip");
  }
  return url;
}

function stripHtml(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1].trim()) : null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
  return { title, text: decode(text).replace(/\s+/g, " ").trim().slice(0, 20_000) };
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * SSRF-hardened page fetch. Enforces: HTTPS only, private/loopback IP blocking
 * (including after each redirect), size + time limits, and HTML->text
 * sanitization. Retrieved content is DATA ONLY and must never be interpreted as
 * instructions by the agent (prompt-injection defense lives in agent prompting).
 */
export class LiveFetchConnector implements FetchConnector {
  readonly name = "fetch" as const;

  async fetchPage(rawUrl: string): Promise<FetchedPage> {
    let current = rawUrl;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const url = await assertPublicHttps(current);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "ScoutBot/0.1" } });
        } finally {
          clearTimeout(timer);
        }

        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) break;
          current = new URL(loc, url).toString(); // re-validated at top of loop (redirect-to-private blocked)
          continue;
        }

        const reader = res.body?.getReader();
        let received = 0;
        const chunks: Uint8Array[] = [];
        if (reader) {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_BYTES) {
              reader.cancel();
              break;
            }
            chunks.push(value);
          }
        }
        const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
        const { title, text } = stripHtml(body);
        return {
          url: rawUrl,
          finalUrl: url.toString(),
          status: res.status,
          title,
          text,
          contentHash: contentHash(text),
        };
      }
      return { url: rawUrl, finalUrl: current, status: 0, title: null, text: "", contentHash: contentHash(""), blocked: "too-many-redirects" };
    } catch (e) {
      const reason = e instanceof Error && e.message.startsWith("blocked:") ? e.message : "fetch-error";
      return { url: rawUrl, finalUrl: current, status: 0, title: null, text: "", contentHash: contentHash(reason), blocked: reason };
    }
  }
}
