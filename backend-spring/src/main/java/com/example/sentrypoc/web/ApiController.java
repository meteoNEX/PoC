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
    observability.recordRequest("spring-success", 1, false);
    return envelope(request, "spring-success", true, null);
  }

  @GetMapping("/api/error")
  public Map<String, Object> error() {
    observability.recordRequest("spring-uncaught", 1, true);
    throw new RuntimeException("Uncaught Spring Boot exception for Sentry PoC");
  }

  @GetMapping("/api/caught-error")
  public Map<String, Object> caughtError(HttpServletRequest request) {
    try {
      throw new RuntimeException("Caught Spring Boot exception for Sentry PoC");
    } catch (RuntimeException ex) {
      Sentry.captureException(ex);
      observability.recordRequest("spring-caught", 1, true);
      Map<String, Object> body = envelope(request, "spring-caught", false, null);
      body.put("captured", true);
      return body;
    }
  }

  @GetMapping("/api/downstream-success")
  public Map<String, Object> downstreamSuccess(HttpServletRequest request) {
    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/success");
    observability.recordRequest("spring-downstream-success", 1, false);
    return envelope(request, "spring-downstream-success", true, downstream);
  }

  @GetMapping("/api/downstream-error")
  public Map<String, Object> downstreamError(HttpServletRequest request) {
    observability.recordRequest("spring-downstream-error", 1, true);
    getDownstream(pythonDownstream, "/api/error");
    return envelope(request, "spring-downstream-error", false, null);
  }

  @GetMapping("/api/downstream-slow")
  public Map<String, Object> downstreamSlow(HttpServletRequest request) {
    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/slow?delay_ms=3000");
    observability.recordRequest("spring-downstream-slow", 3000, false);
    return envelope(request, "spring-downstream-slow", true, downstream);
  }

  @GetMapping("/api/downstream-timeout")
  public Map<String, Object> downstreamTimeout(HttpServletRequest request) {
    try {
      getDownstream(pythonDownstreamStrict, "/api/slow?delay_ms=5000");
      observability.recordRequest("spring-downstream-timeout", 1000, false);
      return envelope(request, "spring-downstream-timeout", true, null);
    } catch (RestClientException ex) {
      Sentry.captureException(ex);
      observability.recordRequest("spring-downstream-timeout", 1000, true);
      throw new ResponseStatusException(
          HttpStatus.GATEWAY_TIMEOUT, "Spring RestClient timed out calling Python Downstream", ex);
    }
  }

  @GetMapping("/api/log")
  public Map<String, Object> logEndpoint(HttpServletRequest request) {
    log.error("Spring Boot ERROR log for Sentry PoC test_case=spring-log request_kind=log");
    observability.structuredLog(
        "spring-log", "Spring Boot structured ERROR log correlated with the active trace");
    observability.recordRequest("spring-log", 1, false);
    return envelope(request, "spring-log", true, null);
  }

  @GetMapping("/api/metric")
  public Map<String, Object> metric(HttpServletRequest request) {
    observability.recordRequest("spring-metric", 15, false);
    Map<String, Object> body = envelope(request, "spring-metric", true, null);
    body.put(
        "metrics_emitted",
        new String[] {
          "poc.request.count", "poc.request.duration", "poc.queue.depth"
        });
    return body;
  }

  /**
   * Single URL intended for a later Sentry Developer-plan Uptime monitor.
   *
   * <p>{@code GET /api/uptime-test} — HTTP 200 and a call to Python Downstream.<br>
   * {@code GET /api/uptime-test?mode=error} — controlled failure + Sentry issue.<br>
   * {@code GET /api/uptime-test?mode=slow} — delayed 200, still traces downstream.
   *
   * <p>When {@code mode} is omitted, {@code SENTRY_POC_UPTIME_MODE} is used.
   */
  @GetMapping("/api/uptime-test")
  public Map<String, Object> uptimeTest(
      HttpServletRequest request, @RequestParam(required = false) String mode)
      throws InterruptedException {
    String effective = (mode == null || mode.isBlank()) ? uptimeMode : mode;
    if (effective == null || effective.isBlank()) {
      effective = "ok";
    }

    Map<String, Object> downstream = getDownstream(pythonDownstream, "/api/success");

    if ("error".equalsIgnoreCase(effective)) {
      observability.recordRequest("spring-uptime-error", 1, true);
      throw new RuntimeException("Uptime test controlled failure for Sentry PoC");
    }

    if ("slow".equalsIgnoreCase(effective)) {
      Thread.sleep(4000);
      observability.recordRequest("spring-uptime-slow", 4000, false);
      return envelope(request, "spring-uptime-slow", true, downstream);
    }

    observability.recordRequest("spring-uptime-ok", 1, false);
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
    body.put("test_case", testCase);
    body.put("incoming_trace_headers", observability.incomingTraceHeaders(request));
    body.put("active_span", observability.activeSpan());
    if (downstream != null) {
      body.put("downstream", downstream);
    }
    return body;
  }
}
