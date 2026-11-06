"""Publish job lifecycle events to Redis Pub/Sub."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import redis


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobReporter:
    def __init__(self, client: redis.Redis, channel: str, job_id: str):
        self._client = client
        self._channel = channel
        self._job_id = job_id

    def _publish(self, event: dict) -> None:
        self._client.publish(self._channel, json.dumps(event))

    def requeue(self, queue_key: str, payload: dict) -> None:
        self._client.lpush(queue_key, json.dumps(payload))

    async def started(self) -> None:
        self._publish({"type": "started", "ts": _now(), "job_id": self._job_id})

    async def progress(self, percent: int, message: str) -> None:
        self._publish(
            {
                "type": "progress",
                "ts": _now(),
                "job_id": self._job_id,
                "percent": percent,
                "message": message,
            }
        )

    async def completed(self, output: dict) -> None:
        self._publish(
            {
                "type": "completed",
                "ts": _now(),
                "job_id": self._job_id,
                "output": output,
            }
        )

    async def failed(self, *, error_code: str, error_message: str, retryable: bool) -> None:
        self._publish(
            {
                "type": "failed",
                "ts": _now(),
                "job_id": self._job_id,
                "error_code": error_code,
                "error_message": error_message,
                "retryable": retryable,
            }
        )
