from fastapi.testclient import TestClient

from app import app
from sentry_setup import traces_sampler

client = TestClient(app, raise_server_exceptions=False)

TRACE_ID = "aaaabbbbccccddddeeeeffff00001111"
PARENT_SPAN = "aaaabbbbccccdddd"


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "sentry-poc-python-downstream"


def test_success_continues_w3c_and_sentry_headers() -> None:
    response = client.get(
        "/api/success",
        headers={
            "sentry-trace": f"{TRACE_ID}-{PARENT_SPAN}-1",
            "baggage": "sentry-environment=poc,sentry-release=sentry-poc",
            "traceparent": f"00-{TRACE_ID}-{PARENT_SPAN}-01",
        },
    )
    assert response.status_code == 200
    headers = response.json()["incoming_trace_headers"]
    assert headers["sentry-trace"] is not None
    assert headers["traceparent"] is not None
    assert headers["baggage"] is not None
    span = response.json()["active_span"]
    if span.get("span_id"):
        assert span["trace_id"] == TRACE_ID
        assert span["parent_span_id"] == PARENT_SPAN
        assert span["span_id"] != PARENT_SPAN


def test_uncaught_error() -> None:
    response = client.get("/api/error")
    assert response.status_code == 500


def test_log() -> None:
    body = client.get("/api/log").json()
    assert body["log_channels"]["framework"] == "stdlib logging.Logger"
    assert body["log_channels"]["explicit_sentry_logger"] == "sentry_sdk.logger"


def test_sampler_drops_health_even_if_parent_sampled() -> None:
    assert traces_sampler({"asgi_scope": {"path": "/health"}, "parent_sampled": True}) == 0.0


def test_sampler_inherits_parent_sampled() -> None:
    assert traces_sampler({"asgi_scope": {"path": "/api/success"}, "parent_sampled": True}) == 1.0
    assert traces_sampler({"asgi_scope": {"path": "/api/success"}, "parent_sampled": False}) == 0.0
