import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { optionalEnv, useFixtures } from "@/env";

export const dynamic = "force-dynamic";

/** Connection + configuration health. Never returns secret values. */
export async function GET() {
  let dbOk = false;
  let dbError: string | undefined;
  try {
    await sql`select 1 as ok`;
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : "unknown";
  }

  const configured = (key: Parameters<typeof optionalEnv>[0]) => Boolean(optionalEnv(key));

  return NextResponse.json({
    ok: dbOk,
    db: { ok: dbOk, error: dbError },
    fixtures: useFixtures(),
    connectors: {
      anthropic: configured("ANTHROPIC_API_KEY"),
      exa: configured("EXA_API_KEY"),
      tavily: configured("TAVILY_API_KEY"),
      github: configured("GITHUB_TOKEN"),
      notion: configured("NOTION_API_KEY"),
      slack: configured("SLACK_BOT_TOKEN"),
      google: configured("GOOGLE_REFRESH_TOKEN"),
      langfuse: configured("LANGFUSE_PUBLIC_KEY"),
      cron: configured("CRON_SECRET"),
    },
  });
}
