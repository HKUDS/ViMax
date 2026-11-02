import unittest

from vimax_image_worker.handler import (
    MAX_ATTEMPTS,
    ImageJobPayload,
    retry_backoff_seconds,
    should_retry,
)
from vimax_image_worker.tracing import parse_traceparent
from vimax_image_worker.worker_retry import (
    retry_backoff_seconds as worker_retry_backoff,
    should_retry as worker_should_retry,
)


def _payload(**overrides) -> ImageJobPayload:
    base = {
        "job_id": "00000000-0000-0000-0000-000000000001",
        "job_type": "image.t2i",
        "model_id": "m",
        "credential": {"class_path": "a.B", "api_key": "k"},
        "input": {"prompt": "p", "size": "1024x1024"},
        "callback": {
            "event_channel": "ch",
            "upload_bucket": "b",
            "upload_prefix": "p",
        },
        "cache_key": "c",
    }
    base.update(overrides)
    return ImageJobPayload.model_validate(base)


class RetryPolicyTest(unittest.TestCase):
    def test_video_and_pipeline_retry_policy_is_bounded(self):
        self.assertTrue(worker_should_retry(0, retryable=True))
        self.assertTrue(worker_should_retry(1, retryable=True))
        self.assertFalse(worker_should_retry(2, retryable=True))
        self.assertFalse(worker_should_retry(0, retryable=False))
        self.assertEqual(worker_retry_backoff(0), 3.0)


class ConcatRetryClassificationTest(unittest.TestCase):
    def test_infrastructure_errors_retry_and_local_errors_fail_fast(self):
        from vimax_image_worker.concat_handler import _is_retryable

        self.assertTrue(_is_retryable(TimeoutError("read timed out")))
        self.assertTrue(_is_retryable(ConnectionError("connection reset by peer")))
        self.assertTrue(_is_retryable(Exception("An error occurred (SlowDown) when calling the PutObject operation")))
        self.assertFalse(_is_retryable(ValueError("Need at least 2 video clips to concatenate")))
        self.assertFalse(_is_retryable(RuntimeError("ffmpeg subtitle burn failed: exit 1")))

    def test_transient_failures_retry_within_budget(self):
        self.assertTrue(should_retry(0, retryable=True))
        self.assertTrue(should_retry(1, retryable=True))
        self.assertFalse(should_retry(MAX_ATTEMPTS, retryable=True))

    def test_permanent_failures_never_retry(self):
        self.assertFalse(should_retry(0, retryable=False))

    def test_backoff_grows_exponentially(self):
        self.assertEqual(retry_backoff_seconds(0), 3.0)
        self.assertEqual(retry_backoff_seconds(1), 6.0)

    def test_payload_attempt_defaults_to_zero(self):
        self.assertEqual(_payload().attempt, 0)
        self.assertEqual(_payload(attempt=2).attempt, 2)

    def test_payload_accepts_optional_traceparent(self):
        self.assertIsNone(_payload().traceparent)
        self.assertEqual(
            _payload(traceparent="00-" + "a" * 32 + "-" + "b" * 16 + "-01").traceparent,
            "00-" + "a" * 32 + "-" + "b" * 16 + "-01",
        )

    def test_payload_accepts_ecommerce_sizes(self):
        # 前端电商比例会写入的尺寸，桥接与 worker 均不应拒绝。
        self.assertEqual(_payload(input={"prompt": "p", "size": "1024x1536"}).input.size, "1024x1536")


class TraceparentTest(unittest.TestCase):
    def test_valid_traceparent_parses(self):
        parsed = parse_traceparent("00-" + "a" * 32 + "-" + "b" * 16 + "-01")
        self.assertEqual(parsed, ("a" * 32, "b" * 16))

    def test_invalid_traceparents_are_rejected(self):
        self.assertIsNone(parse_traceparent(None))
        self.assertIsNone(parse_traceparent(""))
        self.assertIsNone(parse_traceparent("garbage"))
        self.assertIsNone(parse_traceparent("01-" + "a" * 32 + "-" + "b" * 16 + "-01"))
        self.assertIsNone(parse_traceparent("00-" + "0" * 32 + "-" + "b" * 16 + "-01"))
        self.assertIsNone(parse_traceparent("00-" + "a" * 31 + "-" + "b" * 16 + "-01"))


if __name__ == "__main__":
    unittest.main()
