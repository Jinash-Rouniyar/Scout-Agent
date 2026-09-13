export interface RecapCompany {
  name: string;
  opportunity: number | null;
  confidence: number | null;
  label: string | null;
  whyNow?: string | null;
  summary?: string | null;
  domain?: string | null;
  githubOrg?: string | null;
  docUrl?: string | null;
  logoCid?: string | null;
}

export interface RecapSignal {
  name: string;
  kind: string;
  materiality: number;
  assessment: string;
  citationUrl?: string | null;
  logoCid?: string | null;
}

export interface RecapEmailModel {
  asOf: Date;
  period: string;
  editorial: string;
  watching: RecapCompany[];
  material: RecapSignal[];
  quiet: RecapCompany[];
  trends: Array<{ name: string; count: number }>;
  heroCid?: string | null;
}

const KIND_LABEL: Record<string, string> = {
  funding: "Funding",
  company_launch: "Launch",
  new_repo: "New repository",
  release: "Release",
  star_growth: "Traction",
  contributors: "Contributors",
  rss_launch: "Coverage",
  web_launch: "Coverage",
  noise: "Note",
};

export function formatRecapDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replaceAll("_", " ");
}

export function firstSentence(text: string, max = 220): string {
  const t = text.trim();
  if (!t) return "";
  const m = t.match(/^(.{0,220}?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, max)).trim();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function fallbackEditorial(model: Omit<RecapEmailModel, "editorial">): string {
  const n = model.watching.length;
  const m = model.material.length;
  if (n === 0) {
    return "Scout is not watching any companies for the newsletter yet. Turn on newsletter when you create a diligence pack.";
  }
  if (m === 0) {
    return `Scout watched ${n} ${n === 1 ? "company" : "companies"} this week. No material signals crossed the line — monitoring continues, and quiet is a result, not a gap.`;
  }
  const names = [...new Set(model.material.map((s) => s.name))];
  const listed = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `Scout watched ${n} companies this week. ${m} material ${m === 1 ? "signal" : "signals"} landed — ${listed}${rest}. The notes below are what moved, not a restatement of last week's memo.`;
}

export { encodeRfc2047 } from "@/lib/util/mime";

export function buildRecapPlaintext(model: RecapEmailModel): string {
  const date = formatRecapDate(model.asOf);
  const lines = ["SCOUT NEWSLETTER", date, "", "THE BRIEF", model.editorial, ""];

  if (model.watching.length) {
    lines.push("ON THE WATCHLIST", "");
    for (const c of model.watching) {
      const scores =
        c.opportunity != null
          ? `Opportunity ${c.opportunity}  ·  Confidence ${c.confidence}${c.label ? `  ·  ${c.label}` : ""}`
          : c.label ?? "";
      lines.push(c.name);
      if (scores) lines.push(scores);
      const blurb = firstSentence(c.whyNow ?? c.summary ?? "");
      if (blurb) lines.push(blurb);
      if (c.docUrl) lines.push(c.docUrl);
      lines.push("");
    }
  }

  lines.push("WHAT MOVED", "");
  if (model.material.length === 0) {
    lines.push("No material signals this week. Monitoring continues.");
  } else {
    for (const s of model.material) {
      lines.push(`${s.name}  ·  ${kindLabel(s.kind)}`);
      lines.push(s.assessment);
      if (s.citationUrl) lines.push(s.citationUrl);
      lines.push("");
    }
  }

  if (model.quiet.length) {
    lines.push("QUIET THIS WEEK");
    lines.push(model.quiet.map((c) => c.name).join(", "));
    lines.push("");
  }

  if (model.trends.length) {
    lines.push("MINOR TRENDS (not milestones)");
    for (const t of model.trends) lines.push(`${t.name}: ${t.count} minor events`);
  }

  return lines.join("\n").trim() + "\n";
}

export function buildRecapHtml(model: RecapEmailModel): string {
  const date = formatRecapDate(model.asOf);
  const editorial = escapeHtml(model.editorial)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px 0;">${p.replaceAll("\n", "<br>")}</p>`)
    .join("");

  const watchRows = model.watching
    .map((c) => {
      const scores =
        c.opportunity != null
          ? `Opportunity ${c.opportunity}  ·  Confidence ${c.confidence}`
          : "";
      const blurb = firstSentence(c.whyNow ?? c.summary ?? "");
      return `
        <tr>
          <td style="padding:20px 0 20px 0;border-bottom:1px solid #E8E2D8;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48" valign="top" style="padding-right:12px;">${companyMark(c.name, c.logoCid)}</td>
                <td valign="top">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font:18px/1.3 Georgia,serif;color:#1A1814;">${escapeHtml(c.name)}</td>
                      <td align="right" style="font:11px/1.4 Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#6F6A62;">${escapeHtml(c.label ?? "")}</td>
                    </tr>
                  </table>
                  ${scores ? `<div style="margin-top:6px;font:13px/1.4 Arial,sans-serif;color:#6F6A62;">${escapeHtml(scores)}</div>` : ""}
                  ${blurb ? `<div style="margin-top:10px;font:15px/1.55 Georgia,serif;color:#2C2820;">${escapeHtml(blurb)}</div>` : ""}
                  ${
                    c.docUrl
                      ? `<div style="margin-top:12px;"><a href="${escapeHtml(c.docUrl)}" style="font:13px/1.4 Arial,sans-serif;color:#1A1814;text-decoration:underline;">Read the memo</a></div>`
                      : ""
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
    })
    .join("");

  const moved =
    model.material.length === 0
      ? `<tr><td style="padding:12px 0;font:15px/1.55 Georgia,serif;color:#2C2820;">No material signals this week. Monitoring continues.</td></tr>`
      : model.material
          .map(
            (s) => `
        <tr>
          <td style="padding:18px 0 18px 0;border-bottom:1px solid #E8E2D8;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48" valign="top" style="padding-right:12px;">${companyMark(s.name, s.logoCid)}</td>
                <td valign="top">
                  <div style="font:11px/1.4 Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#6F6A62;">${escapeHtml(s.name)}  ·  ${escapeHtml(kindLabel(s.kind))}</div>
                  <div style="margin-top:8px;font:16px/1.5 Georgia,serif;color:#1A1814;">${escapeHtml(s.assessment)}</div>
                  ${
                    s.citationUrl
                      ? `<div style="margin-top:10px;"><a href="${escapeHtml(s.citationUrl)}" style="font:13px/1.4 Arial,sans-serif;color:#1A1814;text-decoration:underline;">Read the source</a></div>`
                      : ""
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>`,
          )
          .join("");

  const quiet = model.quiet.length
    ? `<tr><td style="padding-top:36px;font:12px/1.4 Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8A8378;">Quiet this week</td></tr>
       <tr><td style="padding-top:10px;font:15px/1.55 Georgia,serif;color:#2C2820;">${escapeHtml(model.quiet.map((c) => c.name).join(" · "))}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>This Week at Scout</title>
</head>
<body style="margin:0;padding:0;background:#F7F4EF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;">
    <tr>
      <td align="center" style="padding:36px 16px 48px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;">
          <tr><td style="font:12px/1.4 Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#8A8378;">Scout newsletter</td></tr>
          <tr><td style="padding-top:8px;font:32px/1.2 Georgia,serif;color:#1A1814;">${escapeHtml(date)}</td></tr>
          ${
            model.heroCid
              ? `<tr><td style="padding-top:24px;">
                  <img src="cid:${escapeHtml(model.heroCid)}" width="560" alt="Scout weekly newsletter" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:12px;">
                </td></tr>`
              : ""
          }
          <tr><td style="padding-top:36px;font:12px/1.4 Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8A8378;">The brief</td></tr>
          <tr><td style="padding-top:12px;font:16px/1.65 Georgia,serif;color:#2C2820;">${editorial}</td></tr>
          ${
            model.watching.length
              ? `<tr><td style="padding-top:36px;font:12px/1.4 Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8A8378;">On the watchlist</td></tr>
                 <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${watchRows}</table></td></tr>`
              : ""
          }
          <tr><td style="padding-top:36px;font:12px/1.4 Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8A8378;">What moved</td></tr>
          <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${moved}</table></td></tr>
          ${quiet}
          <tr><td style="padding-top:40px;border-top:1px solid #E8E2D8;font:12px/1.5 Arial,sans-serif;color:#8A8378;">Scout newsletter · Material means an event score of 60 or above.</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function companyMark(name: string, cid?: string | null): string {
  if (cid) {
    return `<img src="cid:${escapeHtml(cid)}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:8px;border:1px solid #E8E2D8;">`;
  }
  const letter = escapeHtml((name.trim().charAt(0) || "S").toUpperCase());
  return `<div style="width:36px;height:36px;border-radius:8px;background:#EDE8DF;color:#1A1814;font:16px/36px Georgia,serif;text-align:center;">${letter}</div>`;
}
