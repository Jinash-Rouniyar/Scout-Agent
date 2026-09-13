import type { Connectors } from "./types";
import { LiveExaConnector } from "./exa";
import { LiveGithubConnector } from "./github";
import { TavilySearchConnector } from "./web/search";
import { LiveFetchConnector } from "./web/fetch";
import { LiveNotionConnector } from "./notion";
import { LiveSlackConnector } from "./slack";
import { LiveGoogleConnector } from "./google";

/** Live connector bundle used by the app and cron routes. */
export function liveConnectors(): Connectors {
  return {
    exa: new LiveExaConnector(),
    github: new LiveGithubConnector(),
    search: new TavilySearchConnector(),
    fetch: new LiveFetchConnector(),
    notion: new LiveNotionConnector(),
    slack: new LiveSlackConnector(),
    google: new LiveGoogleConnector(),
  };
}
