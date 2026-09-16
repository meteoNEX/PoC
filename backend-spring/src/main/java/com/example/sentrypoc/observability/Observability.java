package com.example.sentrypoc.observability;

import io.sentry.ISpan;
import io.sentry.Sentry;
import io.sentry.SentryAttribute;
import io.sentry.SentryAttributes;
import io.sentry.SentryLogLevel;
import io.sentry.SpanContext;
import io.sentry.logger.SentryLogParameters;
import io.sentry.metrics.SentryMetricsParameters;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class Observability {

  public static final String SERVICE = "sentry-poc-spring";

  private final String environment;

  public Observability(@Value("${sentry.environment:poc}") String environment) {
    this.environment = environment == null || environment.isBlank() ? "poc" : environment;
  }

  public String environment() {
    return environment;
  }

  public void recordRequest(String testCase, double durationMs, boolean failed) {
    SentryAttributes attributes =
        SentryAttributes.of(
            SentryAttribute.stringAttribute("service", SERVICE),
            SentryAttribute.stringAttribute("environment", environment),
            SentryAttribute.stringAttribute("test_case", testCase),
            SentryAttribute.stringAttribute("request_kind", "http"),
            SentryAttribute.stringAttribute("measurement", "elapsed_wall_time"));
    SentryMetricsParameters params = SentryMetricsParameters.create(attributes);
    Sentry.metrics().count("poc.request.count", 1.0, null, params);
    Sentry.metrics().distribution("poc.request.duration", durationMs, "millisecond", params);
    SentryAttributes gaugeAttributes =
        SentryAttributes.of(
            SentryAttribute.stringAttribute("service", SERVICE),
            SentryAttribute.stringAttribute("environment", environment),
            SentryAttribute.stringAttribute("test_case", testCase),
            SentryAttribute.stringAttribute("request_kind", "http"),
            SentryAttribute.stringAttribute("synthetic_example", "true"),
            SentryAttribute.stringAttribute("note", "no-real-queue"));
    Sentry.metrics().gauge("poc.queue.depth", 1.0, null, SentryMetricsParameters.create(gaugeAttributes));
    if (failed) {
      Sentry.metrics().count("poc.failure.count", 1.0, null, params);
    }
  }

  public void structuredLog(String testCase, String message) {
    Sentry.logger()
        .log(
            SentryLogLevel.INFO,
            SentryLogParameters.create(
                SentryAttributes.of(
                    SentryAttribute.stringAttribute("service", SERVICE),
                    SentryAttribute.stringAttribute("environment", environment),
                    SentryAttribute.stringAttribute("test_case", testCase),
                    SentryAttribute.stringAttribute("request_kind", "log"),
                    SentryAttribute.stringAttribute("log_channel", "sentry.logger"))),
            message);
  }

  public Map<String, String> incomingTraceHeaders(HttpServletRequest request) {
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("sentry-trace", request.getHeader("sentry-trace"));
    headers.put("baggage", request.getHeader("baggage"));
    headers.put("traceparent", request.getHeader("traceparent"));
    headers.put("tracestate", request.getHeader("tracestate"));
    return headers;
  }

  public Map<String, String> activeSpan() {
    Map<String, String> spanInfo = new LinkedHashMap<>();
    ISpan span = Sentry.getSpan();
    if (span != null && span.getSpanContext() != null) {
      SpanContext ctx = span.getSpanContext();
      spanInfo.put("trace_id", String.valueOf(ctx.getTraceId()));
      spanInfo.put("span_id", String.valueOf(ctx.getSpanId()));
      if (ctx.getParentSpanId() != null) {
        spanInfo.put("parent_span_id", String.valueOf(ctx.getParentSpanId()));
      }
    }
    return spanInfo;
  }
}
