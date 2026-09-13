/**
 * Turn a lightly-structured markdown memo into Google Docs batchUpdate
 * requests: title, lede, section headings, body, and bullets — not a wall of
 * unstyled text.
 */

export type MemoBlock =
  | { kind: "title"; text: string }
  | { kind: "lede"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string };

export function parseMemoMarkdown(markdown: string): MemoBlock[] {
  const blocks: MemoBlock[] = [];
  let sawTitle = false;
  let sawLede = false;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) {
      blocks.push({ kind: "title", text: line.slice(2).trim() });
      sawTitle = true;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({ kind: "bullet", text: line.slice(2).trim() });
      continue;
    }
    if (sawTitle && !sawLede && !blocks.some((b) => b.kind === "heading")) {
      blocks.push({ kind: "lede", text: line.trim() });
      sawLede = true;
      continue;
    }
    blocks.push({ kind: "paragraph", text: line.trim() });
  }
  return blocks;
}

const SLATE: { red: number; green: number; blue: number } = { red: 0.09, green: 0.11, blue: 0.16 };
const MUTED: { red: number; green: number; blue: number } = { red: 0.39, green: 0.42, blue: 0.47 };

type DocsRequest = Record<string, unknown>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * HTML import is what actually gives Google Docs a document outline.
 * The Docs API can set namedStyleType HEADING_2, but it does not assign a
 * headingId — and the sidebar outline only lists paragraphs that have one.
 * Drive's HTML converter creates real Heading 1/2 styles with headingIds.
 */
export function memoToHtml(markdown: string): string {
  const blocks = parseMemoMarkdown(markdown);
  const body: string[] = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      body.push("</ul>");
      listOpen = false;
    }
  };
  for (const block of blocks) {
    if (block.kind === "bullet") {
      if (!listOpen) {
        body.push("<ul>");
        listOpen = true;
      }
      body.push(`<li>${escapeHtml(block.text)}</li>`);
      continue;
    }
    closeList();
    if (block.kind === "title") body.push(`<h1>${escapeHtml(block.text)}</h1>`);
    else if (block.kind === "heading") body.push(`<h2>${escapeHtml(block.text)}</h2>`);
    else if (block.kind === "lede") body.push(`<p><em>${escapeHtml(block.text)}</em></p>`);
    else body.push(`<p>${escapeHtml(block.text)}</p>`);
  }
  closeList();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body>
${body.join("\n")}
</body>
</html>`;
}

/** Docs API character indices start at 1. Kept for tests and as a fallback. */
export function buildDocRequests(markdown: string): DocsRequest[] {
  const blocks = parseMemoMarkdown(markdown);
  if (blocks.length === 0) {
    return [{ insertText: { location: { index: 1 }, text: markdown || "\n" } }];
  }

  const text = `${blocks.map((b) => b.text).join("\n")}\n`;
  const requests: DocsRequest[] = [{ insertText: { location: { index: 1 }, text } }];

  let cursor = 1;
  const ranges = blocks.map((block) => {
    const start = cursor;
    const end = cursor + block.text.length;
    cursor = end + 1;
    return { block, start, end, paraEnd: end + 1 };
  });

  for (const { block, start, end, paraEnd } of ranges) {
    if (block.kind === "title") {
      // Heading 1 — native outline entry. Do not overlay text styles; that
      // is what prevents Google from assigning a headingId.
      requests.push(paragraph(start, paraEnd, "HEADING_1", 0, 10));
    } else if (block.kind === "lede") {
      requests.push(
        paragraph(start, paraEnd, "SUBTITLE", 4, 18),
        textStyle(start, end, {
          italic: true,
          fontSize: 12,
          fontFamily: "Georgia",
          color: MUTED,
        }),
      );
    } else if (block.kind === "heading") {
      requests.push(paragraph(start, paraEnd, "HEADING_2", 18, 6));
    } else {
      requests.push(
        paragraph(start, paraEnd, "NORMAL_TEXT", block.kind === "bullet" ? 2 : 0, 8),
        textStyle(start, end, {
          fontSize: 11,
          fontFamily: "Georgia",
          color: SLATE,
        }),
      );
    }
  }

  const bulletGroups: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    if (range.block.kind !== "bullet") continue;
    const last = bulletGroups[bulletGroups.length - 1];
    if (last && last.end === range.start) last.end = range.paraEnd;
    else bulletGroups.push({ start: range.start, end: range.paraEnd });
  }
  for (const group of bulletGroups) {
    requests.push({
      createParagraphBullets: {
        range: { startIndex: group.start, endIndex: group.end },
        bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
  }

  return requests;
}

function paragraph(
  start: number,
  end: number,
  namedStyleType: string,
  spaceAbove: number,
  spaceBelow: number,
): DocsRequest {
  return {
    updateParagraphStyle: {
      range: { startIndex: start, endIndex: end },
      paragraphStyle: {
        namedStyleType,
        spaceAbove: { magnitude: spaceAbove, unit: "PT" },
        spaceBelow: { magnitude: spaceBelow, unit: "PT" },
      },
      fields: "namedStyleType,spaceAbove,spaceBelow",
    },
  };
}

function textStyle(
  start: number,
  end: number,
  opts: {
    bold?: boolean;
    italic?: boolean;
    fontSize: number;
    fontFamily: string;
    color: { red: number; green: number; blue: number };
  },
): DocsRequest {
  const fields = ["weightedFontFamily", "fontSize", "foregroundColor"];
  const style: Record<string, unknown> = {
    weightedFontFamily: { fontFamily: opts.fontFamily },
    fontSize: { magnitude: opts.fontSize, unit: "PT" },
    foregroundColor: { color: { rgbColor: opts.color } },
  };
  if (opts.bold) {
    style.bold = true;
    fields.push("bold");
  }
  if (opts.italic) {
    style.italic = true;
    fields.push("italic");
  }
  return {
    updateTextStyle: {
      range: { startIndex: start, endIndex: end },
      textStyle: style,
      fields: fields.join(","),
    },
  };
}
