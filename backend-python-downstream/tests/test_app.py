from fastapi.testclient import TestClient

from app import app

client = TestClient(app, raise_server_exceptions=False)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "sentry-poc-python-downstream"


def test_success_continues_w3c_and_sentry_headers() -> None:
    response = client.get(
        "/api/success",
        headers={
            "sentry-trace": "aaaabbbbccccddddeeeeffff00001111-aaaabbbbccccdddd-1",
            "baggage": "sentry-environment=poc,sentry-release=sentry-poc@1.0.0",
            "traceparent": "00-aaaabbbbccccddddeeeeffff00001111-aaaabbbbccccdddd-01",
        },
    )
    assert response.status_code == 200
    headers = response.json()["incoming_trace_headers"]
    assert headers["sentry-trace"] is not None
    assert headers["traceparent"] is not None
    assert headers["baggage"] is not None


def test_uncaught_error() -> None:
    response = client.get("/api/error")
    assert response.status_code == 500


def test_log() -> None:
    assert client.get("/api/log").status_code == 200
