# Scout — Connected Demo Environment & Rehearsal

Build the connected environment **before** any visual polish. The demo must show real integrated
behavior; write actions and the monitor event must be real (a clearly labeled cached research
trace is allowed for speed).

## 1. Connected environment checklist

- [ ] **Postgres (Neon)** provisioned; `DATABASE_URL` set; `npm run db:push` applied.
- [ ] **Notion**: dedicated database created and shared with the integration; `NOTION_API_KEY`
      and `NOTION_DATABASE_ID` set; a founder page template exists.
- [ ] **Slack**: test workspace + channel; bot installed with `chat:write` and invited to the
      channel; `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID` set.
- [ ] **Google test account**: OAuth client created; refresh token minted with
      `https://www.googleapis.com/auth/documents` and `https://www.googleapis.com/auth/gmail.send`;
      `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` and `RECAP_TO_EMAIL` set.
- [ ] **Controlled GitHub repo** owned by the demo identity, with a real commit/release published
      **after** the watch start so the monitor produces a genuine material signal.
- [ ] **Known public person/company input** chosen (e.g. a GitHub URL) for the live run.
- [ ] **Cached research trace** seeded: `npm run db:seed` (creates the Alice AI dossier in
      `WATCHING`). Use this for the rich dossier moment to avoid cold-search latency.
- [ ] **Langfuse** project connected; `LANGFUSE_*` set. Confirm traces appear.
- [ ] **Vercel** production project deployed with all env vars and `CRON_SECRET`; crons visible in
      the Vercel dashboard (`vercel.json` defines `0 14 * * *` monitor and `0 16 * * 5` recap).
- [ ] **`ADMIN_TOKEN`** set so the weekly recap can be triggered manually during the demo.

## 2. Manual triggers (rehearsal-safe)

Cron only runs in production and does not retry, so rehearse via the same code paths:

```bash
# Daily monitor (protected)
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/monitor

# Weekly recap via cron path (protected)
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/recap

# Weekly recap via the demo-only manual path (same function; shares idempotency receipt)
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{}' https://<app>/api/admin/recap
```

Because writes are idempotent (via `action_receipts`), running these more than once will not create
duplicate Notion pages, Slack posts, or Gmail sends.

## 3. Two-minute walkthrough

| Time | Action | Proves |
|---|---|---|
| 0:00–0:15 | Paste a founder GitHub URL + investment lens on `/`, Start Scout | Purpose-built entity-first UI |
| 0:15–0:40 | Watch the live run: plan advances, tool events + evidence stream in (SSE) | Multi-step bounded agent, not a static report |
| 0:40–1:05 | Open the seeded Alice AI dossier (`/runs/run_demo_alice`) | Grounded conviction, risks, open questions, scores |
| 1:05–1:30 | Approve the diligence pack; show Notion + Doc + Slack receipts complete | Real writes across three apps, idempotent |
| 1:30–1:50 | Trigger `/api/cron/monitor` against the controlled repo with a real new release | Deterministic continuous-intelligence loop |
| 1:50–2:00 | Show the updated Notion timeline + Slack thread, then `/watchlist` and `/evals` | End-to-end outcome + real reliability metrics |

## 4. Reliability evidence

Run `npm run eval` ahead of the demo (needs `DATABASE_URL` + `ANTHROPIC_API_KEY`). It executes 36
real trajectories against mocked connectors and writes `evals/report.json`, surfaced at `/evals`
with Langfuse trace links. Present the real Pass³ number — never a target value.
