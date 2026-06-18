# Salah Planner

Automatically keeps your Google Calendar populated with the five daily Islamic
prayer windows (Fajr, Dhuhr, Asr, Maghrib, Isha), each with a 10-minute reminder.
It runs **autonomously in the cloud via GitHub Actions** — no laptop required —
and self-heals if a run is ever missed.

Each prayer is created as a *time window* (e.g. Fajr lasts from its start until
sunrise) rather than a single point in time, so your calendar reflects when each
prayer is actually valid.

## How it works

```
GitHub Actions ──daily cron──▶ runOnce.ts ──▶ Aladhan API (prayer times)
   (scheduled)                  (Node/TS)   └─▶ Google Calendar API (events)
                                   ▲
                                   └── credentials from encrypted GitHub secrets
```

1. A **scheduled GitHub Actions workflow** runs once a day on GitHub's servers.
2. It authorizes to Google using a long-lived OAuth refresh token (stored as an
   encrypted **repository secret**), fetches prayer times for a rolling 3-day
   window from the free [Aladhan API](https://aladhan.com/prayer-times-api), and
   writes the events to the user's primary calendar.
3. **Idempotency:** every event is tagged with a private extended property, so
   re-running never creates duplicates — it only fills in what's missing.
4. **Self-healing:** because it schedules 3 days ahead, a single failed or
   delayed run never leaves a gap in the calendar.

The same code runs two ways:

| | Local (`npm start`) | Cloud (GitHub Actions) |
|---|---|---|
| Entry point | `src/index.ts` | `src/runOnce.ts` |
| Auth | interactive browser OAuth → `token.json` | refresh token from env (GH secrets) |
| Location | IP geolocation (or manual) | manual coords (required) |
| Failure surfacing | macOS desktop notification | failed Actions run + logs |

Both share the scheduling logic in `src/core.ts`, so behavior can't drift
between environments.

## Tech stack

- **TypeScript** / Node.js 20
- **GitHub Actions** scheduled workflow for serverless daily execution
- **Google Calendar API** (`googleapis`) with OAuth 2.0
- **Aladhan API** for prayer-time calculation (ISNA method)
- Resilience: exponential-backoff retry with jitter on all network calls

## Project layout

| File | Responsibility |
|---|---|
| `src/core.ts` | Shared scheduling routine + log rotation |
| `src/index.ts` | Local CLI entry point |
| `src/runOnce.ts` | Entry point for scheduled CI runs (GitHub Actions) |
| `src/auth.ts` | OAuth: interactive (local) + env-based (cloud) |
| `src/calendar.ts` | Builds prayer windows, idempotent event creation |
| `src/prayerTimes.ts` | Aladhan API client |
| `src/location.ts` | IP geolocation with manual override |
| `src/retry.ts` | Generic retry-with-backoff helper |
| `src/config.ts` | Centralized env-based configuration |
| `src/dates.ts` | Timezone-aware date helpers |
| `src/notify.ts` | Failure notifications (macOS / logs) |
| `.github/workflows/daily.yml` | The daily scheduled workflow |

## Local setup

```bash
npm install
npm start          # first run opens a browser for OAuth, saves token.json
```

The first run walks you through Google sign-in and saves a `token.json`. After
that, `npm start` runs non-interactively. Optional config goes in a `.env`
file — see `.env.example`.

## Cloud deployment (GitHub Actions)

The workflow in `.github/workflows/daily.yml` runs the planner daily. It needs
three encrypted repository secrets:

| Secret | Where to find it |
|---|---|
| `GOOGLE_CLIENT_ID` | `credentials.json` → `installed.client_id` |
| `GOOGLE_CLIENT_SECRET` | `credentials.json` → `installed.client_secret` |
| `GOOGLE_REFRESH_TOKEN` | `token.json` → `refresh_token` |

Set them via the GitHub CLI (values are piped in, never printed):

```bash
gh secret set GOOGLE_CLIENT_ID
gh secret set GOOGLE_CLIENT_SECRET
gh secret set GOOGLE_REFRESH_TOKEN
```

Or via the web UI: **Settings → Secrets and variables → Actions → New repository
secret**.

Location is set directly in the workflow file (CI runners have no useful IP
geolocation) — edit the `LATITUDE` / `LONGITUDE` / `TIMEZONE` env values in
`daily.yml` to your own. The default is Houston, TX.

Trigger a run manually from the **Actions** tab (the workflow has a
`workflow_dispatch` trigger) to test, then check your Google Calendar.

> **Note:** GitHub disables scheduled workflows after 60 days of repository
> inactivity. Any commit resets the clock.

> **Alternative — GCP Cloud Functions:** the codebase also ships a Cloud
> Functions entry point (`src/cloudFunction.ts`) and a `deploy` npm script, for
> running this on Google Cloud + Cloud Scheduler instead. That path requires a
> GCP billing account (free tier, but a card on file).

## Configuration reference

All configuration is environment-based (see `src/config.ts`).

| Variable | Used in | Default | Purpose |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | cloud | — | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | cloud | — | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | cloud | — | Long-lived OAuth refresh token |
| `LATITUDE` / `LONGITUDE` | both | IP geolocation | Fixed coordinates (required in cloud) |
| `TIMEZONE` | both | system / IP | IANA timezone, e.g. `America/Chicago` |
| `DAYS_AHEAD` | both | `3` | Rolling window size |
| `GOOGLE_CREDENTIALS_PATH` | local | `./credentials.json` | OAuth app credentials |
| `GOOGLE_TOKEN_PATH` | local | `./token.json` | Cached OAuth token |

## Cost

Free. GitHub Actions gives unlimited minutes on public repos (and 2,000
min/month free on private); this job uses ~1 minute per day.

## License

MIT — see [LICENSE](LICENSE).
