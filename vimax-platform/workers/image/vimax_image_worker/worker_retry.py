"""Bounded retry policy for Redis list workers behind the BullMQ bridge."""

MAX_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 3.0

# Payload/validation bugs — pydantic's ValidationError subclasses ValueError.
# Retrying cannot fix them, so they fail fast instead of burning attempts.
DETERMINISTIC_ERRORS = (KeyError, ValueError)


def retry_backoff_seconds(attempt: int) -> float:
    return RETRY_BACKOFF_SECONDS * (2**attempt)


def should_retry(attempt: int, retryable: bool) -> bool:
    return retryable and attempt < MAX_ATTEMPTS
