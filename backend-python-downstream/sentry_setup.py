"""Sentry initialization for Python Downstream.

This service exists to continue traces received from Spring Boot.
"""

from __future__ import annotations

import logging
import os

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

SERVICE = "sentry-poc-python-downstream"
ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "poc")
RELEASE = os.getenv("SENTRY_RELEASE") or None


def _is_health(sampling_context: dict) -> bool:
    asgi_scope = sampling_context.get("asgi_scope") or {}
    path = str(asgi_scope.get("path") or "")
    wsgi = sampling_context.get("wsgi_environ") or {}
    wsgi_path = str(wsgi.get("PATH_INFO") or "")
    transaction = sampling_context.get("transaction_context") or {}
    name = str(transaction.get("name") or "")
    return path == "/health" or wsgi_path == "/health" or name.endswith("/health")


def traces_sampler(sampling_context: dict) -> float:
    """Drop health always; otherwise inherit parent_sampled; else local rate."""
    if _is_health(sampling_context):
        return 0.0
    parent_sampled = sampling_context.get("parent_sampled")
    if parent_sampled is not None:
        return 1.0 if parent_sampled else 0.0
    return float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "1.0"))


def init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN_PYTHON_DOWNSTREAM") or os.getenv("SENTRY_DSN") or ""
    sentry_sdk.init(
        dsn=dsn or None,
        environment=ENVIRONMENT,
        release=RELEASE,
        server_name=SERVICE,
        send_default_pii=False,
        traces_sampler=traces_sampler,
        integrations=[
            LoggingIntegration(level=logging.INFO, event_level=None),
            StarletteIntegration(transaction_style="url"),
            FastApiIntegration(transaction_style="url"),
        ],
    )
    sentry_sdk.set_tag("service", SERVICE)
    sentry_sdk.set_tag("environment", ENVIRONMENT)
    sentry_sdk.set_attribute("service", SERVICE)
    sentry_sdk.set_attribute("environment", ENVIRONMENT)
