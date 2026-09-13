import { google } from "googleapis";
import type { GoogleConnector } from "./types";
import { requireEnv } from "@/env";
import { buildDocRequests } from "./googleDocFormat";
import { encodeRfc2047 } from "@/lib/util/mime";

/**
 * Google Docs + Gmail connector.
 *
 * Scopes (minimum): https://www.googleapis.com/auth/documents (create/update
 * docs) and https://www.googleapis.com/auth/gmail.send (send mail). Tokens are
 * server-side only; a long-lived refresh token is minted offline.
 *
 * The Friday recap MUST actually send a Gmail message (not a draft).
 */
export class LiveGoogleConnector implements GoogleConnector {
  readonly name = "google" as const;

  private auth() {
    const client = new google.auth.OAuth2(
      requireEnv("GOOGLE_CLIENT_ID"),
      requireEnv("GOOGLE_CLIENT_SECRET"),
    );
    client.setCredentials({ refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN") });
    return client;
  }

  async createDoc(title: string, markdown: string): Promise<{ docId: string; url: string }> {
    const auth = this.auth();
    const docs = google.docs({ version: "v1", auth });
    const created = await docs.documents.create({ requestBody: { title } });
    const docId = created.data.documentId!;
    await this.writeFormattedBody(docs, docId, markdown);
    return { docId, url: `https://docs.google.com/document/d/${docId}/edit` };
  }

  async replaceDoc(docId: string, markdown: string): Promise<{ docId: string; url: string }> {
    const docs = google.docs({ version: "v1", auth: this.auth() });
    const existing = await docs.documents.get({ documentId: docId });
    const endIndex = existing.data.body?.content?.at(-1)?.endIndex ?? 2;
    const requests: Array<Record<string, unknown>> = [];
    if (endIndex > 2) {
      requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
    }
    await this.writeFormattedBody(docs, docId, markdown, requests);
    return { docId, url: `https://docs.google.com/document/d/${docId}/edit` };
  }

  /** Insert memo text, then apply heading styles in a second call so Google
   *  assigns headingIds (needed for the document outline). Mixing insert +
   *  style in one batchUpdate often yields HEADING_2 with no headingId. */
  private async writeFormattedBody(
    docs: ReturnType<typeof google.docs>,
    docId: string,
    markdown: string,
    prefix: Array<Record<string, unknown>> = [],
  ) {
    const requests = buildDocRequests(markdown);
    const insert = requests.filter((r) => "insertText" in r);
    const styles = requests.filter((r) => !("insertText" in r));
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [...prefix, ...insert] },
    });
    if (styles.length) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests: styles },
      });
    }
  }

  async sendGmail(input: {
    to: string;
    subject: string;
    body: string;
    html?: string;
    images?: Array<{ cid: string; filename: string; mimeType: string; data: Buffer }>;
  }): Promise<{ messageId: string }> {
    const auth = this.auth();
    const gmail = google.gmail({ version: "v1", auth });
    const images = input.images ?? [];
    const alt = `scout_alt_${Date.now().toString(16)}`;
    const rel = `scout_rel_${Date.now().toString(16)}`;

    const alternative = [
      `--${alt}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(input.body, "utf8").toString("base64"),
    ];
    if (input.html) {
      alternative.push(
        `--${alt}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from(input.html, "utf8").toString("base64"),
      );
    }
    alternative.push(`--${alt}--`);

    const parts = [`To: ${input.to}`, `Subject: ${encodeRfc2047(input.subject)}`, "MIME-Version: 1.0"];
    if (images.length && input.html) {
      parts.push(`Content-Type: multipart/related; type="multipart/alternative"; boundary="${rel}"`, "");
      parts.push(`--${rel}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "");
      parts.push(...alternative);
      for (const image of images) {
        parts.push(
          `--${rel}`,
          `Content-Type: ${image.mimeType}`,
          "Content-Transfer-Encoding: base64",
          `Content-ID: <${image.cid}>`,
          `Content-Disposition: inline; filename="${image.filename}"`,
          "",
          image.data.toString("base64"),
        );
      }
      parts.push(`--${rel}--`);
    } else {
      parts.push(`Content-Type: multipart/alternative; boundary="${alt}"`, "");
      parts.push(...alternative);
    }

    const raw = Buffer.from(parts.join("\r\n"), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { messageId: res.data.id! };
  }
}
