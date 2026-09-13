import { google } from "googleapis";
import type { GoogleConnector } from "./types";
import { requireEnv } from "@/env";

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
    // Insert the memo body as plain text at the start of the doc.
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: markdown } }],
      },
    });
    return { docId, url: `https://docs.google.com/document/d/${docId}/edit` };
  }

  async sendGmail(input: { to: string; subject: string; body: string }): Promise<{ messageId: string }> {
    const auth = this.auth();
    const gmail = google.gmail({ version: "v1", auth });
    const mime = [
      `To: ${input.to}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      `Subject: ${input.subject}`,
      "",
      input.body,
    ].join("\r\n");
    const raw = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { messageId: res.data.id! };
  }
}
