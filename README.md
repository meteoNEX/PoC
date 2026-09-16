# Sentry SaaS Developer-plan observability PoC

This repository is a small, runnable architecture used to **validate whether Sentry can be the main application-observability platform** for a real frontend-plus-multi-backend system.

The goal is not merely “an event arrived in Sentry”. The goal is to see whether these two paths appear as **coherent distributed traces** with correct **parent-child span relationships** across service and language boundaries:

```
Browser → Next.js → Python Direct
Browser → Next.js → Spring Boot → Python Downstream
```

**Same `trace_id` is not sufficient proof** that distributed tracing is correct. This PoC verifies `trace_id`, `span_id`, `parent_span_id`, HTTP client spans, and downstream server spans.

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
                             │                  │ native instrumented fetch
                             │                  │ (no pre-fetch header injection)
                             ▼                  ▼
              ┌──────────────────────┐   ┌──────────────────────┐
              │ Python Direct        │   │ Spring Boot          │
              │ :8001                │   │ :8080                │
              │ sentry-poc-python-   │   │ sentry-poc-spring    │
              │ direct               │   └──────────┬───────────┘
              └──────────────────────┘              │ RestClient
                                                    │ (Sentry native)
                                                    ▼
                                         ┌──────────────────────┐
                                         │ Python Downstream    │
                                         │ :8002                │
                                         │ sentry-poc-python-   │
                                         │ downstream           │
                                         └──────────────────────┘
```

CORS is not configured on the backends: the browser only talks to Next.js. Next.js and Spring make server-side HTTP calls.

Four Sentry projects:

| Path | Projects involved |
| --- | --- |
| Browser → Next.js → Python Direct | `sentry-poc-next`, `sentry-poc-python-direct` (**two** projects) |
| Browser → Next.js → Spring → Python Downstream | `sentry-poc-next`, `sentry-poc-spring`, `sentry-poc-python-downstream` (**three** projects) |

The inspectable Next.js outbound hop lives in `web-next/lib/outbound-fetch.ts`. It uses **native `fetch` only**. It does **not** call `Sentry.getTraceData()` and does **not** set `sentry-trace`, `baggage`, or `traceparent` before `fetch()`. The source of truth for what was actually sent is downstream `incoming_trace_headers`.

`Sentry.getTraceData()` and `Sentry.getTraceData({ propagateTraceparent: true })` are exposed on a **diagnostic-only** route (`/api/server/traceparent-helper-snapshot`). That helper is **not** a core hop and is **not** copied onto outbound requests.

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
| `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | all | default `poc` |
| `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE` | all | `sentry-poc@<git SHA>` via `scripts/release-id.sh` / `start-all.sh` |
| `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | all | **PoC-only** default `1.0` in **both** `.env.example` **and code fallbacks** |
| `PYTHON_DIRECT_BASE_URL` | Next.js server | Outbound to Python Direct (`localhost` or Docker DNS `python-direct`) |
| `SPRING_BASE_URL` | Next.js server | Outbound to Spring (`localhost` or Docker DNS `spring`) |
| `SENTRY_POC_DOWNSTREAM_BASE_URL` | Spring | Outbound to Python Downstream |
| `SENTRY_POC_UPTIME_MODE` | Spring | Optional default for `/api/uptime-test` |
| `SENTRY_ORG` | Next.js production build | Org slug for source map upload |
| `SENTRY_PROJECT` | Next.js production build | `sentry-poc-next` |
| `SENTRY_AUTH_TOKEN` | Next.js production build | **Secret.** Never commit. |

Do not commit Sentry auth tokens, API tokens, or GitHub tokens.

### Source-map token

Create the token in Sentry:

1. Open **Settings → Auth Tokens → Create New Token** (organization auth token).
2. Grant scopes needed for release/source-map upload (commonly `project:releases` and `org:read`; follow the token wizard if Sentry shows a recommended set).
3. Export `SENTRY_AUTH_TOKEN` in your shell for `next build`. Do not commit it.
4. Set `SENTRY_ORG` to your organization slug (not the numeric org id in the DSN).

The Next.js production build still succeeds without this token. Source maps simply are not uploaded.

If `SENTRY_AUTH_TOKEN` **is** set but invalid, `next build` **fails** (HTTP 401). That is intentional so a bad token cannot be mistaken for a successful upload.

### Sampling (read this)

`SENTRY_TRACES_SAMPLE_RATE=1.0` exists in `.env.example` **and** as a code fallback (`"1"` / `"1.0"`) in Next.js, Python, and Spring. It is isolated for PoC reliability. **Production must not copy this.** Use a low rate or a `tracesSampler`.

Python `traces_sampler`:

1. Always returns `0` for `/health` (even if the parent was sampled).
2. Otherwise inherits `parent_sampled` from the incoming trace.
3. Otherwise uses `SENTRY_TRACES_SAMPLE_RATE` (PoC default `1.0`).

This matters as soon as production rates become `0.1` / `0.05` / `0.01`. Without inheriting `parent_sampled`, a sampled Next.js/Spring span can be continued by an unsampled Python transaction and the distributed trace breaks.

Health endpoints are unsampled in the Python services. Spring/Next health requests may still produce traces at sample rate 1.0.

Replay and profiling stay off.

## 4. Setup

Prerequisites: Node 20.9+, Python 3.12 (`python3-venv` on Debian/Ubuntu), Java 21, Maven 3.6.3+ (for Spring).

```bash
cp .env.example .env
# export SENTRY_ORG later when you are ready to upload source maps

python3 -m venv backend-python-direct/.venv
backend-python-direct/.venv/bin/pip install -r backend-python-direct/requirements.txt

python3 -m venv backend-python-downstream/.venv
backend-python-downstream/.venv/bin/pip install -r backend-python-downstream/requirements.txt

cd web-next && npm install && cd ..
```

`./scripts/start-all.sh` performs the same setup if venvs / `node_modules` are missing. It also sets `SENTRY_RELEASE=sentry-poc@<git SHA>`.

## 5. Run

Preferred local workflow (native processes, not Docker):

```bash
chmod +x scripts/*.sh scripts/*.py dev.sh
./scripts/start-all.sh
# dashboard: http://127.0.0.1:3000
./scripts/smoke-test.sh
./scripts/stop-all.sh
```

Run services individually:

```bash
export SENTRY_RELEASE="sentry-poc@$(git rev-parse HEAD)"
export NEXT_PUBLIC_SENTRY_RELEASE="$SENTRY_RELEASE"

backend-python-direct/.venv/bin/uvicorn app:app --app-dir backend-python-direct --port 8001
backend-python-downstream/.venv/bin/uvicorn app:app --app-dir backend-python-downstream --port 8002
mvn -f backend-spring/pom.xml spring-boot:run
cp .env web-next/.env.local
npm --prefix web-next run dev
```

Docker is optional and only wraps these four apps. Compose uses Docker DNS names (`python-direct`, `spring`, `python-downstream`), which are included in Next.js `tracePropagationTargets`.

```bash
docker compose up --build
```

There is no PostgreSQL, Redis, Kafka, ClickHouse, or OpenTelemetry Collector.

## 6. Production Next.js build / source-map test

Without an auth token (build must still succeed):

```bash
export SENTRY_RELEASE="sentry-poc@$(git rev-parse HEAD)"
export NEXT_PUBLIC_SENTRY_RELEASE="$SENTRY_RELEASE"
cp .env web-next/.env.local
npm --prefix web-next run build
npm --prefix web-next run start
```

With source-map upload (after creating `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`):

```bash
export SENTRY_ORG=<org slug>
export SENTRY_PROJECT=sentry-poc-next
export SENTRY_AUTH_TOKEN=...   # shell only, never commit
export SENTRY_RELEASE="sentry-poc@$(git rev-parse HEAD)"
export NEXT_PUBLIC_SENTRY_RELEASE="$SENTRY_RELEASE"
npm --prefix web-next run build   # uploads maps, then deletes client maps from the output
npm --prefix web-next run start
```

Then **user-side Sentry UI confirmation**:

1. Open the production dashboard.
2. Run **test 1** (synchronous uncaught browser exception).
3. In Sentry project `sentry-poc-next`, open the Issue.
4. Confirm the stack shows original `.tsx` / `.ts` files (for example `app/dashboard.tsx`), not only a minified chunk.
5. Confirm line / column are usable.
6. Confirm the event `release` matches `sentry-poc@<git SHA>` and `environment=poc`.

`withSentryConfig` is configured with `widenClientFileUpload` and `sourcemaps.deleteSourcemapsAfterUpload` so private maps are uploaded to Sentry and not left next to public assets.

Upload success in the build log is **not** the same as UI symbolication. Treat UI confirmation as **Requires Sentry SaaS verification**.

## 7. Manual validation matrix

Open the dashboard and click each card. Fill Pass/Fail after inspecting Sentry. Column **How confirmed** is the evidence class.

| Test | Expected Sentry result | How confirmed | Pass/Fail |
| --- | --- | --- | --- |
| 1 Synchronous uncaught browser exception | Issue in `sentry-poc-next`, browser runtime | Requires Sentry SaaS verification |  |
| 2 Unhandled Promise rejection | Separate Issue for the rejection | Requires Sentry SaaS verification |  |
| 3 React render error | Issue from `error.tsx` / `global-error.tsx` | Requires Sentry SaaS verification |  |
| 4 Error boundary | Issue from explicit `captureException` | Requires Sentry SaaS verification |  |
| 5 Browser warning log | Log in `sentry-poc-next` Logs (`log_channel=sentry.logger`) | Requires Sentry SaaS verification |  |
| 6 Next.js uncaught server exception | Issue via `onRequestError` | Local runtime status 500 + SaaS Issue |  |
| 7 Next.js caught + captureException | Issue from explicit capture; HTTP 200 | Local runtime + SaaS Issue |  |
| 8 Next.js server log | Log with `log_channel=sentry.logger` | Local runtime + SaaS Logs |  |
| 9 Python Direct success | Two projects, HTTP client span parents Python server span | Automated hierarchy + SaaS trace tree |  |
| 10 Python Direct error | Same shape; Issue in python-direct | Local 500 + SaaS Issue |  |
| 11 Spring → Downstream success | Three projects; both hops parent-child | Automated hierarchy + SaaS trace tree |  |
| 12 Error at Python Downstream | Python Downstream Issue; Spring HTTP span | Local 500 + SaaS |  |
| 13 Error inside Spring | Issue in `sentry-poc-spring` | Local 500 + SaaS |  |
| 14 Slow request | Python Direct span ≈ 3s | Local runtime + SaaS |  |
| 15 Timeout path | Next.js 504 / abort | Local runtime + SaaS |  |
| L1 Python Direct logs | stdlib + `sentry_sdk.logger` | Local runtime + SaaS Logs |  |
| L2 Spring logs | SLF4J **and** `Sentry.logger()` are distinct | Local runtime + SaaS Logs |  |
| L3 Python Downstream logs | Spring → Python `/api/log` | Local runtime + SaaS Logs |  |
| G1 Same error ×3 | **One** Issue, multiple events | Requires Sentry SaaS verification |  |
| G2 Different error | A **separate** Issue | Requires Sentry SaaS verification |  |
| M1 Metrics | `poc.request.count` / elapsed `duration` / synthetic `queue.depth` | Requires Sentry SaaS verification |  |
| U1 Uptime ok | HTTP 200; Spring + Python Downstream spans + structured log | Local runtime + SaaS |  |
| U2 Uptime error | Downstream called, then Spring throws | Local 500 + SaaS Issue |  |
| U3 Uptime slow | Obvious delay; **does not prove** Uptime monitor failure | Local runtime |  |

## 8. Expected Sentry UI result for every test

Use **Issues**, **Explore → Traces**, **Logs**, and **Metrics**. Filter `environment:poc` and the current `release` (`sentry-poc@<git SHA>`).

- **Browser errors (1–4):** Issues in `sentry-poc-next`. Test 1 is a **synchronous** click-handler throw. Test 2 is a **Promise rejection**. They must not be the same mechanism.
- **Browser log (5):** Logs product via `Sentry.logger`, not `console.warn`.
- **Server errors (6–7):** Node runtime, route `/api/server/*`.
- **Server log (8):** Explicit `Sentry.logger` with attributes `service`, `test_case`, `request_kind`, `log_channel`.
- **Trace 9:** **Two** projects (`sentry-poc-next` + `sentry-poc-python-direct`). Expected abstract tree:
  - Browser transaction / browser span
  - → Next.js server span
  - → Next.js HTTP client span (`http.client`)
  - → Python Direct server span (`parent_span_id` = HTTP client span id)
- **Trace 11:** **Three** projects. Expected abstract tree:
  - Browser transaction / browser span
  - → Next.js server span
  - → Next.js HTTP client span
  - → Spring server span
  - → Spring HTTP client span
  - → Python Downstream server span
- If the current Browser SDK models pageload vs fetch slightly differently, record the actual tree, but the HTTP client span **must** be the parent of the downstream server span (or the SDK’s documented equivalent).
- **Logs L1–L3:** See section 10. Framework logging ≠ explicit Sentry logger.
- **Metrics:** `poc.request.duration` is elapsed wall time. `poc.queue.depth` is a **synthetic gauge example** — there is no real queue.
- **Uptime:** See section 15. Do not claim a 4s delay always fails a Sentry Uptime monitor.

## 9. How to identify whether the same trace crosses projects

1. Run test 9 or 11.
2. Copy identifiers from the dashboard payload: `active_span.trace_id`, `active_span.span_id`, `active_span.parent_span_id`, `span_hierarchy_local_evidence`.
3. In Sentry, open **Explore → Traces** (or an Issue → Trace) and paste the trace id.
4. A passing result shows **one trace id** with a **correct parent-child tree**, not merely the same id on sibling spans:
   - Test 9: `sentry-poc-next` + `sentry-poc-python-direct`
   - Test 11: `sentry-poc-next` + `sentry-poc-spring` + `sentry-poc-python-downstream`
5. Local evidence in the JSON:
   - `headers_injected_by_next_before_fetch` must be `false`
   - `incoming_trace_headers['sentry-trace']` span id must equal downstream `active_span.parent_span_id`
   - that span id must **differ** from the Next.js route `next_trace.activeSpan.spanId` (the HTTP client span is not the route span)
6. `scripts/assert-trace-hierarchy.py` (invoked by `smoke-test.sh`) checks those local relationships. The Sentry UI tree is still **Requires Sentry SaaS verification**.

### Native Next.js outbound fetch headers

Do **not** use a pre-fetch `Sentry.getTraceData()` snapshot as proof of wire headers.

`@sentry/nextjs` 10.75.0 Node instrumentation (`@sentry/node-core` `addTracePropagationHeadersToFetchRequest`) creates the HTTP client span, then calls `getTraceData({ propagateTraceparent })` using the **client option** `propagateTraceparent` (this PoC sets it `true`). If the URL matches `tracePropagationTargets`, native fetch may send:

- `sentry-trace`
- `baggage`
- `traceparent` (when `propagateTraceparent: true` and the helper returns it)

Default `Sentry.getTraceData()` **without** `{ propagateTraceparent: true }` often omits `traceparent`. That is a helper-API difference, not proof that native fetch omits `traceparent`.

What this process **actually sent** is recorded in:

- `downstream_body.incoming_trace_headers` (canonical)
- `observed_undici_headers` (best-effort undici `sendHeaders` diagnostic)

`tracePropagationTargets` includes `localhost`, `127.0.0.1`, `python-direct`, `spring`, `python-downstream`, and `/^\//` so native and Docker DNS hosts both propagate.

Spring → Python Downstream uses official Sentry RestClient instrumentation (`SentrySpanRestClientCustomizer`) with `sentry.propagate-traceparent=true`. No manual header injection.

## 10. How to verify logs are correlated

Distinguish channels:

| Service | Framework logging | Explicit Sentry logger |
| --- | --- | --- |
| Next.js | Next.js / `console` (not claimed as verified auto-ingest) | `Sentry.logger` (`log_channel=sentry.logger`) |
| Spring | SLF4J / Logback (`log_channel=slf4j`) | `Sentry.logger()` |
| Python | `logging.Logger` (`log_channel=stdlib`) | `sentry_sdk.logger` |

`Sentry.logger()` succeeding is **not** proof that ordinary Spring/Python logs are auto-collected into the Sentry Logs product. That auto-collection **Requires Sentry SaaS verification**.

```bash
curl -sS http://127.0.0.1:3000/api/server/log
curl -sS http://127.0.0.1:3000/api/proxy/python-direct?mode=log
curl -sS http://127.0.0.1:3000/api/proxy/spring?mode=log
curl -sS http://127.0.0.1:3000/api/proxy/spring?mode=downstream-log
```

Python Downstream logs are exercised by `mode=downstream-log` (Spring RestClient → `/api/log`), not only by hitting Python directly.

## 11. How to verify source maps

See section 6. Confirm the Issue stack is original TS/React, not `app-*.js`. If stacks stay minified, the usual cause is a missing `SENTRY_AUTH_TOKEN` / wrong `SENTRY_ORG` at `next build` time. UI symbolication **Requires Sentry SaaS verification**.

## 12. How to verify Web Vitals

The current `@sentry/nextjs` / `@sentry/browser` SDK records Web Vitals from **real page loads and interactions**. This PoC does **not** fake LCP/INP/CLS/TTFB.

`browserTracingIntegration()` auto-registers `webVitalsIntegration`.

| Vital | How the current SDK produces it | Where to look in Sentry |
| --- | --- | --- |
| LCP | Pageload span measurement (and optionally a standalone/streamed LCP span depending on span-streaming experiments). Produced on a real page load when the largest contentful paint happens. | `pageload` transaction measurements, and/or an LCP web-vital span |
| CLS | Same as LCP: pageload measurement unless standalone CLS spans are enabled. Needs layout shift on the page; may be ~0. | `pageload` measurements and/or a CLS web-vital span |
| TTFB | Navigation / pageload timing, not an interaction vital. Produced on load. | `pageload` measurements |
| INP | **Not** something you should expect only as a pageload measurement. Current SDK tracks INP via `startTrackingINP` / `trackInpAsSpan` and emits a **standalone web-vital span** with `op` like `ui.interaction.click` (or hover/drag/press) after a real interaction. `registerInpInteractionListener` caches the element. INP is sent after interaction (and may wait until idle/hidden). Missing INP on a `pageload` transaction does **not** mean “the user did not interact enough” as a complete explanation — look for **interaction / INP spans** as well. | Interaction web-vital spans (`ui.interaction.*`), not only pageload measurements |

Web Vitals will not appear from `curl`. They **Require a real browser session + Sentry SaaS verification**.

## 13. How to verify metrics

Run dashboard **M1** (and any other tests). In Sentry **Metrics** look for:

| Metric | What it is |
| --- | --- |
| `poc.request.count` | Real counter (1 per recorded request) |
| `poc.failure.count` | Real counter on failure paths |
| `poc.request.duration` | **Elapsed wall time** in milliseconds (`measurement=elapsed_wall_time`) |
| `poc.queue.depth` | **Synthetic gauge example.** There is no real message queue. Attribute `synthetic_example=true` / `note=no-real-queue`. |

Filter by `service` / `test_case`. Volume is intentionally tiny. Appearance in the Metrics product **Requires Sentry SaaS verification**.

## 14. How to verify issue grouping

1. Run **G1** once. It hits `/api/server/grouping-same` three times with the same `Error("sentry-poc grouping: identical boom")`.
2. Confirm one Issue with 3 events (or 3 + retries).
3. Run **G2** (`TypeError("sentry-poc grouping: different type")`).
4. Confirm a second Issue.

Grouping **Requires Sentry SaaS verification**.

## 15. Later Uptime test

`GET http://127.0.0.1:8080/api/uptime-test` is the single URL meant for a Sentry Developer-plan Uptime monitor.

| URL | Behavior |
| --- | --- |
| `/api/uptime-test` or `?mode=normal` | Calls Python Downstream `/api/success`, structured business log, HTTP 200, distributed trace |
| `/api/uptime-test?mode=error` | Calls Python Downstream first, then Spring throws — Sentry Issue + trace |
| `/api/uptime-test?mode=slow` | Calls downstream, sleeps ~4s, HTTP 200, structured log |
| `SENTRY_POC_UPTIME_MODE=error` | Same as `mode=error` without changing the URL |

The endpoint has:

- a Spring server span / trace
- a downstream Python span
- structured business logs (`SLF4J` + `Sentry.logger()`)
- an explicit error mode

This PoC does **not** create the Uptime monitor. In Sentry later: **Alerts → Uptime** (or the current Uptime UI), URL `http://<public-host>:8080/api/uptime-test`. Developer-plan quota is one uptime monitor — use this endpoint only.

The URL must be reachable from Sentry’s probes (a public tunnel, not `127.0.0.1`).

**A 4 second delay does not necessarily fail an Uptime check.** Failure depends on the monitor timeout configured in Sentry.

Uptime monitor creation **Requires user-side follow-up**.

## 16. Later Email alert validation

Not configured here (no alert rules are created by this repo). **Requires user-side follow-up.**

Later, in Sentry:

1. **Settings → Projects → sentry-poc-next (or spring) → Alerts**
2. Create an issue alert: environment `poc`, action Email.
3. Trigger test 1 or 13.
4. Confirm the mail arrives and links to the Issue / Trace.

## 17. Later Sentry MCP validation

Not configured here (no OAuth client is created by this repo). **Requires user-side follow-up.**

Later:

1. Enable the Sentry MCP server against this org.
2. Ask it for recent issues in `sentry-poc-next` after clicking dashboard tests.
3. Confirm it can resolve the same trace id you copied from the dashboard.

## 18. Known limitations

- **Source maps:** a valid `SENTRY_AUTH_TOKEN` is required for upload. An invalid token fails `next build` with HTTP 401 rather than silently succeeding. Original-source stack traces in the Issue UI **Require Sentry SaaS verification**.
- **Browser envelope transport:** `tunnelRoute` is **not** enabled. A `/sentry-tunnel` POST returned HTTP 403 on Next.js 16 in this environment and would have dropped browser envelopes. The browser SDK sends directly to the ingest DSN.
- **Sentry ingest from some networks:** envelope POSTs to `ingest.us.sentry.io` may return HTTP 403 (project security, WAF, or network policy). Local proof that an error was **thrown** is not the same as proof it was **accepted** by Sentry. Check the Issue UI.
- **Uptime monitor, email alerts, and Sentry MCP** need user-side configuration. The repo only provides application hooks.
- **Session Replay and Profiling are disabled** on purpose.
- **Native fetch vs `getTraceData()`:** these are different APIs. Default `getTraceData()` omitting `traceparent` does not mean native fetch omitted it. See section 9. There is **no** pre-fetch tracing-header workaround on the two core hops.
- **Response debug headers** (`x-sentry-poc-*`) are best-effort and may be missing if the response is committed or the request throws. They are **not** acceptance criteria.
- **Health traces** are dropped in Python via `traces_sampler`. Spring/Next health requests may still produce traces at sample rate 1.0.
- **Web Vitals** need a real browser session; they will not appear from `curl`.
- **`poc.queue.depth` is synthetic.** Do not treat it as a real queue metric.
- **Framework logs vs Sentry.logger:** explicit Sentry logger is implemented. Auto-ingest of SLF4J/stdlib logs into Sentry Logs **Requires Sentry SaaS verification**.
- **Developer-plan quotas** are small. Clicking every dashboard button a few times is in-scope; a load test is not.
- OpenTelemetry is **not** added. Spring uses native Sentry Spring Boot 4 instrumentation and `RestClient.Builder` so `SentrySpanRestClientCustomizer` can run.

## 19. Approximate Developer-plan usage

A full manual pass (each dashboard button once, G1 three events, one production page load) is roughly:

| Signal | Ballpark |
| --- | --- |
| Error events | ~15–30 (including grouping repeats) |
| Transactions / spans | tens to low hundreds at `tracesSampleRate=1.0` |
| Logs | ~10–20 structured logs |
| Metrics | a few dozen data points |
| Replays / profiles | 0 |
| Attachments / source maps | 1 release upload when the token is set |

Stay well under typical Developer-plan error/transaction allowances if you do not loop the dashboard or scrape `/health` with tracing enabled on Spring/Next.

---

## Automated tests vs Sentry SaaS

Automated tests check local routing, sampler inheritance, header echo, and **parent_span_id** relationships. They do **not** fake a Sentry backend.

```bash
backend-python-direct/.venv/bin/pytest backend-python-direct
backend-python-downstream/.venv/bin/pytest backend-python-downstream
mvn -f backend-spring/pom.xml test
npm --prefix web-next test
./scripts/start-all.sh && ./scripts/smoke-test.sh
```

| Check | Evidence class |
| --- | --- |
| HTTP status / routing | Automated tests |
| Python `parent_sampled` inheritance | Automated tests |
| Downstream echo of `sentry-trace` / `baggage` / `traceparent` | Automated + local runtime |
| `parent_span_id` equals incoming HTTP client span id | Automated smoke (`assert-trace-hierarchy.py`) + local runtime |
| Sentry UI span tree, Issues, Logs product, Metrics product, Web Vitals, grouping, source-map symbolication | **Requires Sentry SaaS verification** |

Smoke tests verify health, success routes, inter-service calls, designed error status codes, logs, metrics, uptime modes, and local span hierarchy.

## Project layout

```
├── web-next/                     Next.js 16 App Router dashboard
├── backend-spring/               Spring Boot 4 + RestClient
├── backend-python-direct/        FastAPI
├── backend-python-downstream/    FastAPI
├── scripts/start-all.sh
├── scripts/stop-all.sh
├── scripts/smoke-test.sh
├── scripts/assert-trace-hierarchy.py
├── scripts/release-id.sh
├── docker-compose.yml            optional
├── .env.example
└── README.md
```
