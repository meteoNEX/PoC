from fastapi.testclient import TestClient

from app import app

client = TestClient(app, raise_server_exceptions=False)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "sentry-poc-python-direct"


def test_success_includes_trace_header_echo() -> None:
    response = client.get(
        "/api/success",
        headers={
            "sentry-trace": "1234567890abcdef1234567890abcdef-1234567890abcdef-1",
            "traceparent": "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["incoming_trace_headers"]["sentry-trace"].startswith("1234567890abcdef")
    assert body["incoming_trace_headers"]["traceparent"].startswith("00-")


def test_uncaught_error() -> None:
    response = client.get("/api/error")
    assert response.status_code == 500


def test_caught_error() -> None:
    response = client.get("/api/caught-error")
    assert response.status_code == 200
    assert response.json()["captured"] is True


def test_log_and_metric() -> None:
    assert client.get("/api/log").status_code == 200
    assert client.get("/api/metric").status_code == 200
