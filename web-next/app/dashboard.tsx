"use client";

import { useMemo, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import {
  BoomOnRender,
  BoundaryBoomOnRender,
  ReportErrorBoundary,
} from "./error-demos";

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
    label: "Uncaught browser exception",
    detail: "Throws in a click handler. Sentry browser SDK should open an Issue.",
    kind: "client",
    clientAction: "throw",
  },
  {
    id: "2",
    label: "Unhandled Promise rejection",
    detail: "Rejects a Promise with no catch. Browser SDK should capture it.",
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
    detail: "Sentry.logger.warn from the browser, correlated with the current page trace.",
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
    detail: "Structured server log on the active span.",
    kind: "http",
    path: "/api/server/log",
  },
  {
    id: "9",
    label: "Python Direct success",
    detail: "Browser → Next.js → Python Direct. Expect one distributed trace.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=success",
  },
  {
    id: "10",
    label: "Python Direct error",
    detail: "Same path, Python raises. Issue in python-direct, same trace id.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=error",
  },
  {
    id: "11",
    label: "Spring → Python Downstream success",
    detail: "Browser → Next.js → Spring → Python Downstream.",
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
    detail: "Emit poc.request.* metrics from Next.js, Spring, and Python Direct.",
    kind: "http",
    path: "/api/proxy/python-direct?mode=metric",
  },
  {
    id: "U1",
    label: "Uptime endpoint (ok)",
    detail: "Spring /api/uptime-test calls Python Downstream and returns 200.",
    kind: "http",
    path: "/api/proxy/spring?mode=uptime",
  },
];

function extractTraceIds(body: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof nested === "string" &&
        (key.includes("trace") || key === "traceId" || key === "trace_id") &&
        nested.length >= 16
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
      { title: "Grouping, metrics, uptime", ids: ["G1", "G2", "M1", "U1"] },
    ],
    [],
  );

  async function run(test: TestDef) {
    Sentry.getCurrentScope().setTag("test_case", test.id);
    Sentry.setAttribute("test_case", test.id);

    if (test.kind === "client") {
      if (test.clientAction === "throw") {
        setCurrent({
          testId: test.id,
          label: test.label,
          status: "error",
          error: "Uncaught exception thrown in the browser. Inspect sentry-poc-next Issues.",
        });
        throw new Error("Uncaught browser JavaScript exception for Sentry PoC");
      }
      if (test.clientAction === "reject") {
        setCurrent({
          testId: test.id,
          label: test.label,
          status: "error",
          error: "Unhandled Promise rejection fired. Inspect sentry-poc-next Issues.",
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
          environment: "poc",
          test_case: "browser-log",
          request_kind: "log",
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
          body: "Sentry.logger.warn sent from the browser. Check Logs in sentry-poc-next.",
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
          <code>Browser → Next.js → Spring Boot → Python Downstream</code>.
        </p>
        <ul className="meta">
          <li>environment = poc</li>
          <li>release = sentry-poc@1.0.0</li>
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
                <p className="muted">Trace identifiers found in the response</p>
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
                  <button type="button" onClick={() => void run(test)} disabled={current?.status === "running"}>
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
