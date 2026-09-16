from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sentry_sdk import metrics

from sentry_setup import ENVIRONMENT, SERVICE, init_sentry

init_sentry()

app = FastAPI(title="Sentry PoC Python Direct", version="1.0.0")


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
    metrics.gauge("poc.queue.depth", 1, attributes=attributes)
    if failed:
        metrics.count("poc.failure.count", 1, attributes=attributes)


@app.middleware("http")
async def attach_trace_response_headers(request: Request, call_next):
    sentry_sdk.set_tag("service", SERVICE)
    sentry_sdk.set_attribute("service", SERVICE)
    start = time.perf_counter()
    response = await call_next(request)
    span = sentry_sdk.get_current_span()
    if span is not None:
        response.headers["x-sentry-poc-trace-id"] = span.trace_id or ""
        response.headers["x-sentry-poc-span-id"] = span.span_id or ""
    response.headers["x-sentry-poc-service"] = SERVICE
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["x-sentry-poc-duration-ms"] = f"{duration_ms:.1f}"
    return response


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": SERVICE}


@app.get("/api/success")
def success(request: Request) -> dict[str, Any]:
    started = time.perf_counter()
    sentry_sdk.set_attribute("test_case", "python-direct-success")
    _record_metrics("python-direct-success", (time.perf_counter() - started) * 1000)
    return _envelope(request, "python-direct-success")


@app.get("/api/error")
def uncaught_error() -> None:
    sentry_sdk.set_attribute("test_case", "python-direct-uncaught")
    _record_metrics("python-direct-uncaught", 0, failed=True)
    raise RuntimeError("Uncaught Python Direct exception for Sentry PoC")


@app.get("/api/caught-error")
def caught_error(request: Request) -> JSONResponse:
    sentry_sdk.set_attribute("test_case", "python-direct-caught")
    try:
        raise RuntimeError("Caught Python Direct exception for Sentry PoC")
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        _record_metrics("python-direct-caught", 0, failed=True)
        return JSONResponse(
            status_code=200,
            content=_envelope(request, "python-direct-caught", {"ok": False, "captured": True}),
        )


@app.get("/api/slow")
async def slow(request: Request, delay_ms: int = 3000) -> dict[str, Any]:
    sentry_sdk.set_attribute("test_case", "python-direct-slow")
    started = time.perf_counter()
    await asyncio.sleep(max(delay_ms, 0) / 1000)
    duration_ms = (time.perf_counter() - started) * 1000
    _record_metrics("python-direct-slow", duration_ms)
    return _envelope(request, "python-direct-slow", {"delay_ms": delay_ms})


@app.get("/api/log")
def log_endpoint(request: Request) -> dict[str, Any]:
    sentry_sdk.set_attribute("test_case", "python-direct-log")
    sentry_sdk.logger.info(
        "Python Direct structured log correlated with the active trace",
        attributes={
            "service": SERVICE,
            "environment": ENVIRONMENT,
            "test_case": "python-direct-log",
            "request_kind": "log",
        },
    )
    _record_metrics("python-direct-log", 1)
    return _envelope(request, "python-direct-log")


@app.get("/api/metric")
def metric_endpoint(request: Request) -> dict[str, Any]:
    sentry_sdk.set_attribute("test_case", "python-direct-metric")
    _record_metrics("python-direct-metric", 12.0)
    return _envelope(
        request,
        "python-direct-metric",
        {
            "metrics_emitted": [
                "poc.request.count",
                "poc.request.duration",
                "poc.queue.depth",
            ]
        },
    )


@app.get("/api/grouping-same")
def grouping_same() -> None:
    raise RuntimeError("sentry-poc grouping: identical boom")


@app.get("/api/grouping-different")
def grouping_different() -> None:
    raise TypeError("sentry-poc grouping: different type")
