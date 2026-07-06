# Salah Planner

Automatically keeps my Google Calendar populated with the five daily Islamic
prayer windows (Fajr, Dhuhr, Asr, Maghrib, Isha), each with a 10-minute
reminder. It runs on its own every day via GitHub Actions — no laptop required.

## Why I built this

As a Muslim student athlete, my schedule can get a little busy, whether it's
class, practice, or workouts. As a result, I would sometimes overlook my
prayers. In an effort to combat this, I built this tool that adds the
windows/time frames of the 5 daily prayers onto Google Calendar every day. So
alongside my daily events for the day on Google Calendar, I can now also see
my daily prayers, so that when I plan for the day I can take my prayers into
account.

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
   writes the events to my primary calendar.
3. **No duplicates:** every event is tagged with a private extended property, so
   re-running only fills in whatever is missing (idempotent).
4. **Self-healing:** because it schedules 3 days ahead, a single failed or
   delayed run never leaves a gap in the calendar.

The same code runs two ways — locally (`npm start`, with interactive browser
OAuth) or in CI (`src/runOnce.ts`, with credentials from environment
variables). Both share the scheduling logic in `src/core.ts`, so behavior
can't drift between the two.

## Tech stack

- **TypeScript** / Node.js 20
- **GitHub Actions** scheduled workflow for free serverless daily execution
- **Google Calendar API** (`googleapis`) with OAuth 2.0
- **Aladhan API** for prayer-time calculation (ISNA method)
- Exponential-backoff retry with jitter on all network calls

## Project layout

| File | Responsibility |
|---|---|
| `src/core.ts` | Shared scheduling routine |
| `src/index.ts` | Local CLI entry point |
| `src/runOnce.ts` | Entry point for the daily GitHub Actions run |
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

The first run walks you through Google sign-in and saves a `token.json`; after
that it runs non-interactively. Optional settings (fixed coordinates, timezone,
days ahead) go in a `.env` file — see `.env.example` and `src/config.ts`.

## Cloud deployment (GitHub Actions)

The workflow in `.github/workflows/daily.yml` runs the planner daily. It needs
three encrypted repository secrets:

| Secret | Where to find it |
|---|---|
| `GOOGLE_CLIENT_ID` | `credentials.json` → `installed.client_id` |
| `GOOGLE_CLIENT_SECRET` | `credentials.json` → `installed.client_secret` |
| `GOOGLE_REFRESH_TOKEN` | `token.json` → `refresh_token` |

Set them under **Settings → Secrets and variables → Actions**, or with the
GitHub CLI (`gh secret set NAME` — values are piped in, never printed).

Location is set directly in the workflow file, since CI runners have no useful
IP geolocation — edit the `LATITUDE` / `LONGITUDE` / `TIMEZONE` values in
`daily.yml`. To test, trigger a run manually from the **Actions** tab, then
check your calendar.

> **Note:** GitHub disables scheduled workflows after 60 days of repository
> inactivity; any commit resets the clock.

Running this costs nothing: GitHub Actions is free for public repos, and the
job uses about a minute a day.

## License

MIT — see [LICENSE](LICENSE).
