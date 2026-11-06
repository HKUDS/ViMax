import os
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from tenacity import RetryError

from tools.image_generator_cogview_zhipu_api import ImageGeneratorCogViewZhipuAPI
from tools.image_generator_modelscope_api import ImageGeneratorModelScopeAPI
from tools.image_generator_qwen_image_edit_modelscope_api import ImageGeneratorQwenImageEditModelScopeAPI
from tools.video_generator_cogvideox_zhipu_api import VideoGeneratorCogVideoXZhipuAPI


class _FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self.payload


class _FakeSession:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def post(self, url, **kwargs):
        self.calls.append(("post", url, kwargs))
        return _FakeResponse(self.payload, self.status)

    def get(self, url, **kwargs):
        self.calls.append(("get", url, kwargs))
        return _FakeResponse(self.payload, self.status)


class TestCogViewZhipuImage(unittest.IsolatedAsyncioTestCase):
    def test_snap_size(self):
        generator = ImageGeneratorCogViewZhipuAPI(api_key="k")

        self.assertEqual(generator.snap_size(None), "1024x1024")
        self.assertEqual(generator.snap_size("1024x1024"), "1024x1024")
        self.assertEqual(generator.snap_size("1600x900"), "1344x768")
        self.assertEqual(generator.snap_size("720x1440"), "768x1344")
        self.assertEqual(generator.snap_size("nonsense"), "1024x1024")

    async def test_returns_url_output(self):
        generator = ImageGeneratorCogViewZhipuAPI(api_key="k", model="cogview-3-flash")
        fake = _FakeSession({"data": [{"url": "https://example.com/img.png"}]})

        with patch("tools.image_generator_cogview_zhipu_api.aiohttp.ClientSession", return_value=fake):
            output = await generator.generate_single_image(prompt="a cat", size="1600x900")

        self.assertEqual(output.fmt, "url")
        self.assertEqual(output.data, "https://example.com/img.png")
        method, url, kwargs = fake.calls[0]
        self.assertEqual(method, "post")
        self.assertEqual(url, "https://open.bigmodel.cn/api/paas/v4/images/generations")
        self.assertEqual(kwargs["json"]["model"], "cogview-3-flash")
        self.assertEqual(kwargs["json"]["size"], "1344x768")

    async def test_api_error_raises(self):
        generator = ImageGeneratorCogViewZhipuAPI(api_key="k")
        fake = _FakeSession({"error": {"code": "401", "message": "bad key"}}, status=401)

        with patch("tools.image_generator_cogview_zhipu_api.aiohttp.ClientSession", return_value=fake):
            with self.assertRaises(RetryError):
                await generator.generate_single_image(prompt="a cat")


class TestModelScopeImage(unittest.IsolatedAsyncioTestCase):
    async def test_url_branch_and_payload(self):
        generator = ImageGeneratorModelScopeAPI(api_key="ms-token")
        fake = _FakeSession({"data": [{"url": "https://example.com/out.png"}]})

        with patch("tools.image_generator_modelscope_api.aiohttp.ClientSession", return_value=fake):
            output = await generator.generate_single_image(prompt="bottle", size="1024x1024")

        self.assertEqual(output.fmt, "url")
        self.assertEqual(fake.calls[0][1], "https://api-inference.modelscope.cn/v1/images/generations")
        self.assertEqual(fake.calls[0][2]["headers"]["Authorization"], "Bearer ms-token")
        self.assertEqual(fake.calls[0][2]["json"], {"model": "Qwen/Qwen-Image", "prompt": "bottle", "size": "1024x1024"})

    async def test_b64_branch(self):
        generator = ImageGeneratorModelScopeAPI(api_key="ms-token", model="black-forest-labs/FLUX.1-schnell")
        fake = _FakeSession({"data": [{"b64_json": "aGVsbG8="}]})

        with patch("tools.image_generator_modelscope_api.aiohttp.ClientSession", return_value=fake):
            output = await generator.generate_single_image(prompt="bottle")

        self.assertEqual(output.fmt, "b64")
        self.assertEqual(output.data, "aGVsbG8=")
        self.assertNotIn("size", fake.calls[0][2]["json"])


class TestCogVideoXZhipuVideo(unittest.IsolatedAsyncioTestCase):
    def test_t2v_payload_defaults(self):
        generator = VideoGeneratorCogVideoXZhipuAPI(api_key="k")
        payload = generator.build_payload(
            prompt="a cat playing",
            reference_image_paths=[],
            resolution="720p",
            aspect_ratio="16:9",
            fps=16,
        )

        self.assertEqual(payload["model"], "cogvideox-flash")
        self.assertEqual(payload["size"], "1280x720")
        self.assertEqual(payload["fps"], 30)
        self.assertNotIn("image_url", payload)

    def test_i2v_uses_first_reference(self):
        generator = VideoGeneratorCogVideoXZhipuAPI(api_key="k")
        payload = generator.build_payload(
            prompt="animate",
            reference_image_paths=["https://example.com/first.png", "https://example.com/last.png"],
            resolution="1080p",
            aspect_ratio="9:16",
            fps=60,
        )

        self.assertEqual(payload["image_url"], "https://example.com/first.png")
        self.assertEqual(payload["size"], "1080x1920")
        self.assertEqual(payload["fps"], 60)

    def test_prompt_truncated_and_unknown_size_falls_back(self):
        generator = VideoGeneratorCogVideoXZhipuAPI(api_key="k")
        payload = generator.build_payload(prompt="x" * 600, reference_image_paths=[], resolution=None, aspect_ratio=None, fps=None)

        self.assertEqual(len(payload["prompt"]), 512)
        self.assertEqual(payload["size"], "1280x720")

    async def test_submit_then_poll_success(self):
        generator = VideoGeneratorCogVideoXZhipuAPI(api_key="k", poll_interval=0, max_poll_attempts=1)

        create = _FakeSession({"id": "task-1", "task_status": "PROCESSING"})
        with patch("tools.video_generator_cogvideox_zhipu_api.aiohttp.ClientSession", return_value=create):
            task_id = await generator.create_video_task(prompt="hi", reference_image_paths=[])
        self.assertEqual(task_id, "task-1")
        self.assertEqual(create.calls[0][1], "https://open.bigmodel.cn/api/paas/v4/videos/generations")

        poll = _FakeSession({
            "model": "cogvideox-flash",
            "task_status": "SUCCESS",
            "video_result": [{"url": "https://example.com/out.mp4", "cover_image_url": "https://example.com/cover.jpg"}],
        })
        with patch("tools.video_generator_cogvideox_zhipu_api.aiohttp.ClientSession", return_value=poll):
            video_url = await generator.query_video_task("task-1")
        self.assertEqual(video_url, "https://example.com/out.mp4")
        self.assertEqual(poll.calls[0][1], "https://open.bigmodel.cn/api/paas/v4/async-result/task-1")

    async def test_poll_fail_raises(self):
        generator = VideoGeneratorCogVideoXZhipuAPI(api_key="k", poll_interval=0, max_poll_attempts=1)
        fake = _FakeSession({"task_status": "FAIL"})

        with patch("tools.video_generator_cogvideox_zhipu_api.aiohttp.ClientSession", return_value=fake):
            with self.assertRaises(RuntimeError):
                await generator.query_video_task("task-1")

    async def test_poll_timeout(self):
        generator = VideoGeneratorCogVideoXZhipuAPI(api_key="k", poll_interval=0, max_poll_attempts=1)
        fake = _FakeSession({"task_status": "PROCESSING"})

        with patch("tools.video_generator_cogvideox_zhipu_api.aiohttp.ClientSession", return_value=fake):
            with self.assertRaises(TimeoutError):
                await generator.query_video_task("task-1")


class TestQwenImageEditModelScope(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        fd, self.ref_path = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        Image.new("RGB", (8, 8), "white").save(self.ref_path)

    def tearDown(self):
        os.unlink(self.ref_path)

    def test_build_payload_encodes_references_as_data_uris(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(api_key="ms-token")
        payload = generator.build_payload(
            prompt="换成白底",
            reference_image_paths=[self.ref_path],
            size="1600x900",
        )
        self.assertEqual(payload["model"], "Qwen/Qwen-Image-Edit-2509")
        self.assertEqual(payload["size"], "1344x768")
        self.assertEqual(len(payload["images"]), 1)
        self.assertTrue(payload["images"][0].startswith("data:image/png;base64,"))

    def test_build_payload_caps_references_at_three(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(api_key="ms-token")
        payload = generator.build_payload(
            prompt="多图编辑",
            reference_image_paths=[self.ref_path] * 4,
        )
        self.assertEqual(len(payload["images"]), 3)
        self.assertNotIn("size", payload)

    async def test_submit_then_poll_success(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(
            api_key="ms-token", poll_interval=0, max_poll_attempts=1
        )

        submit = _FakeSession({"task_id": "task-9"})
        with patch(
            "tools.image_generator_qwen_image_edit_modelscope_api.aiohttp.ClientSession",
            return_value=submit,
        ):
            task_id = await generator.create_edit_task(
                prompt="换成白底", reference_image_paths=[self.ref_path]
            )
        self.assertEqual(task_id, "task-9")
        method, url, kwargs = submit.calls[0]
        self.assertEqual(method, "post")
        self.assertEqual(url, "https://api-inference.modelscope.cn/v1/images/generations")
        self.assertEqual(kwargs["headers"]["X-ModelScope-Async-Mode"], "true")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer ms-token")
        self.assertEqual(kwargs["json"]["model"], "Qwen/Qwen-Image-Edit-2509")

        poll = _FakeSession({"task_status": "SUCCEED", "output_images": ["https://example.com/out.png"]})
        with patch(
            "tools.image_generator_qwen_image_edit_modelscope_api.aiohttp.ClientSession",
            return_value=poll,
        ):
            image_url = await generator.query_edit_task("task-9")
        self.assertEqual(image_url, "https://example.com/out.png")
        method, url, kwargs = poll.calls[0]
        self.assertEqual(method, "get")
        self.assertEqual(url, "https://api-inference.modelscope.cn/v1/tasks/task-9")
        self.assertEqual(kwargs["headers"]["X-ModelScope-Task-Type"], "image_generation")

    async def test_full_flow_returns_url_output(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(
            api_key="ms-token", poll_interval=0, max_poll_attempts=1
        )
        submit = _FakeSession({"task_id": "t-1"})
        poll = _FakeSession({"task_status": "SUCCEED", "output_images": ["https://example.com/out.png"]})
        with patch(
            "tools.image_generator_qwen_image_edit_modelscope_api.aiohttp.ClientSession",
            side_effect=[submit, poll],
        ):
            output = await generator.generate_single_image(
                prompt="换成白底", reference_image_paths=[self.ref_path], size="1024x1024"
            )
        self.assertEqual(output.fmt, "url")
        self.assertEqual(output.data, "https://example.com/out.png")

    async def test_task_failure_raises(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(
            api_key="ms-token", poll_interval=0, max_poll_attempts=1
        )
        fake = _FakeSession({"task_status": "FAILED", "errors": "content filtered"})
        with patch(
            "tools.image_generator_qwen_image_edit_modelscope_api.aiohttp.ClientSession",
            return_value=fake,
        ):
            with self.assertRaises(RuntimeError):
                await generator.query_edit_task("t-1")

    async def test_poll_timeout(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(
            api_key="ms-token", poll_interval=0, max_poll_attempts=1
        )
        fake = _FakeSession({"task_status": "RUNNING"})
        with patch(
            "tools.image_generator_qwen_image_edit_modelscope_api.aiohttp.ClientSession",
            return_value=fake,
        ):
            with self.assertRaises(TimeoutError):
                await generator.query_edit_task("t-1")

    async def test_missing_reference_raises(self):
        generator = ImageGeneratorQwenImageEditModelScopeAPI(api_key="ms-token")
        with self.assertRaises(ValueError):
            await generator.generate_single_image(prompt="编辑", reference_image_paths=[])


if __name__ == "__main__":
    unittest.main()
