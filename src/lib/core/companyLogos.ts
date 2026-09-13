import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EmailInlineImage } from "@/lib/connectors/types";

export type { EmailInlineImage };

export const NEWSLETTER_HERO_CID = "scout-hero";

export async function loadNewsletterHero(): Promise<EmailInlineImage | null> {
  try {
    const data = await readFile(path.join(process.cwd(), "scout_hero_logo.png"));
    if (data.length < 80) return null;
    return {
      cid: NEWSLETTER_HERO_CID,
      filename: "scout_hero_logo.png",
      mimeType: "image/png",
      data,
    };
  } catch {
    return null;
  }
}

export function logoCidFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
  return `logo-${slug || "co"}`;
}

function candidates(company: { domain?: string | null; githubOrg?: string | null }): string[] {
  const urls: string[] = [];
  const org = company.githubOrg?.replace(/^@/, "").trim();
  const domain = company.domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (org) urls.push(`https://github.com/${encodeURIComponent(org)}.png?size=128`);
  if (domain) {
    urls.push(`https://logo.clearbit.com/${encodeURIComponent(domain)}`);
    urls.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
  }
  return urls;
}

function sniffMime(url: string, header: string | null, bytes: Buffer): string | null {
  const fromHeader = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (fromHeader.startsWith("image/")) return fromHeader;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii") === "GIF87a") return "image/gif";
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (url.includes("favicons") || url.endsWith(".png")) return "image/png";
  return null;
}

async function downloadImage(url: string): Promise<{ mimeType: string; data: Buffer } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length < 80 || data.length > 800_000) return null;
    const mimeType = sniffMime(url, res.headers.get("content-type"), data);
    if (!mimeType) return null;
    return { mimeType, data };
  } catch {
    return null;
  }
}

export async function fetchCompanyLogos(
  companies: Array<{ name: string; domain?: string | null; githubOrg?: string | null }>,
): Promise<EmailInlineImage[]> {
  const out: EmailInlineImage[] = [];
  const seen = new Set<string>();
  for (const company of companies) {
    const cid = logoCidFor(company.name);
    if (seen.has(cid)) continue;
    seen.add(cid);
    for (const url of candidates(company)) {
      const image = await downloadImage(url);
      if (!image) continue;
      const ext = image.mimeType === "image/jpeg" ? "jpg" : image.mimeType === "image/gif" ? "gif" : "png";
      out.push({ cid, filename: `${cid}.${ext}`, mimeType: image.mimeType, data: image.data });
      break;
    }
  }
  return out;
}
