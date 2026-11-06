"""Redis list acknowledgements for worker jobs."""

import logging

import redis


def processing_key(queue_key: str) -> str:
    return f"{queue_key}:processing"


def recover_inflight(client: redis.Redis, queue_key: str) -> int:
    processing = processing_key(queue_key)
    recovered = 0
    while client.rpoplpush(processing, queue_key) is not None:
        recovered += 1
    if recovered:
        logging.warning("Recovered %d interrupted jobs from %s", recovered, processing)
    return recovered


def claim(client: redis.Redis, queue_key: str, timeout: int = 5) -> str | None:
    return client.brpoplpush(queue_key, processing_key(queue_key), timeout=timeout)


def acknowledge(client: redis.Redis, queue_key: str, payload: str) -> None:
    client.lrem(processing_key(queue_key), 1, payload)
