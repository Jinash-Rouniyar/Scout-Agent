import { Client } from "@notionhq/client";
import type { DiligenceRecordInput, NotionConnector } from "./types";
import { requireEnv } from "@/env";

/**
 * Notion write connector. Scope is limited to the single shared database
 * (NOTION_DATABASE_ID). Idempotency is enforced by the action_receipts table,
 * not by Notion (which has no idempotency-key API).
 */
export class LiveNotionConnector implements NotionConnector {
  readonly name = "notion" as const;

  private client() {
    return new Client({ auth: requireEnv("NOTION_API_KEY") });
  }

  /**
   * Ensure the shared database has the typed columns Scout writes to. New Notion
   * databases start with only a `Name` title column; we add the rest once so the
   * record has real, filterable structure instead of a single column.
   */
  private async ensureSchema(notion: Client, databaseId: string): Promise<void> {
    const db = (await notion.databases.retrieve({ database_id: databaseId })) as {
      properties: Record<string, unknown>;
    };
    const existing = new Set(Object.keys(db.properties ?? {}));
    const want: Record<string, unknown> = {};
    if (!existing.has("Opportunity")) want["Opportunity"] = { number: {} };
    if (!existing.has("Confidence")) want["Confidence"] = { number: {} };
    if (!existing.has("Label"))
      want["Label"] = {
        select: {
          options: [
            { name: "High conviction", color: "green" },
            { name: "Promising", color: "blue" },
            { name: "Watch", color: "yellow" },
            { name: "Low current conviction", color: "red" },
          ],
        },
      };
    if (!existing.has("Status"))
      want["Status"] = {
        select: {
          options: [
            { name: "Diligence complete", color: "green" },
            { name: "Monitoring", color: "blue" },
          ],
        },
      };
    if (!existing.has("Domain")) want["Domain"] = { url: {} };
    if (!existing.has("GitHub")) want["GitHub"] = { url: {} };
    if (!existing.has("Thesis")) want["Thesis"] = { rich_text: {} };
    if (!existing.has("Report")) want["Report"] = { url: {} };
    if (Object.keys(want).length > 0) {
      await notion.databases.update({ database_id: databaseId, properties: want as never });
    }
  }

  async createDiligenceRecord(input: DiligenceRecordInput): Promise<{ pageId: string; url: string }> {
    const notion = this.client();
    const databaseId = requireEnv("NOTION_DATABASE_ID");
    await this.ensureSchema(notion, databaseId).catch(() => {
      // If the integration lacks "edit schema" rights we still create the page
      // with whatever properties exist rather than failing the whole diligence.
    });

    const labelName =
      input.label && ["High conviction", "Promising", "Watch", "Low current conviction"].includes(input.label)
        ? input.label
        : "Watch";

    const properties: Record<string, unknown> = {
      Name: { title: [{ text: { content: input.title } }] },
      Opportunity: { number: input.opportunityScore },
      Confidence: { number: input.confidenceScore },
      Label: { select: { name: labelName } },
      Status: { select: { name: "Diligence complete" } },
    };
    if (input.domain) properties["Domain"] = { url: normalizeUrl(input.domain) };
    if (input.githubUrl) properties["GitHub"] = { url: input.githubUrl };
    if (input.thesis) properties["Thesis"] = { rich_text: [{ text: { content: input.thesis.slice(0, 1900) } }] };
    if (input.docUrl) properties["Report"] = { url: input.docUrl };

    const children = buildBody(input);
    try {
      const page = (await notion.pages.create({
        parent: { database_id: databaseId },
        properties: properties as never,
        children,
      })) as { id: string; url?: string };
      return { pageId: page.id, url: page.url ?? `https://notion.so/${page.id.replace(/-/g, "")}` };
    } catch {
      // Database is missing typed columns and we couldn't add them — still write
      // a structured page body so the record is more than a title.
      const page = (await notion.pages.create({
        parent: { database_id: databaseId },
        properties: { Name: { title: [{ text: { content: input.title } }] } } as never,
        children,
      })) as { id: string; url?: string };
      return { pageId: page.id, url: page.url ?? `https://notion.so/${page.id.replace(/-/g, "")}` };
    }
  }

  async createFounderPage(input: {
    title: string;
    summary: string;
    opportunityScore: number;
    confidenceScore: number;
    label: string;
  }): Promise<{ pageId: string; url: string }> {
    return this.createDiligenceRecord({
      title: input.title,
      summary: input.summary,
      whyNow: "",
      opportunityScore: input.opportunityScore,
      confidenceScore: input.confidenceScore,
      label: input.label,
      claims: { fact: [], interpretation: [], risk: [], open_question: [] },
    });
  }

  async appendTimeline(pageId: string, item: { date: string; text: string }): Promise<{ ok: true }> {
    const notion = this.client();
    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [{ type: "text", text: { content: `${item.date} — ${item.text}` } }],
          },
        },
      ],
    });
    return { ok: true };
  }
}

function normalizeUrl(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function heading(content: string) {
  return {
    object: "block" as const,
    type: "heading_3" as const,
    heading_3: { rich_text: [{ type: "text" as const, text: { content } }] },
  };
}

function paragraph(content: string) {
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: { rich_text: [{ type: "text" as const, text: { content: content.slice(0, 1900) } }] },
  };
}

function bullet(content: string) {
  return {
    object: "block" as const,
    type: "bulleted_list_item" as const,
    bulleted_list_item: { rich_text: [{ type: "text" as const, text: { content: content.slice(0, 1900) } }] },
  };
}

/** Build a structured page body: callout + sectioned claims + timeline anchor. */
function buildBody(input: DiligenceRecordInput) {
  const blocks: object[] = [
    {
      object: "block",
      type: "callout",
      callout: {
        icon: { type: "emoji", emoji: "\u{1F3AF}" },
        rich_text: [
          {
            type: "text",
            text: {
              content: `${input.label} — Opportunity ${input.opportunityScore}/100 · Confidence ${input.confidenceScore}/100`,
            },
          },
        ],
      },
    },
  ];
  if (input.whyNow) {
    blocks.push(heading("Why now"), paragraph(input.whyNow));
  }
  if (input.summary) {
    blocks.push(heading("Summary"), paragraph(input.summary));
  }
  const sections: Array<[string, string[]]> = [
    ["Facts", input.claims.fact],
    ["Interpretations", input.claims.interpretation],
    ["Risks", input.claims.risk],
    ["Open questions", input.claims.open_question],
  ];
  for (const [title, items] of sections) {
    if (!items.length) continue;
    blocks.push(heading(title));
    for (const it of items.slice(0, 25)) blocks.push(bullet(it));
  }
  if (input.docUrl) {
    blocks.push(heading("Full report"), paragraph(input.docUrl));
  }
  blocks.push(heading("Signal timeline"));
  return blocks as never;
}
