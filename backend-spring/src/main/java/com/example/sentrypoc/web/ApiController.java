package com.example.sentrypoc.web;

import com.example.sentrypoc.observability.Observability;
import io.sentry.Sentry;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class ApiController {

  private static final Logger log = LoggerFactory.getLogger(ApiController.class);
  private static final ParameterizedTypeReference<Map<String, Object>> MAP =
      new ParameterizedTypeReference<>() {};

  private final RestClient pythonDownstream;
  private final RestClient pythonDownstreamStrict;
  private final Observability observability;
  private final String uptimeMode;

  public ApiController(
      @Qualifier("pythonDownstreamRestClient") RestClient pythonDownstream,
      @Qualifier("pythonDownstreamStrictRestClient") RestClient pythonDownstreamStrict,
      Observability observability,
      @Value("${sentry.poc.uptime-mode:}") String uptimeMode) {
    this.pythonDownstream = pythonDownstream;
    this.pythonDownstreamStrict = pythonDownstreamStrict;
    this.observability = observability;
    this.uptimeMode = uptimeMode;
  }

  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("ok", true, "service", Observability.SERVICE);
  }

  @GetMapping("/api/success")
  public Map<String, Object> success(HttpServletRequest request) {
    long started = System.nanoTime();
    Map<String, Object> body = envelope(request, "spring-success", true, null);
    observability.recordRequest("spring-success", elapsedMs(started), false);
    return body;
  }

  @GetMapping("/api/error")
  public Map<String, Object> error() {
    long started = System.nanoTime();
    try {
      throw new RuntimeException("Uncaught Spring Boot exception for Sentry PoC");
    } finally {
      observability.recordRequest("spring-uncaught", elapsedMs(started), true);
    }
  }

  @GetMapping("/api/caught-error")
  public Map<String, Object> caughtError(HttpServletRequest request) {
    long started = System.nanoTime();
    try {
      throw new RuntimeException("Caught Spring Boot exception for Sentry PoC");
    } catch (RuntimeException ex) {
      Sentry.captureException(ex);
      observability.recordRequest("spring-caught", elapsedMs(started), true);
      Map<String, Object> body = envelope(request, "spring-caught", false, null);
      body.put("captured", true);
      return body;
    }
  }

  @GetMapping("/api/downstream-success")
  public Map<String, Object> downstreamSuccess(HttpServletRequest request) {
    long started = System.nanoTime();
    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/success");
    observability.recordRequest("spring-downstream-success", elapsedMs(started), false);
    return envelope(request, "spring-downstream-success", true, downstream);
  }

  @GetMapping("/api/downstream-error")
  public Map<String, Object> downstreamError(HttpServletRequest request) {
    long started = System.nanoTime();
    try {
      getDownstream(pythonDownstream, "/api/error");
      observability.recordRequest("spring-downstream-error", elapsedMs(started), true);
      return envelope(request, "spring-downstream-error", false, null);
    } catch (RuntimeException ex) {
      observability.recordRequest("spring-downstream-error", elapsedMs(started), true);
      throw ex;
    }
  }

  @GetMapping("/api/downstream-slow")
  public Map<String, Object> downstreamSlow(HttpServletRequest request) {
    long started = System.nanoTime();
    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/slow?delay_ms=3000");
    observability.recordRequest("spring-downstream-slow", elapsedMs(started), false);
    return envelope(request, "spring-downstream-slow", true, downstream);
  }

  @GetMapping("/api/downstream-timeout")
  public Map<String, Object> downstreamTimeout(HttpServletRequest request) {
    long started = System.nanoTime();
    try {
      getDownstream(pythonDownstreamStrict, "/api/slow?delay_ms=5000");
      observability.recordRequest("spring-downstream-timeout", elapsedMs(started), false);
      return envelope(request, "spring-downstream-timeout", true, null);
    } catch (RestClientException ex) {
      Sentry.captureException(ex);
      observability.recordRequest("spring-downstream-timeout", elapsedMs(started), true);
      throw new ResponseStatusException(
          HttpStatus.GATEWAY_TIMEOUT, "Spring RestClient timed out calling Python Downstream", ex);
    }
  }

  @GetMapping("/api/downstream-log")
  public Map<String, Object> downstreamLog(HttpServletRequest request) {
    long started = System.nanoTime();
    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/log");
    observability.recordRequest("spring-downstream-log", elapsedMs(started), false);
    return envelope(request, "spring-downstream-log", true, downstream);
  }

  @GetMapping("/api/log")
  public Map<String, Object> logEndpoint(HttpServletRequest request) {
    long started = System.nanoTime();
    log.info(
        "Spring Boot SLF4J/Logback INFO log for Sentry PoC test_case=spring-log log_channel=slf4j");
    observability.structuredLog(
        "spring-log", "Spring Boot explicit Sentry.logger() correlated with the active trace");
    observability.recordRequest("spring-log", elapsedMs(started), false);
    Map<String, Object> body = envelope(request, "spring-log", true, null);
    body.put(
        "log_channels",
        Map.of(
            "framework", "SLF4J/Logback",
            "explicit_sentry_logger", "Sentry.logger()"));
    body.put(
        "log_note",
        "Sentry.logger() succeeding is not proof that ordinary Spring logs are auto-collected.");
    return body;
  }

  @GetMapping("/api/metric")
  public Map<String, Object> metric(HttpServletRequest request) {
    long started = System.nanoTime();
    observability.recordRequest("spring-metric", elapsedMs(started), false);
    Map<String, Object> body = envelope(request, "spring-metric", true, null);
    body.put(
        "metrics_emitted",
        new String[] {
          "poc.request.count",
          "poc.request.duration (elapsed_wall_time)",
          "poc.queue.depth (synthetic_example, no real queue)"
        });
    return body;
  }

  /**
   * Single URL intended for a later Sentry Developer-plan Uptime monitor.
   *
   * <p>{@code GET /api/uptime-test} — HTTP 200 and a call to Python Downstream.<br>
   * {@code GET /api/uptime-test?mode=error} — call downstream, then throw.<br>
   * {@code GET /api/uptime-test?mode=slow} — delayed 200, still traces downstream.
   *
   * <p>A ~4s delay does not by itself mean a Sentry Uptime monitor will fail. That
   * depends on the monitor timeout configured in Sentry.
   */
  @GetMapping("/api/uptime-test")
  public Map<String, Object> uptimeTest(
      HttpServletRequest request, @RequestParam(required = false) String mode)
      throws InterruptedException {
    long started = System.nanoTime();
    String effective = (mode == null || mode.isBlank()) ? uptimeMode : mode;
    if (effective == null || effective.isBlank()) {
      effective = "normal";
    }
    if ("ok".equalsIgnoreCase(effective)) {
      effective = "normal";
    }

    log.info(
        "uptime_check service={} environment={} mode={} request_kind=uptime log_channel=slf4j",
        Observability.SERVICE,
        observability.environment(),
        effective);
    observability.structuredLog(
        "spring-uptime-" + effective.toLowerCase(),
        "Uptime test structured business log mode=" + effective);

    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/success");

    if ("error".equalsIgnoreCase(effective)) {
      observability.recordRequest("spring-uptime-error", elapsedMs(started), true);
      throw new RuntimeException("Uptime test controlled failure for Sentry PoC");
    }

    if ("slow".equalsIgnoreCase(effective)) {
      Thread.sleep(4000);
      observability.recordRequest("spring-uptime-slow", elapsedMs(started), false);
      Map<String, Object> body = envelope(request, "spring-uptime-slow", true, downstream);
      body.put("delay_note", "Sleep is ~4s. Uptime monitor failure depends on Sentry timeout.");
      return body;
    }

    observability.recordRequest("spring-uptime-ok", elapsedMs(started), false);
    return envelope(request, "spring-uptime-ok", true, downstream);
  }

  @GetMapping("/api/grouping-same")
  public Map<String, Object> groupingSame() {
    throw new RuntimeException("sentry-poc grouping: identical boom");
  }

  @GetMapping("/api/grouping-different")
  public Map<String, Object> groupingDifferent() {
    throw new IllegalStateException("sentry-poc grouping: different type");
  }

  private Map<String, Object> getDownstream(RestClient client, String path) {
    return client.get().uri(path).retrieve().body(MAP);
  }

  private Map<String, Object> envelope(
      HttpServletRequest request, String testCase, boolean ok, Map<String, Object> downstream) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("ok", ok);
    body.put("service", Observability.SERVICE);
    body.put("environment", observability.environment());
    body.put("test_case", testCase);
    body.put("incoming_trace_headers", observability.incomingTraceHeaders(request));
    body.put("active_span", observability.activeSpan());
    if (downstream != null) {
      body.put("downstream", downstream);
    }
    return body;
  }

  private static double elapsedMs(long startedNanos) {
    return (System.nanoTime() - startedNanos) / 1_000_000.0;
  }
}
