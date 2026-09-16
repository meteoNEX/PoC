from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import sentry_sdk
from fastapi import FastAPI, Request
from sentry_sdk import metrics

from sentry_setup import ENVIRONMENT, SERVICE, init_sentry

init_sentry()

app = FastAPI(title="Sentry PoC Python Downstream", version="1.0.0")


def _incoming_trace_headers(request: Request) -> dict[str, str | None]:
    return {
        "sentry-trace": request.headers.get("sentry-trace"),
        "baggage": request.headers.get("baggage"),
        "traceparent": request.headers.get("traceparent"),
        "tracestate": request.headers.get("tracestate"),
    }


def _active_span() -> dict[str, str | None]:
    span = sentry_sdk.get_current_span()
    if span is None:
        return {"trace_id": None, "span_id": None}
    return {"trace_id": span.trace_id, "span_id": span.span_id}


def _envelope(request: Request, test_case: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "ok": True,
        "service": SERVICE,
        "environment": ENVIRONMENT,
        "release": os.getenv("SENTRY_RELEASE", "sentry-poc@1.0.0"),
        "test_case": test_case,
        "incoming_trace_headers": _incoming_trace_headers(request),
        "active_span": _active_span(),
    }
    if extra:
        body.update(extra)
    return body


def _record_metrics(test_case: str, duration_ms: float, failed: bool = False) -> None:
    attributes = {
        "service": SERVICE,
        "environment": ENVIRONMENT,
        "test_case": test_case,
        "request_kind": "http",
    }
    metrics.count("poc.request.count", 1, attributes=attributes)
    metrics.distribution("poc.request.duration", duration_ms, unit="millisecond", attributes=attributes)
    metrics.gauge("poc.queue.depth", 2, attributes=attributes)
    if failed:
        metrics.count("poc.failure.count", 1, attributes=attributes)


@app.middleware("http")
async def attach_trace_response_headers(request: Request, call_next):
    sentry_sdk.set_tag("service", SERVICE)
    sentry_sdk.set_attribute("service", SERVICE)
    response = await call_next(request)
    span = sentry_sdk.get_current_span()
    if span is not None:
        response.headers["x-sentry-poc-trace-id"] = span.trace_id or ""
        response.headers["x-sentry-poc-span-id"] = span.span_id or ""
    response.headers["x-sentry-poc-service"] = SERVICE
    return response


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": SERVICE}


@app.get("/api/success")
def success(request: Request) -> dict[str, Any]:
    sentry_sdk.set_attribute("test_case", "python-downstream-success")
    _record_metrics("python-downstream-success", 1)
    return _envelope(request, "python-downstream-success")


@app.get("/api/error")
def uncaught_error() -> None:
    sentry_sdk.set_attribute("test_case", "python-downstream-uncaught")
    _record_metrics("python-downstream-uncaught", 0, failed=True)
    raise RuntimeError("Uncaught Python Downstream exception for Sentry PoC")


@app.get("/api/slow")
async def slow(request: Request, delay_ms: int = 3000) -> dict[str, Any]:
    sentry_sdk.set_attribute("test_case", "python-downstream-slow")
    started = time.perf_counter()
    await asyncio.sleep(max(delay_ms, 0) / 1000)
    _record_metrics("python-downstream-slow", (time.perf_counter() - started) * 1000)
    return _envelope(request, "python-downstream-slow", {"delay_ms": delay_ms})


@app.get("/api/log")
def log_endpoint(request: Request) -> dict[str, Any]:
    sentry_sdk.set_attribute("test_case", "python-downstream-log")
    sentry_sdk.logger.info(
        "Python Downstream structured log correlated with the active trace",
        attributes={
            "service": SERVICE,
            "environment": ENVIRONMENT,
            "test_case": "python-downstream-log",
            "request_kind": "log",
        },
    )
    _record_metrics("python-downstream-log", 1)
    return _envelope(request, "python-downstream-log")
