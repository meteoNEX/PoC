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
RELEASE = os.getenv("SENTRY_RELEASE", "sentry-poc@1.0.0")


def _traces_sampler(sampling_context: dict) -> float:
    path = ""
    asgi_scope = sampling_context.get("asgi_scope") or {}
    path = asgi_scope.get("path") or ""
    transaction = sampling_context.get("transaction_context") or {}
    name = str(transaction.get("name") or "")
    if path == "/health" or name.endswith("/health"):
        return 0.0
    return float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "1.0"))


def init_sentry() -> None:
    dsn = os.getenv("SENTRY_DSN_PYTHON_DOWNSTREAM") or os.getenv("SENTRY_DSN") or ""
    sentry_sdk.init(
        dsn=dsn or None,
        environment=ENVIRONMENT,
        release=RELEASE,
        server_name=SERVICE,
        send_default_pii=False,
        traces_sampler=_traces_sampler,
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
