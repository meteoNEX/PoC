from fastapi.testclient import TestClient

from app import app
from sentry_setup import traces_sampler

client = TestClient(app, raise_server_exceptions=False)

TRACE_ID = "1234567890abcdef1234567890abcdef"
PARENT_SPAN = "1234567890abcdef"


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "sentry-poc-python-direct"


def test_success_includes_trace_header_echo() -> None:
    response = client.get(
        "/api/success",
        headers={
            "sentry-trace": f"{TRACE_ID}-{PARENT_SPAN}-1",
            "traceparent": f"00-{TRACE_ID}-{PARENT_SPAN}-01",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["incoming_trace_headers"]["sentry-trace"].startswith(TRACE_ID)
    assert body["incoming_trace_headers"]["traceparent"].startswith("00-")
    span = body["active_span"]
    if span.get("span_id"):
        assert span["trace_id"] == TRACE_ID
        assert span["parent_span_id"] == PARENT_SPAN
        assert span["span_id"] != PARENT_SPAN


def test_uncaught_error() -> None:
    response = client.get("/api/error")
    assert response.status_code == 500


def test_caught_error() -> None:
    response = client.get("/api/caught-error")
    assert response.status_code == 200
    assert response.json()["captured"] is True


def test_log_and_metric() -> None:
    log_body = client.get("/api/log").json()
    assert log_body["log_channels"]["framework"] == "stdlib logging.Logger"
    assert log_body["log_channels"]["explicit_sentry_logger"] == "sentry_sdk.logger"
    assert client.get("/api/metric").status_code == 200


def test_sampler_drops_health_even_if_parent_sampled() -> None:
    assert traces_sampler({"asgi_scope": {"path": "/health"}, "parent_sampled": True}) == 0.0


def test_sampler_inherits_parent_sampled() -> None:
    assert traces_sampler({"asgi_scope": {"path": "/api/success"}, "parent_sampled": True}) == 1.0
    assert traces_sampler({"asgi_scope": {"path": "/api/success"}, "parent_sampled": False}) == 0.0
