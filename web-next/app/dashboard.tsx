"use client";

import { useMemo, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { BoomOnRender, BoundaryBoomOnRender, ReportErrorBoundary } from "./error-demos";

type RunState = {
  testId: string;
  label: string;
  status: "idle" | "running" | "ok" | "error";
  httpStatus?: number;
  body?: unknown;
  error?: string;
};

type TestDef = {
  id: string;
  label: string;
  detail: string;
  kind: "client" | "http";
  path?: string;
  clientAction?: "throw" | "reject" | "render" | "boundary" | "log";
};

const TESTS: TestDef[] = [
  {
    id: "1",
    label: "Synchronous uncaught browser exception",
    detail:
      "Throws synchronously in the button click handler. This is NOT a rejected Promise.",
    kind: "client",
    clientAction: "throw",
  },
  {
    id: "2",
    label: "Unhandled Promise rejection",
    detail: "Rejects a Promise with no catch. Separate from test 1.",
    kind: "client",
    clientAction: "reject",
  },
  {
    id: "3",
    label: "React render error",
    detail: "Throws during render outside the inner boundary (error.tsx / global-error).",
    kind: "client",
    clientAction: "render",
  },
  {
    id: "4",
    label: "Error boundary + explicit capture",
    detail: "Throws during render inside ReportErrorBoundary, which calls captureException.",
    kind: "client",
    clientAction: "boundary",
  },
  {
    id: "5",
    label: "Browser warning log",
    detail: "Sentry.logger.warn from the browser (explicit Sentry logger, not console.warn).",
    kind: "client",
    clientAction: "log",
  },
  {
    id: "6",
    label: "Next.js uncaught server exception",
    detail: "Route handler throws. Captured via instrumentation onRequestError.",
    kind: "http",
    path: "/api/server/uncaught",
  },
  {
    id: "7",
    label: "Next.js caught + captureException",
    detail: "Route handler catches and reports explicitly.",
    kind: "http",
    path: "/api/server/caught",
  },
  {
    id: "8",
    label: "Next.js server log",
    detail: "Explicit Sentry.logger on the server (log_channel=sentry.logger).",
    kind: "http",
    path: "/api/server/log",
  },
  {
    id: "9",
    label: "Python Direct success",
    detail: "Browser → Next.js → Python Direct. Inspect parent_span_id, not only trace_id.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=success",
  },
  {
    id: "10",
    label: "Python Direct error",
    detail: "Same path, Python raises. Issue in python-direct.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=error",
  },
  {
    id: "11",
    label: "Spring → Python Downstream success",
    detail: "Browser → Next.js → Spring → Python Downstream. Inspect both hops' parent_span_id.",
    kind: "http",
    path: "/api/proxy/spring?mode=downstream-success",
  },
  {
    id: "12",
    label: "Error at Python Downstream",
    detail: "Four-service path, failure originates in Python Downstream.",
    kind: "http",
    path: "/api/proxy/spring?mode=downstream-error",
  },
  {
    id: "13",
    label: "Error inside Spring",
    detail: "Spring throws before calling downstream.",
    kind: "http",
    path: "/api/proxy/spring?mode=error",
  },
  {
    id: "14",
    label: "Slow request",
    detail: "Python Direct sleeps 3s. Trace should show the delay.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=slow",
  },
  {
    id: "15",
    label: "Timeout path",
    detail: "Next.js aborts a 5s Python Direct call after 1.5s.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=timeout",
  },
  {
    id: "L1",
    label: "Python Direct logs",
    detail: "stdlib logging + sentry_sdk.logger on Python Direct, via Next.js proxy.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=log",
  },
  {
    id: "L2",
    label: "Spring logs",
    detail: "SLF4J/Logback AND Sentry.logger(). Do not treat one as proof of the other.",
    kind: "http",
    path: "/api/proxy/spring?mode=log",
  },
  {
    id: "L3",
    label: "Python Downstream logs",
    detail: "Spring RestClient → Python Downstream /api/log (real downstream log correlation).",
    kind: "http",
    path: "/api/proxy/spring?mode=downstream-log",
  },
  {
    id: "G1",
    label: "Grouping: same error ×3",
    detail: "Fire the identical server exception three times. Expect one Issue, multiple events.",
    kind: "http",
    path: "/api/server/grouping-same",
  },
  {
    id: "G2",
    label: "Grouping: different error",
    detail: "A TypeError with a different message. Expect a separate Issue.",
    kind: "http",
    path: "/api/server/grouping-different",
  },
  {
    id: "M1",
    label: "Custom metrics (all services)",
    detail: "Emit poc.request.* from Next.js, Spring, and Python. queue.depth is synthetic.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=metric",
  },
  {
    id: "U1",
    label: "Uptime endpoint (ok)",
    detail: "Spring /api/uptime-test → Python Downstream → 200, with structured business log.",
    kind: "http",
    path: "/api/proxy/spring?mode=uptime",
  },
  {
    id: "U2",
    label: "Uptime endpoint (error)",
    detail: "Calls Python Downstream, then Spring throws. Sentry Issue + trace.",
    kind: "http",
    path: "/api/proxy/spring?mode=uptime-error",
  },
  {
    id: "U3",
    label: "Uptime endpoint (slow)",
    detail: "Obvious delay after downstream call. Does NOT by itself prove an Uptime monitor failure.",
    kind: "http",
    path: "/api/proxy/spring?mode=uptime-slow",
  },
];

function extractTraceIds(body: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof nested === "string" &&
        (key.includes("trace") ||
          key === "traceId" ||
          key === "trace_id" ||
          key === "span_id" ||
          key === "parent_span_id" ||
          key === "spanId") &&
        nested.length >= 8
      ) {
        found.add(`${key}: ${nested}`);
      } else {
        visit(nested);
      }
    }
  };
  visit(body);
  return [...found];
}

const RELEASE = process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? "(unset — git SHA at runtime)";
const ENVIRONMENT = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "poc";

export function Dashboard() {
  const [current, setCurrent] = useState<RunState | null>(null);
  const [history, setHistory] = useState<RunState[]>([]);
  const [renderBoom, setRenderBoom] = useState(false);
  const [boundaryBoom, setBoundaryBoom] = useState(false);

  const groups = useMemo(
    () => [
      { title: "Browser / frontend", ids: ["1", "2", "3", "4", "5"] },
      { title: "Next.js server", ids: ["6", "7", "8"] },
      { title: "Distributed tracing", ids: ["9", "10", "11", "12", "13", "14", "15"] },
      { title: "Logs", ids: ["L1", "L2", "L3"] },
      { title: "Grouping, metrics, uptime", ids: ["G1", "G2", "M1", "U1", "U2", "U3"] },
    ],
    [],
  );

  function handleClick(test: TestDef) {
    Sentry.getCurrentScope().setTag("test_case", test.id);
    Sentry.setAttribute("test_case", test.id);

    if (test.clientAction === "throw") {
      setCurrent({
        testId: test.id,
        label: test.label,
        status: "error",
        error:
          "Synchronous uncaught exception thrown in the click handler. This is not a Promise rejection.",
      });
      throw new Error("Synchronous uncaught browser exception for Sentry PoC");
    }

    void run(test);
  }

  async function run(test: TestDef) {
    if (test.kind === "client") {
      if (test.clientAction === "reject") {
        setCurrent({
          testId: test.id,
          label: test.label,
          status: "error",
          error: "Unhandled Promise rejection fired. Inspect sentry-poc-next-2 Issues.",
        });
        void Promise.reject(new Error("Unhandled browser Promise rejection for Sentry PoC"));
        return;
      }
      if (test.clientAction === "render") {
        setRenderBoom(true);
        return;
      }
      if (test.clientAction === "boundary") {
        setBoundaryBoom(true);
        setCurrent({
          testId: test.id,
          label: test.label,
          status: "ok",
          body: "Render error captured by the inner Error Boundary and sent with captureException.",
        });
        return;
      }
      if (test.clientAction === "log") {
        Sentry.logger.warn("Browser structured warning log for Sentry PoC", {
          service: "sentry-poc-next",
          environment: ENVIRONMENT,
          test_case: "browser-log",
          request_kind: "log",
          log_channel: "sentry.logger",
        });
        Sentry.metrics.count("poc.request.count", 1, {
          attributes: {
            service: "sentry-poc-next",
            test_case: "browser-log",
            request_kind: "log",
          },
        });
        setCurrent({
          testId: test.id,
          label: test.label,
          status: "ok",
          body: "Sentry.logger.warn sent from the browser (explicit Sentry logger). Check Logs in sentry-poc-next-2.",
        });
        return;
      }
    }

    setCurrent({ testId: test.id, label: test.label, status: "running" });
    const times = test.id === "G1" ? 3 : 1;
    let last: RunState | null = null;
    for (let i = 0; i < times; i += 1) {
      last = await runHttp(test);
    }
    if (last) {
      setCurrent(last);
      setHistory((prev) => [last, ...prev].slice(0, 8));
    }

    if (test.id === "M1") {
      await fetch("/api/proxy/spring?mode=metric", { cache: "no-store" });
      await fetch("/api/health", { cache: "no-store" });
    }
  }

  async function runHttp(test: TestDef): Promise<RunState> {
    try {
      const response = await fetch(test.path!, { cache: "no-store" });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep text */
      }
      const state: RunState = {
        testId: test.id,
        label: test.label,
        status: response.ok ? "ok" : "error",
        httpStatus: response.status,
        body,
      };
      return state;
    } catch (error) {
      return {
        testId: test.id,
        label: test.label,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const traceIds = current ? extractTraceIds(current.body) : [];

  return (
    <div className="shell">
      {renderBoom ? <BoomOnRender armed /> : null}
      <header className="hero">
        <p className="eyebrow">Developer-plan observability PoC</p>
        <h1>Sentry lab console</h1>
        <p className="lede">
          Trigger each case from the browser. The two paths that must appear as coherent
          distributed traces are{" "}
          <code>Browser → Next.js → Python Direct</code> and{" "}
          <code>Browser → Next.js → Spring Boot → Python Downstream</code>. Same{" "}
          <code>trace_id</code> is not enough — inspect <code>parent_span_id</code>.
        </p>
        <ul className="meta">
          <li>environment = {ENVIRONMENT}</li>
          <li>release = {RELEASE}</li>
          <li>Replay off · Profiling off</li>
        </ul>
      </header>

      <section className="status-panel" aria-live="polite">
        <h2>Current run</h2>
        {!current ? (
          <p className="muted">No test executed yet.</p>
        ) : (
          <>
            <p>
              <strong>{current.testId}.</strong> {current.label}
            </p>
            <p>
              Status:{" "}
              <span className={`pill ${current.status}`}>
                {current.status}
                {current.httpStatus ? ` · HTTP ${current.httpStatus}` : ""}
              </span>
            </p>
            {current.error ? <p className="error-text">{current.error}</p> : null}
            {traceIds.length > 0 ? (
              <div>
                <p className="muted">Trace / span identifiers found in the response</p>
                <ul className="trace-list">
                  {traceIds.map((item) => (
                    <li key={item}>
                      <code>{item}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {current.body !== undefined ? (
              <pre className="payload">{JSON.stringify(current.body, null, 2)}</pre>
            ) : null}
          </>
        )}
      </section>

      <section className="boundary-demo">
        <h2>Contained React error boundary</h2>
        <ReportErrorBoundary
          onCaptured={(error) => {
            setCurrent({
              testId: "4",
              label: "Error boundary + explicit capture",
              status: "ok",
              body: { captured: true, message: error.message },
            });
            setBoundaryBoom(false);
          }}
        >
          <BoundaryBoomOnRender armed={boundaryBoom} />
          <p className="muted">
            Test 4 renders inside this box so the rest of the dashboard stays usable.
          </p>
        </ReportErrorBoundary>
      </section>

      {groups.map((group) => (
        <section key={group.title} className="group">
          <h2>{group.title}</h2>
          <div className="grid">
            {group.ids.map((id) => {
              const test = TESTS.find((item) => item.id === id)!;
              const active = current?.testId === test.id;
              return (
                <article key={test.id} className={`card ${active ? "active" : ""}`}>
                  <p className="card-id">{test.id}</p>
                  <h3>{test.label}</h3>
                  <p>{test.detail}</p>
                  <button type="button" onClick={() => handleClick(test)} disabled={current?.status === "running"}>
                    Run test
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {history.length > 0 ? (
        <section>
          <h2>Recent results</h2>
          <ul className="history">
            {history.map((item, index) => (
              <li key={`${item.testId}-${index}`}>
                <span className={`pill ${item.status}`}>{item.status}</span> {item.testId}. {item.label}
                {item.httpStatus ? ` · ${item.httpStatus}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
