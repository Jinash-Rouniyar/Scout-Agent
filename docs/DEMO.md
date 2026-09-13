# Scout — Connected Demo Environment & Rehearsal

The demo must show real integrated behavior. Write actions and the newsletter send are live.
A labeled seeded run (`run_demo_thesis`) is allowed for speed.

## 1. Connected environment checklist

- [ ] **Postgres (Neon)** provisioned; `DATABASE_URL` set; `npm run db:push` applied.
- [ ] **Notion**: dedicated database shared with the integration; `NOTION_API_KEY` and `NOTION_DATABASE_ID` set.
- [ ] **Slack**: test channel; bot invited; `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID` set.
- [ ] **Google**: OAuth refresh token with Docs + Gmail send; `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` and `RECAP_TO_EMAIL` set. Mint with `npx tsx --env-file=.env scripts/google-oauth.ts`.
- [ ] **Cached thesis run** seeded: `npm run db:seed` → `/runs/run_demo_thesis`.
- [ ] **Langfuse** US project; `LANGFUSE_BASE_URL=https://us.cloud.langfuse.com`. Confirm traces appear.
- [ ] **Vercel** production project with env vars and `CRON_SECRET`. Next.js must be a patched 15.5.x (Vercel blocks CVE-2025-66478).
- [ ] **`ADMIN_TOKEN`** if you use `POST /api/admin/recap`. The run-page **Send newsletter** button is the usual demo path.

## 2. Manual triggers

```bash
# Daily monitor
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/monitor

# Friday newsletter via cron path (idempotent per week)
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/recap

# Admin path (same function)
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{}' https://<app>/api/admin/recap
```

The run-page **Send newsletter** field always sends a fresh letter to the address you enter (does not reuse the weekly receipt).

## 3. Two-minute walkthrough

| Time | Action | Proves |
|---|---|---|
| 0:00–0:15 | Enter a thesis on `/` | Thesis-first UI |
| 0:15–0:40 | Discovery → select companies + Slack / newsletter / Notion | Human configure, not dump-everywhere |
| 0:40–1:05 | Parallel research; open the Google Doc | Outline-ready memo, scored brief |
| 1:05–1:25 | Slack + Notion + `/watchlist` | Differentiated surfaces |
| 1:25–1:45 | **Send newsletter** | Hero, logos, editorial letter |
| 1:45–2:00 | `/evals` and Langfuse | Reliability measured, never invented |

Use `/runs/run_demo_thesis` if you need a completed pack without waiting on a cold discovery.

## 4. Reliability evidence

`npm run eval` (needs `DATABASE_URL` + `ANTHROPIC_API_KEY`) writes `evals/report.json`. `/evals` shows that file only. Present the real Pass³ number — or the honest empty state — never a target value.
