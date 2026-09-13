import { WebClient } from "@slack/web-api";
import type { SlackConnector } from "./types";
import { requireEnv } from "@/env";

/**
 * Slack write connector (scope: chat:write). Slack has no generic idempotency
 * key, so duplicate suppression is enforced by the action_receipts table
 * (store ts/thread_ts, reuse on retry).
 */
export class LiveSlackConnector implements SlackConnector {
  readonly name = "slack" as const;

  private client() {
    return new WebClient(requireEnv("SLACK_BOT_TOKEN"));
  }

  async createThread(channel: string, text: string): Promise<{ ts: string }> {
    const res = await this.client().chat.postMessage({ channel, text });
    if (!res.ok || !res.ts) throw new Error(`slack:post-failed:${res.error ?? "unknown"}`);
    return { ts: res.ts };
  }

  async postToThread(channel: string, threadTs: string, text: string): Promise<{ ts: string }> {
    const res = await this.client().chat.postMessage({ channel, text, thread_ts: threadTs });
    if (!res.ok || !res.ts) throw new Error(`slack:post-failed:${res.error ?? "unknown"}`);
    return { ts: res.ts };
  }
}
