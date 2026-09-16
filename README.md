# Sentry SaaS Developer-plan observability PoC

This repository is a small, runnable architecture used to **validate whether Sentry can be the main application-observability platform** for a real frontend-plus-multi-backend system.

The goal is not merely “an event arrived in Sentry”. The goal is to see whether these two paths appear as **coherent distributed traces** with correct propagation across service and language boundaries:

```
Browser → Next.js → Python Direct
Browser → Next.js → Spring Boot → Python Downstream
```

Frontend observability is a first-class requirement: browser errors, Web Vitals, production source maps, and browser logs/metrics where the current SDK supports them.

Session Replay and Profiling are **intentionally not enabled**. This PoC targets the Sentry free Developer plan.

## 1. Architecture

```
                         ┌──────────────────────────┐
                         │  Browser (Next.js UI)    │
                         │  port 3000               │
                         └────────────┬─────────────┘
                                      │ same-origin /api/*
                                      ▼
                         ┌──────────────────────────┐
                         │  Next.js  (web-next)     │
                         │  sentry-poc-next         │
                         └───┬──────────────────┬───┘
                             │                  │
                             │                  │ outbound fetch
                             │                  │ sentry-trace + baggage
                             │                  │ + W3C traceparent
                             ▼                  ▼
              ┌──────────────────────┐   ┌──────────────────────┐
              │ Python Direct        │   │ Spring Boot          │
              │ :8001                │   │ :8080                │
              │ sentry-poc-python-   │   │ sentry-poc-spring    │
              │ direct               │   └──────────┬───────────┘
              └──────────────────────┘              │ RestClient
                                                    ▼
                                         ┌──────────────────────┐
                                         │ Python Downstream    │
                                         │ :8002                │
                                         │ sentry-poc-python-   │
                                         │ downstream           │
                                         └──────────────────────┘
```

CORS is not configured on the backends: the browser only talks to Next.js. Next.js and Spring make server-side HTTP calls.

The inspectable Next.js outbound hop lives in `web-next/lib/outbound-fetch.ts`. A previous OpenTelemetry PoC lost the trace at that boundary. This code uses native `fetch` plus the official `Sentry.getTraceData()` helper. **Trust `downstream_body.incoming_trace_headers` as the source of truth** for what the next service actually received.

## 2. Service / port table

| Service | Directory | Default URL | Sentry project |
| --- | --- | --- | --- |
| Next.js dashboard + BFF | `web-next/` | http://127.0.0.1:3000 | `sentry-poc-next` |
| Spring Boot | `backend-spring/` | http://127.0.0.1:8080 | `sentry-poc-spring` |
| Python Direct (FastAPI) | `backend-python-direct/` | http://127.0.0.1:8001 | `sentry-poc-python-direct` |
| Python Downstream (FastAPI) | `backend-python-downstream/` | http://127.0.0.1:8002 | `sentry-poc-python-downstream` |

Versions used at implementation time (latest stable checked against official docs / registries):

| Component | Version |
| --- | --- |
| Next.js | 16.3.5 |
| React | 19.2.8 |
| @sentry/nextjs | 10.75.0 |
| Python | 3.12 |
| FastAPI | 0.141.1 |
| sentry-sdk (Python) | 2.69.2 |
| Java | 21 |
| Spring Boot | 4.1.1 |
| sentry-spring-boot-4 | 8.56.0 |

## 3. Environment variables

Copy `.env.example` to `.env`. DSNs are public ingestion keys for this PoC.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Next.js browser + server | Project `sentry-poc-next` |
| `SENTRY_DSN_SPRING` | Spring Boot | Project `sentry-poc-spring` |
| `SENTRY_DSN_PYTHON_DIRECT` | Python Direct | Project `sentry-poc-python-direct` |
| `SENTRY_DSN_PYTHON_DOWNSTREAM` | Python Downstream | Project `sentry-poc-python-downstream` |
| `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | all | `poc` |
| `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE` | all | `sentry-poc@1.0.0` |
| `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | all | **PoC-only** default `1.0` |
| `PYTHON_DIRECT_BASE_URL` | Next.js server | Outbound to Python Direct |
| `SPRING_BASE_URL` | Next.js server | Outbound to Spring |
| `SENTRY_POC_DOWNSTREAM_BASE_URL` | Spring | Outbound to Python Downstream |
| `SENTRY_POC_UPTIME_MODE` | Spring | Optional default for `/api/uptime-test` |
| `SENTRY_ORG` | Next.js production build | Org slug for source map upload |
| `SENTRY_PROJECT` | Next.js production build | `sentry-poc-next` |
| `SENTRY_AUTH_TOKEN` | Next.js production build | **Secret.** Create later in Sentry. Never commit. |

Do not commit Sentry auth tokens, API tokens, or GitHub tokens.

### Source-map token

Create the token in Sentry later:

1. Open **Settings → Auth Tokens → Create New Token** (organization auth token).
2. Grant scopes needed for release/source-map upload (commonly `project:releases` and `org:read`; follow the token wizard if Sentry shows a recommended set).
3. Put the token in `.env` as `SENTRY_AUTH_TOKEN`.
4. Set `SENTRY_ORG` to your organization slug (not the numeric org id in the DSN).

The Next.js production build still succeeds without this token. Source maps simply are not uploaded.

### Sampling (read this)

`SENTRY_TRACES_SAMPLE_RATE=1.0` is isolated in `.env.example` so distributed-trace validation is reliable. **Production must not copy this.** Use a low rate or a `tracesSampler` / dynamic sampling. Replay and profiling stay off.

Health endpoints are unsampled in the Python services (`traces_sampler` returns `0` for `/health`).

## 4. Setup

Prerequisites: Node 20.9+, Python 3.12 (`python3-venv` on Debian/Ubuntu), Java 21, Maven 3.6.3+ (for Spring).

```bash
cp .env.example .env
# edit SENTRY_ORG later when you are ready to upload source maps

python3 -m venv backend-python-direct/.venv
backend-python-direct/.venv/bin/pip install -r backend-python-direct/requirements.txt

python3 -m venv backend-python-downstream/.venv
backend-python-downstream/.venv/bin/pip install -r backend-python-downstream/requirements.txt

cd web-next && npm install && cd ..
```

`./scripts/start-all.sh` performs the same setup if venvs / `node_modules` are missing.

## 5. Run

Preferred local workflow (native processes, not Docker):

```bash
chmod +x scripts/*.sh dev.sh
./scripts/start-all.sh
# dashboard: http://127.0.0.1:3000
./scripts/smoke-test.sh
./scripts/stop-all.sh
```

Run services individually:

```bash
# Python Direct
backend-python-direct/.venv/bin/uvicorn app:app --app-dir backend-python-direct --port 8001

# Python Downstream
backend-python-downstream/.venv/bin/uvicorn app:app --app-dir backend-python-downstream --port 8002

# Spring
mvn -f backend-spring/pom.xml spring-boot:run

# Next.js (copy env first)
cp .env web-next/.env.local
npm --prefix web-next run dev
```

Docker is optional and only wraps these four apps:

```bash
docker compose up --build
```

There is no PostgreSQL, Redis, Kafka, ClickHouse, or OpenTelemetry Collector.

## 6. Production Next.js build / source-map test

Without an auth token (build must still succeed):

```bash
cp .env web-next/.env.local
npm --prefix web-next run build
npm --prefix web-next run start
```

With source-map upload (after creating `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`):

```bash
# .env contains SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT=sentry-poc-next
cp .env web-next/.env.local
npm --prefix web-next run build   # uploads maps, then deletes client maps from the output
npm --prefix web-next run start
```

Then:

1. Open http://127.0.0.1:3000
2. Run **test 1** (uncaught browser exception).
3. In Sentry project `sentry-poc-next`, open the Issue.

Expected result:

- Stack frames point at original TypeScript / React source (`app/dashboard.tsx` or related files), not only a minified chunk.
- Filename is meaningful.
- Line / column are usable.
- The event is tagged with `release=sentry-poc@1.0.0` and `environment=poc`.

`withSentryConfig` is configured with `widenClientFileUpload` and `sourcemaps.deleteSourcemapsAfterUpload` so private maps are uploaded to Sentry and not left next to public assets.

## 7. Manual validation matrix

Open the dashboard and click each card. Fill Pass/Fail yourself after inspecting Sentry.

| Test | Expected Sentry result | Pass/Fail |
| --- | --- | --- |
| 1 Uncaught browser exception | Issue in `sentry-poc-next`, browser runtime, `environment=poc` |  |
| 2 Unhandled Promise rejection | Issue in `sentry-poc-next` for the rejection |  |
| 3 React render error | Issue from `error.tsx` / `global-error.tsx` (`captureException`) |  |
| 4 Error boundary | Issue from explicit `captureException` in `ReportErrorBoundary` |  |
| 5 Browser warning log | Log in `sentry-poc-next` Logs; linked to the page trace if supported |  |
| 6 Next.js uncaught server exception | Issue in `sentry-poc-next` via `onRequestError` |  |
| 7 Next.js caught + captureException | Issue from explicit capture; HTTP 200 from the route |  |
| 8 Next.js server log | Log in `sentry-poc-next` with `test_case=next-server-log` |  |
| 9 Python Direct success | One trace: Browser → Next.js → Python Direct |  |
| 10 Python Direct error | Same trace shape; Issue in `sentry-poc-python-direct` |  |
| 11 Spring → Downstream success | One trace: Browser → Next.js → Spring → Python Downstream |  |
| 12 Error at Python Downstream | Trace includes Spring HTTP span + Python error Issue |  |
| 13 Error inside Spring | Issue in `sentry-poc-spring`; Python Downstream not required |  |
| 14 Slow request | Python Direct span ≈ 3s |  |
| 15 Timeout path | Next.js 504 / abort; error or failed span on the Next.js side |  |
| G1 Same error ×3 | **One** Issue, multiple events |  |
| G2 Different error | A **separate** Issue |  |
| M1 Metrics | `poc.request.count` / `duration` / `queue.depth` in Metrics |  |
| U1 Uptime ok | HTTP 200; trace includes Spring + Python Downstream |  |

## 8. Expected Sentry UI result for every test

Use **Issues**, **Explore → Traces**, **Logs**, and **Metrics**. Filter `environment:poc` and `release:sentry-poc@1.0.0`.

- **Browser errors (1–4):** Issues in `sentry-poc-next`. Culprit is a UI file. Test 4 should mention the boundary capture.
- **Browser log (5):** Logs product, not necessarily an Issue.
- **Server errors (6–7):** Node runtime, route `/api/server/*`.
- **Server log (8):** Logs with attributes `service`, `test_case`, `request_kind`.
- **Trace 9:** Three projects/services in one trace id. Python Direct response JSON echoes `sentry-trace` / `traceparent`.
- **Trace 10:** Same as 9 plus an error event on the Python Direct project.
- **Trace 11:** Four hops. Spring JSON includes `downstream.incoming_trace_headers`.
- **Trace 12:** Python Downstream Issue; Spring span for the failed HTTP call.
- **Trace 13:** Spring Issue `Uncaught Spring Boot exception for Sentry PoC`.
- **Slow (14):** Long Python span.
- **Timeout (15):** Next.js capture of the aborted fetch; Python may still complete if abort is late — check the Next.js span status.
- **Grouping:** G1 collapses; G2 does not share G1’s fingerprint.
- **Metrics:** Low-cardinality attributes only (`service`, `environment`, `test_case`, `request_kind`).
- **Uptime:** See section 15.

## 9. How to identify whether the same trace crosses projects

1. Run test 9 or 11.
2. Copy a `trace_id` from the dashboard payload (`active_span.trace_id`, `next_trace.activeSpan.traceId`, or `x-sentry-poc-trace-id` style fields).
3. In Sentry, open **Explore → Traces** (or an Issue → Trace) and paste the id.
4. A passing result shows **one trace id** with spans from multiple projects:
   - Test 9: `sentry-poc-next` + `sentry-poc-python-direct`
   - Test 11: `sentry-poc-next` + `sentry-poc-spring` + `sentry-poc-python-downstream`
5. If you only see the Next.js span, the outbound fetch hop broke. Inspect `outgoing_trace_headers` vs `incoming_trace_headers`. They should share the same 32-hex trace id.

Sentry still primarily propagates `sentry-trace` and `baggage`. This PoC also sets `propagateTraceparent: true` (JS) and `sentry.propagate-traceparent=true` (Java) so W3C `traceparent` is sent as well. Python continues incoming Sentry headers automatically via the FastAPI integration.

## 10. How to verify logs are correlated

1. Run tests 5, 8, Python Direct `/api/log` (dashboard test 8 plus a Python success/log via `/api/proxy/python-direct?mode=log` if you curl it), Spring test via `/api/proxy/spring?mode=log`.
2. Open **Logs**.
3. Filter `service:sentry-poc-next` (or spring / python service names) and `test_case:...`.
4. Open a log. Current SDKs attach `trace_id` when a span is active. Use **View Trace** / the trace id to jump to Traces.
5. If a log has no trace id, the SDK emitted it outside an active span — document that as a limitation rather than inventing a fake span.

Curl helpers:

```bash
curl -sS http://127.0.0.1:3000/api/server/log
curl -sS http://127.0.0.1:3000/api/proxy/python-direct?mode=log
curl -sS http://127.0.0.1:3000/api/proxy/spring?mode=log
```

## 11. How to verify source maps

See section 6. Confirm the Issue stack is original TS/React, not `app-*.js`. If stacks stay minified, the usual cause is a missing `SENTRY_AUTH_TOKEN` / wrong `SENTRY_ORG` at `next build` time.

## 12. How to verify Web Vitals

The current `@sentry/nextjs` browser SDK records Web Vitals on **real page loads and interactions**. This PoC does **not** fake LCP/INP/CLS/TTFB.

| Vital | How it appears | What you must do |
| --- | --- | --- |
| LCP | Measurement on the pageload transaction | Load `/` and wait for the largest paint (hero + cards). |
| TTFB | Measurement on pageload | Load `/`. |
| CLS | Measurement on pageload / window | Load `/`; avoid huge layout shifts. May be ~0. |
| INP | Requires a real interaction | Click several **Run test** buttons, then wait; INP is sent after interaction (and may wait until idle/hidden). |

In Sentry: open a `pageload` transaction for `/` in `sentry-poc-next` and inspect Measurements. If INP is missing, you have not interacted enough — that is expected, not a product failure.

## 13. How to verify metrics

Run dashboard **M1** (and any other tests). In Sentry **Metrics** look for:

- `poc.request.count`
- `poc.failure.count` (error tests)
- `poc.request.duration`
- `poc.queue.depth`

Filter by `service` / `test_case`. Volume is intentionally tiny.

## 14. How to verify issue grouping

1. Run **G1** once. It hits `/api/server/grouping-same` three times with the same `Error("sentry-poc grouping: identical boom")`.
2. Confirm one Issue with 3 events (or 3 + retries).
3. Run **G2** (`TypeError("sentry-poc grouping: different type")`).
4. Confirm a second Issue.

You can repeat G1 from Python/Spring with `/api/grouping-same` if you want backend grouping too.

## 15. Later Uptime test

`GET http://127.0.0.1:8080/api/uptime-test` is the single URL meant for a Sentry Developer-plan Uptime monitor.

| URL | Behavior |
| --- | --- |
| `/api/uptime-test` | HTTP 200, calls Python Downstream `/api/success`, produces a distributed trace |
| `/api/uptime-test?mode=error` | Calls downstream, then throws — Sentry Issue + trace |
| `/api/uptime-test?mode=slow` | Calls downstream, sleeps ~4s, HTTP 200 |
| `SENTRY_POC_UPTIME_MODE=error` | Same as `mode=error` without changing the URL |

This PoC does **not** create the Uptime monitor. In Sentry later: **Alerts → Uptime** (or the current Uptime UI), URL `http://<public-host>:8080/api/uptime-test`. Developer-plan quota is one uptime monitor — use this endpoint only.

The URL must be reachable from Sentry’s probes (a public tunnel, not `127.0.0.1`).

## 16. Later Email alert validation

Not configured here (no alert rules are created by this repo).

Later, in Sentry:

1. **Settings → Projects → sentry-poc-next (or spring) → Alerts**
2. Create an issue alert: environment `poc`, action Email.
3. Trigger test 1 or 13.
4. Confirm the mail arrives and links to the Issue / Trace.

## 17. Later Sentry MCP validation

Not configured here (no OAuth client is created by this repo).

Later:

1. Enable the Sentry MCP server against this org.
2. Ask it for recent issues in `sentry-poc-next` after clicking dashboard tests.
3. Confirm it can resolve the same trace id you copied from the dashboard.

## 18. Known limitations

Filled from implementation against current official SDKs. Update the Pass/Fail column as you run the matrix.

- **Source maps** require a user-created `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`. The app runs without them.
- **Uptime, email alerts, and Sentry MCP** need user-side configuration. The repo only provides the application hooks.
- **Session Replay and Profiling are disabled** on purpose.
- **W3C `traceparent` on the Next.js outbound hop:** `@sentry/nextjs` 10.75.0 with `propagateTraceparent: true` still did **not** attach `traceparent` on Node `fetch`. `Sentry.getTraceData()` returns only `sentry-trace` and `baggage`. Sentry correlation still worked because those headers continued the same trace id into Spring and Python Direct. Java `sentry.propagate-traceparent=true` **did** attach W3C `traceparent` on Spring → Python Downstream automatically. `web-next/lib/outbound-fetch.ts` therefore derives `traceparent` from the SDK `sentry-trace` value (same mapping the JS SDK documents) and reports `w3c_traceparent_source` in the JSON so this is inspectable, not hidden.
- **Sentry native tracing** uses `sentry-trace` + `baggage`. That path is intact: Next.js, Spring, and Python Downstream all shared one 32-hex trace id in local verification.
- **Next.js outbound fetch** is the historically fragile boundary. This PoC merges official `Sentry.getTraceData()` onto `fetch` and disables fetch caching (`cache: 'no-store'`). If headers are still missing in `incoming_trace_headers`, treat that as a real platform limitation — do not paper over it with a custom propagator.
- **Health traces** are dropped in Python via `traces_sampler`. Spring/Next health requests may still produce traces at sample rate 1.0.
- **Web Vitals** are not present until a real browser session; they will not appear from `curl`.
- **Developer-plan quotas** are small. Clicking every dashboard button a few times is in-scope; a load test is not.
- OpenTelemetry is **not** added. Spring Boot Sentry docs mention an optional OpenTelemetry agent; this PoC uses native Sentry Spring Boot 4 instrumentation and `RestClient.Builder` so `SentrySpanRestClientCustomizer` can run.

## 19. Approximate Developer-plan usage

A full manual pass (each dashboard button once, G1 three events, one production page load) is roughly:

| Signal | Ballpark |
| --- | --- |
| Error events | ~15–30 (including grouping repeats) |
| Transactions / spans | tens to low hundreds at `tracesSampleRate=1.0` |
| Logs | ~10 structured logs |
| Metrics | a few dozen data points |
| Replays / profiles | 0 |
| Attachments / source maps | 1 release upload when the token is set |

Stay well under typical Developer-plan error/transaction allowances if you do not loop the dashboard or scrape `/health` with tracing enabled on Spring/Next.

---

## Automated tests

These check boot/routing locally. They are not a substitute for the Sentry UI matrix.

```bash
backend-python-direct/.venv/bin/pytest backend-python-direct
backend-python-downstream/.venv/bin/pytest backend-python-downstream
mvn -f backend-spring/pom.xml test
./scripts/start-all.sh && ./scripts/smoke-test.sh
```

Smoke tests verify health, success routes, inter-service calls, and designed error status codes.

## Project layout

```
├── web-next/                     Next.js 16 App Router dashboard
├── backend-spring/               Spring Boot 4 + RestClient
├── backend-python-direct/        FastAPI
├── backend-python-downstream/    FastAPI
├── scripts/start-all.sh
├── scripts/stop-all.sh
├── scripts/smoke-test.sh
├── docker-compose.yml            optional
├── .env.example
└── README.md
```
