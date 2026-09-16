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

@Component
public class TraceResponseFilter extends OncePerRequestFilter {

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    filterChain.doFilter(request, response);
    ISpan span = Sentry.getSpan();
    if (span != null && span.getSpanContext() != null) {
      response.setHeader(
          "x-sentry-poc-trace-id", String.valueOf(span.getSpanContext().getTraceId()));
      response.setHeader(
          "x-sentry-poc-span-id", String.valueOf(span.getSpanContext().getSpanId()));
    }
    response.setHeader("x-sentry-poc-service", Observability.SERVICE);
  }
}
