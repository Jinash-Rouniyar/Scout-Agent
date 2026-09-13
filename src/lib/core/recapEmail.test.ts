import { describe, expect, it } from "vitest";
import {
  buildRecapHtml,
  buildRecapPlaintext,
  encodeRfc2047,
  escapeHtml,
  fallbackEditorial,
  firstSentence,
} from "./recapEmail";

const model = {
  asOf: new Date("2026-09-13T16:00:00Z"),
  period: "2026-W37",
  editorial: "Droidrun kept shipping. Lemma stayed quiet.",
  watching: [
    {
      name: "Droidrun",
      opportunity: 95,
      confidence: 77,
      label: "High conviction",
      whyNow: "A Berlin team shipping a mobile agent framework.",
      docUrl: "https://docs.google.com/document/d/abc/edit",
    },
  ],
  material: [
    {
      name: "Lemma",
      kind: "release",
      materiality: 68,
      assessment: "New tagged release on the core repo.",
      citationUrl: "https://github.com/uselemma",
    },
  ],
  quiet: [{ name: "Composio", opportunity: 80, confidence: 82, label: "High conviction" }],
  trends: [],
};

describe("recap email", () => {
  it("encodes subjects so em dashes do not mojibake", () => {
    expect(encodeRfc2047("Scout — week")).toMatch(/^=\?UTF-8\?B\?/);
  });

  it("escapes HTML in company names", () => {
    expect(escapeHtml(`A <B> & "C"`)).toBe("A &lt;B&gt; &amp; &quot;C&quot;");
  });

  it("builds a readable plaintext fallback", () => {
    const text = buildRecapPlaintext(model);
    expect(text).toContain("SCOUT NEWSLETTER");
    expect(text).toContain("Droidrun");
    expect(text).toContain("Lemma");
    expect(text).toContain("https://github.com/uselemma");
  });

  it("places the hero image after the date", () => {
    const html = buildRecapHtml({ ...model, heroCid: "scout-hero" });
    const dateAt = html.indexOf("September 13, 2026");
    const heroAt = html.indexOf('src="cid:scout-hero"');
    const briefAt = html.indexOf("The brief");
    expect(dateAt).toBeGreaterThan(-1);
    expect(heroAt).toBeGreaterThan(dateAt);
    expect(briefAt).toBeGreaterThan(heroAt);
  });

  it("embeds attached company marks by cid", () => {
    const html = buildRecapHtml({
      ...model,
      watching: [{ ...model.watching[0], logoCid: "logo-droidrun" }],
    });
    expect(html).toContain('src="cid:logo-droidrun"');
  });

  it("builds HTML with sections and no raw URLs in the headline", () => {
    const html = buildRecapHtml(model);
    expect(html).toContain("Scout newsletter");
    expect(html).toContain("On the watchlist");
    expect(html).toContain("What moved");
    expect(html).toContain("Read the memo");
    expect(html).toContain("Read the source");
    expect(html).toContain("Quiet this week");
    expect(html).not.toContain("<script");
  });

  it("falls back to a grounded quiet-week brief", () => {
    const brief = fallbackEditorial({
      ...model,
      material: [],
      quiet: model.watching,
    });
    expect(brief).toMatch(/No material signals/i);
    expect(brief).toContain("1");
  });

  it("takes the first sentence only", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
  });
});
