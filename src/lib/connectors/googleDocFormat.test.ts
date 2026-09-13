import { describe, expect, it } from "vitest";
import { buildDocRequests, memoToHtml, parseMemoMarkdown } from "./googleDocFormat";

const sample = `# Droidrun

Opportunity 95  ·  Confidence 77  ·  High conviction

Thesis — Pre-seed founders building agent infrastructure.

## Why now
A Berlin team shipping a mobile agent framework.

## Facts
- mobilerun has 9,363 stars
- Raised a €2.1M pre-seed
`;

describe("google doc format", () => {
  it("parses title, lede, headings, and bullets", () => {
    const blocks = parseMemoMarkdown(sample);
    expect(blocks[0]).toEqual({ kind: "title", text: "Droidrun" });
    expect(blocks[1]?.kind).toBe("lede");
    expect(blocks.some((b) => b.kind === "heading" && b.text === "Why now")).toBe(true);
    expect(blocks.filter((b) => b.kind === "bullet")).toHaveLength(2);
  });

  it("emits insert + paragraph + bullet requests", () => {
    const requests = buildDocRequests(sample);
    expect(requests[0]).toHaveProperty("insertText");
    expect(requests.some((r) => "updateParagraphStyle" in r)).toBe(true);
    expect(requests.some((r) => "createParagraphBullets" in r)).toBe(true);
    const insert = requests[0] as { insertText: { text: string } };
    expect(insert.insertText.text).toContain("Droidrun");
    expect(insert.insertText.text).toContain("mobilerun has 9,363 stars");
    const styles = requests
      .map((r) => (r as { updateParagraphStyle?: { paragraphStyle?: { namedStyleType?: string } } }).updateParagraphStyle?.paragraphStyle?.namedStyleType)
      .filter(Boolean);
    expect(styles).toContain("HEADING_1");
    expect(styles).toContain("HEADING_2");
  });

  it("emits HTML headings Drive can turn into outline entries", () => {
    const html = memoToHtml(sample);
    expect(html).toContain("<h1>Droidrun</h1>");
    expect(html).toContain("<h2>Why now</h2>");
    expect(html).toContain("<h2>Facts</h2>");
    expect(html).toContain("<li>mobilerun has 9,363 stars</li>");
  });
});
