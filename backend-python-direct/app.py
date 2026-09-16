from __future__ import annotations

import asyncio
import logging
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
stdlib_log = logging.getLogger("sentry_poc.python_direct")


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
        return {
            "trace_id": None,
            "span_id": None,
            "parent_span_id": None,
            "sampled": None,
            "op": None,
        }
    sampled = getattr(span, "sampled", None)
    return {
        "trace_id": span.trace_id,
        "span_id": span.span_id,
        "parent_span_id": getattr(span, "parent_span_id", None),
        "sampled": None if sampled is None else str(bool(sampled)),
        "op": getattr(span, "op", None),
    }


def _envelope(request: Request, test_case: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "ok": True,
        "service": SERVICE,
        "environment": ENVIRONMENT,
        "release": os.getenv("SENTRY_RELEASE"),
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
    metrics.distribution(
        "poc.request.duration",
        duration_ms,
        unit="millisecond",
        attributes={**attributes, "measurement": "elapsed_wall_time"},
    )
    metrics.gauge(
        "poc.queue.depth",
        1,
        attributes={**attributes, "synthetic_example": True, "note": "no-real-queue"},
    )
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
        parent = getattr(span, "parent_span_id", None)
        if parent:
            response.headers["x-sentry-poc-parent-span-id"] = parent
    response.headers["x-sentry-poc-service"] = SERVICE
    response.headers["x-sentry-poc-headers-note"] = "best-effort-debug-only"
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
    started = time.perf_counter()
    sentry_sdk.set_attribute("test_case", "python-direct-caught")
    try:
        raise RuntimeError("Caught Python Direct exception for Sentry PoC")
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        _record_metrics("python-direct-caught", (time.perf_counter() - started) * 1000, failed=True)
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
    started = time.perf_counter()
    sentry_sdk.set_attribute("test_case", "python-direct-log")
    stdlib_log.info(
        "Python Direct stdlib logging (framework logging, log_channel=stdlib)",
        extra={"test_case": "python-direct-log", "log_channel": "stdlib"},
    )
    sentry_sdk.logger.info(
        "Python Direct explicit sentry_sdk.logger correlated with the active trace",
        attributes={
            "service": SERVICE,
            "environment": ENVIRONMENT,
            "test_case": "python-direct-log",
            "request_kind": "log",
            "log_channel": "sentry.logger",
        },
    )
    _record_metrics("python-direct-log", (time.perf_counter() - started) * 1000)
    return _envelope(
        request,
        "python-direct-log",
        {
            "log_channels": {
                "framework": "stdlib logging.Logger",
                "explicit_sentry_logger": "sentry_sdk.logger",
            }
        },
    )


@app.get("/api/metric")
def metric_endpoint(request: Request) -> dict[str, Any]:
    started = time.perf_counter()
    sentry_sdk.set_attribute("test_case", "python-direct-metric")
    _record_metrics("python-direct-metric", (time.perf_counter() - started) * 1000)
    return _envelope(
        request,
        "python-direct-metric",
        {
            "metrics_emitted": [
                "poc.request.count",
                "poc.request.duration (elapsed_wall_time)",
                "poc.queue.depth (synthetic_example, no real queue)",
            ]
        },
    )


@app.get("/api/grouping-same")
def grouping_same() -> None:
    raise RuntimeError("sentry-poc grouping: identical boom")


@app.get("/api/grouping-different")
def grouping_different() -> None:
    raise TypeError("sentry-poc grouping: different type")
