# Salah Planner

Automatically keeps your Google Calendar populated with the five daily Islamic
prayer windows (Fajr, Dhuhr, Asr, Maghrib, Isha), each with a 10-minute reminder.
It runs **autonomously in the cloud** — no laptop required — and self-heals if a
run is ever missed.

Each prayer is created as a *time window* (e.g. Fajr lasts from its start until
sunrise) rather than a single point in time, so your calendar reflects when each
prayer is actually valid.

## How it works

```
Cloud Scheduler ──daily POST──▶ Cloud Function ──▶ Aladhan API (prayer times)
  (cron, 3 AM)   (OIDC auth)      (Node/TS)     └─▶ Google Calendar API (events)
                                      ▲
                                      └── secrets from Secret Manager
```

1. **Cloud Scheduler** fires a daily cron job, sending an authenticated (OIDC)
   POST to the function.
2. The **Cloud Function** authorizes to Google using a long-lived OAuth refresh
   token (pulled from **Secret Manager**), fetches prayer times for a rolling
   3-day window from the free [Aladhan API](https://aladhan.com/prayer-times-api),
   and writes the events to the user's primary calendar.
3. **Idempotency:** every event is tagged with a private extended property, so
   re-running never creates duplicates — it only fills in what's missing.
4. **Self-healing:** because it schedules 3 days ahead, a single failed or
   delayed run never leaves a gap in the calendar.

The same code runs two ways:

| | Local (`npm start`) | Cloud (`updatePrayerTimes`) |
|---|---|---|
| Entry point | `src/index.ts` | `src/cloudFunction.ts` |
| Auth | interactive browser OAuth → `token.json` | refresh token from env (Secret Manager) |
| Location | IP geolocation (or manual) | manual coords (required) |
| Failure surfacing | macOS desktop notification | HTTP 500 + Cloud Logging |

Both share the scheduling logic in `src/core.ts`, so behavior can't drift
between environments.

## Tech stack

- **TypeScript** / Node.js 20
- **Google Cloud Functions (gen2)** + **Cloud Scheduler** for serverless cron
- **Secret Manager** for credential storage
- **Google Calendar API** (`googleapis`) with OAuth 2.0
- **Aladhan API** for prayer-time calculation (ISNA method)
- Resilience: exponential-backoff retry with jitter on all network calls

## Project layout

| File | Responsibility |
|---|---|
| `src/core.ts` | Shared scheduling routine + log rotation |
| `src/index.ts` | Local CLI entry point |
| `src/cloudFunction.ts` | HTTP entry point for Cloud Functions |
| `src/auth.ts` | OAuth: interactive (local) + env-based (cloud) |
| `src/calendar.ts` | Builds prayer windows, idempotent event creation |
| `src/prayerTimes.ts` | Aladhan API client |
| `src/location.ts` | IP geolocation with manual override |
| `src/retry.ts` | Generic retry-with-backoff helper |
| `src/config.ts` | Centralized env-based configuration |
| `src/dates.ts` | Timezone-aware date helpers |
| `src/notify.ts` | Failure notifications (macOS / Cloud Logging) |

## Local setup

```bash
npm install
npm start          # first run opens a browser for OAuth, saves token.json
```

The first run walks you through Google sign-in and saves a `token.json`. After
that, `npm start` runs non-interactively. Optional config goes in a `.env`
file — see `.env.example`.

## Cloud deployment

Prerequisites: a GCP project with billing enabled, the `gcloud` CLI installed and
authenticated, and the OAuth consent screen set to **"In production"** (so the
refresh token doesn't expire after 7 days).

Enable the required APIs once:

```bash
gcloud services enable \
  cloudfunctions.googleapis.com run.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com \
  cloudbuild.googleapis.com
```

### 1. Store credentials in Secret Manager

Your `client_id` / `client_secret` are in `credentials.json` (under `installed`);
your `refresh_token` is in `token.json`.

```bash
echo -n "YOUR_CLIENT_ID"     | gcloud secrets create google-client-id     --data-file=-
echo -n "YOUR_CLIENT_SECRET" | gcloud secrets create google-client-secret --data-file=-
echo -n "YOUR_REFRESH_TOKEN" | gcloud secrets create google-refresh-token --data-file=-
```

Grant the function's runtime service account access to read them (replace
`PROJECT_NUMBER`):

```bash
for S in google-client-id google-client-secret google-refresh-token; do
  gcloud secrets add-iam-policy-binding $S \
    --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 2. Deploy

```bash
npm run deploy -- \
  --set-secrets="GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest,GOOGLE_REFRESH_TOKEN=google-refresh-token:latest" \
  --set-env-vars="LATITUDE=29.7604,LONGITUDE=-95.3698,TIMEZONE=America/Chicago"
```

> **Location must be set manually in the cloud.** IP geolocation there returns
> Google's data-center IP, not yours. The example uses Houston, TX.

### 3. Schedule the daily run

```bash
# Service account the scheduler uses to invoke the function
gcloud iam service-accounts create scheduler-invoker

gcloud run services add-iam-policy-binding salah-planner \
  --region=us-central1 \
  --member="serviceAccount:scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"

FUNCTION_URL=$(gcloud functions describe salah-planner --region=us-central1 --format="value(serviceConfig.uri)")

gcloud scheduler jobs create http salah-planner-daily \
  --schedule="0 3 * * *" \
  --uri="$FUNCTION_URL" \
  --http-method=POST \
  --oidc-service-account-email="scheduler-invoker@PROJECT_ID.iam.gserviceaccount.com" \
  --oidc-token-audience="$FUNCTION_URL" \
  --time-zone="America/Chicago"
```

### 4. Test and observe

```bash
gcloud scheduler jobs run salah-planner-daily            # trigger now
gcloud functions logs read salah-planner --region=us-central1
```

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

Comfortably within GCP's always-free tier — roughly 30 invocations/month against
free-tier allowances of millions. Effectively $0.
