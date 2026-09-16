import * as Sentry from "@sentry/nextjs";
import {
  browserIncomingTraceDebug,
  currentTraceDebug,
  hierarchyFromProxyBody,
  jsonHeadersFromResponse,
  recordRequestMetrics,
} from "@/lib/observability";
import { outboundFetch, springBaseUrl } from "@/lib/outbound-fetch";

export const dynamic = "force-dynamic";

const MODES: Record<string, { path: string; timeoutMs?: number }> = {
  success: { path: "/api/success" },
  error: { path: "/api/error" },
  "caught-error": { path: "/api/caught-error" },
  "downstream-success": { path: "/api/downstream-success" },
  "downstream-error": { path: "/api/downstream-error" },
  "downstream-slow": { path: "/api/downstream-slow" },
  "downstream-log": { path: "/api/downstream-log" },
  timeout: { path: "/api/downstream-timeout" },
  log: { path: "/api/log" },
  metric: { path: "/api/metric" },
  uptime: { path: "/api/uptime-test" },
  "uptime-error": { path: "/api/uptime-test?mode=error" },
  "uptime-slow": { path: "/api/uptime-test?mode=slow" },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "downstream-success";
  const spec = MODES[mode];
  if (!spec) {
    return Response.json({ ok: false, error: `Unknown mode: ${mode}` }, { status: 400 });
  }

  const testCase = `next-spring-${mode}`;
  Sentry.setAttribute("test_case", testCase);
  const started = Date.now();
  const target = `${springBaseUrl()}${spec.path}`;
  const controller = spec.timeoutMs ? new AbortController() : undefined;
  const timer =
    spec.timeoutMs && controller ? setTimeout(() => controller.abort(), spec.timeoutMs) : undefined;

  try {
    const { response, headersInjectedByCaller, observedUndiciHeaders, observationNote } =
      await outboundFetch(target, {
        signal: controller?.signal,
      });
    const body = await readBody(response);
    const failed = !response.ok;
    recordRequestMetrics(testCase, Date.now() - started, failed);
    return Response.json(
      {
        ok: response.ok,
        test_case: testCase,
        target,
        headers_injected_by_next_before_fetch: headersInjectedByCaller,
        observed_undici_headers: observedUndiciHeaders,
        observation_note: observationNote,
        span_hierarchy_local_evidence: hierarchyFromProxyBody(body),
        browser_to_next: browserIncomingTraceDebug(request),
        downstream_status: response.status,
        downstream_headers: jsonHeadersFromResponse(response),
        downstream_body: body,
        next_trace: currentTraceDebug(),
      },
      { status: response.ok ? 200 : response.status },
    );
  } catch (error) {
    recordRequestMetrics(testCase, Date.now() - started, true);
    Sentry.captureException(error);
    const timedOut = controller?.signal.aborted === true;
    return Response.json(
      {
        ok: false,
        test_case: testCase,
        target,
        timeout: timedOut,
        headers_injected_by_next_before_fetch: false,
        error: error instanceof Error ? error.message : String(error),
        browser_to_next: browserIncomingTraceDebug(request),
        next_trace: currentTraceDebug(),
      },
      { status: timedOut ? 504 : 500 },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readBody(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
