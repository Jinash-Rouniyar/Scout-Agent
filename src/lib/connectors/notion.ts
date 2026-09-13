import { Client } from "@notionhq/client";
import type { NotionConnector } from "./types";
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

  async createFounderPage(input: {
    title: string;
    summary: string;
    opportunityScore: number;
    confidenceScore: number;
    label: string;
    properties?: Record<string, string>;
  }): Promise<{ pageId: string; url: string }> {
    const notion = this.client();
    const databaseId = requireEnv("NOTION_DATABASE_ID");
    const page = (await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        Name: { title: [{ text: { content: input.title } }] },
      },
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: [{ type: "text", text: { content: "Scout diligence" } }] },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                text: {
                  content: `Opportunity ${input.opportunityScore} / Confidence ${input.confidenceScore} — ${input.label}`,
                },
              },
            ],
          },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: input.summary.slice(0, 1900) } }] },
        },
        {
          object: "block",
          type: "heading_3",
          heading_3: { rich_text: [{ type: "text", text: { content: "Signal timeline" } }] },
        },
      ],
    })) as { id: string; url?: string };
    return { pageId: page.id, url: page.url ?? `https://notion.so/${page.id.replace(/-/g, "")}` };
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
