package com.example.sentrypoc.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.example.sentrypoc.observability.Observability;
import io.sentry.ISpan;
import io.sentry.Sentry;

/**
 * Best-effort diagnostic response headers. These are NOT acceptance criteria for
 * distributed tracing. If the response is already committed, or the request
 * throws, headers may be missing. Use Sentry span trees instead.
 */
@Component
public class TraceResponseFilter extends OncePerRequestFilter {

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    applyBestEffortHeaders(response);
    try {
      filterChain.doFilter(request, response);
    } finally {
      applyBestEffortHeaders(response);
    }
  }

  private void applyBestEffortHeaders(HttpServletResponse response) {
    if (response.isCommitted()) {
      return;
    }
    response.setHeader("x-sentry-poc-service", Observability.SERVICE);
    response.setHeader(
        "x-sentry-poc-headers-note", "best-effort-debug-only-not-acceptance-criteria");
    ISpan span = Sentry.getSpan();
    if (span != null && span.getSpanContext() != null) {
      response.setHeader(
          "x-sentry-poc-trace-id", String.valueOf(span.getSpanContext().getTraceId()));
      response.setHeader(
          "x-sentry-poc-span-id", String.valueOf(span.getSpanContext().getSpanId()));
      if (span.getSpanContext().getParentSpanId() != null) {
        response.setHeader(
            "x-sentry-poc-parent-span-id",
            String.valueOf(span.getSpanContext().getParentSpanId()));
      }
    }
  }
}
