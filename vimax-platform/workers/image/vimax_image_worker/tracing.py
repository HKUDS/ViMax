"""W3C trace context correlation for image jobs.

Extracts the traceparent stamped by the TS decision layer so worker-side
execution joins the same trace. When Langfuse env vars are present, one
span per job execution is exported via OTLP/HTTP(JSON); without them the
traceparent is still parsed for log correlation and nothing is sent.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import urllib.request
from threading import Thread

logger = logging.getLogger(__name__)

_OTLP_TIMEOUT_SECONDS = 5


def parse_traceparent(traceparent: str | None) -> tuple[str, str] | None:
    """Return (trace_id, parent_span_id) for a valid W3C traceparent."""
    if not traceparent:
        return None
    parts = traceparent.strip().split("-")
    if len(parts) != 4:
        return None
    version, trace_id, span_id, _flags = parts
    if version != "00" or len(trace_id) != 32 or len(span_id) != 16:
        return None
    if trace_id == "0" * 32 or span_id == "0" * 16:
        return None
    return trace_id, span_id


def langfuse_otlp_endpoint() -> tuple[str, str] | None:
    host = os.environ.get("LANGFUSE_HOST")
    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY")
    secret_key = os.environ.get("LANGFUSE_SECRET_KEY")
    if not host or not public_key or not secret_key:
        return None
    url = host.rstrip("/") + "/api/public/otel/v1/traces"
    token = base64.b64encode(f"{public_key}:{secret_key}".encode()).decode()
    return url, f"Basic {token}"


def export_job_span(
    traceparent: str | None,
    job_id: str,
    status: str,
    started_ms: float,
    attributes: dict[str, str],
) -> None:
    """Fire-and-forget: export one span covering this job execution.

    Best-effort on a daemon thread — tracing must never fail a job.
    """
    endpoint = langfuse_otlp_endpoint()
    parsed = parse_traceparent(traceparent)
    if not endpoint or not parsed:
        return
    trace_id, parent_span_id = parsed

    end_ns = time.time_ns()
    span = {
        "traceId": trace_id,
        "spanId": os.urandom(8).hex(),
        "parentSpanId": parent_span_id,
        "name": "image.job",
        "kind": 1,
        "startTimeUnixNano": str(int(started_ms) * 1_000_000),
        "endTimeUnixNano": str(end_ns),
        "attributes": [
            {"key": key, "value": {"stringValue": value}}
            for key, value in {**attributes, "status": status}.items()
        ],
        "status": {},
    }
    body = {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "vimax-image-worker"}},
                    ],
                },
                "scopeSpans": [
                    {"scope": {"name": "vimax-trace"}, "spans": [span]},
                ],
            },
        ],
    }

    url, authorization = endpoint

    def _post() -> None:
        try:
            request = urllib.request.Request(
                url,
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json", "Authorization": authorization},
            )
            urllib.request.urlopen(request, timeout=_OTLP_TIMEOUT_SECONDS).read()
        except Exception:
            logger.debug("OTLP export failed for job %s", job_id, exc_info=True)

    Thread(target=_post, daemon=True).start()
