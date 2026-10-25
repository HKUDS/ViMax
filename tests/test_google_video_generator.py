import base64
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from google.genai import errors
from interfaces.video_output import VideoOutput
from tools.video_generator_veo_google_api import VideoGeneratorVeoGoogleAPI, _sanitize_error_text


class GoogleVideoGeneratorTests(unittest.IsolatedAsyncioTestCase):
    def test_sanitize_error_text_redacts_keys(self):
        err = "Failed with key AIzaSyA123456789012345678901234567890 and AQ.Ab8RN6Lluqw66Ls0Y7eiYQTxI9klLZLnoN2I"
        sanitized = _sanitize_error_text(err)
        self.assertNotIn("AIzaSy", sanitized)
        self.assertNotIn("AQ.Ab8RN6", sanitized)
        self.assertIn("[REDACTED_KEY]", sanitized)

    async def test_generate_text_to_video_omni(self):
        generator = VideoGeneratorVeoGoogleAPI(api_key="secret-key")
        
        fake_video_bytes = b"fake-omni-mp4"
        fake_interaction = SimpleNamespace(
            output_video=SimpleNamespace(data=base64.b64encode(fake_video_bytes).decode("ascii"), uri=None)
        )
        mock_create = MagicMock(return_value=fake_interaction)
        generator.client = SimpleNamespace(interactions=SimpleNamespace(create=mock_create))

        progress_events = []
        result = await generator.generate_single_video(
            prompt="A cinematic sunset",
            reference_image_paths=[],
            resolution="720p",
            aspect_ratio="16:9",
            duration=8,
            progress=lambda s, m, meta: progress_events.append((s, m, meta)),
        )

        self.assertIsInstance(result, VideoOutput)
        self.assertEqual(result.data, fake_video_bytes)
        self.assertEqual(result.ext, "mp4")

        mock_create.assert_called_once()
        kwargs = mock_create.call_args.kwargs
        self.assertEqual(kwargs["model"], "gemini-omni-1.1-flash")
        self.assertEqual(kwargs["response_format"]["type"], "video")
        self.assertEqual(kwargs["response_format"]["duration"], 8)
        self.assertEqual(kwargs["response_format"]["resolution"], "720p")
        self.assertEqual(kwargs["response_format"]["aspect_ratio"], "16:9")
        self.assertEqual(kwargs["input"][-1]["text"], "A cinematic sunset")
        self.assertTrue(any(e[0] == "video_create" for e in progress_events))
        self.assertTrue(any(e[0] == "video_completed" for e in progress_events))

    async def test_generate_first_frame_to_video_omni(self):
        generator = VideoGeneratorVeoGoogleAPI(api_key="secret-key")

        fake_video_bytes = b"fake-first-frame-mp4"
        fake_interaction = SimpleNamespace(
            output_video=SimpleNamespace(data=base64.b64encode(fake_video_bytes).decode("ascii"), uri=None)
        )
        mock_create = MagicMock(return_value=fake_interaction)
        mock_upload = MagicMock(return_value=SimpleNamespace(uri="https://generativelanguage.googleapis.com/files/img1", mime_type="image/png"))
        generator.client = SimpleNamespace(
            interactions=SimpleNamespace(create=mock_create),
            files=SimpleNamespace(upload=mock_upload)
        )

        result = await generator.generate_single_video(
            prompt="Camera pans left",
            reference_image_paths=["/tmp/frame1.png"],
            resolution="1080p",
            aspect_ratio="16:9",
            duration=5,
        )

        self.assertIsInstance(result, VideoOutput)
        self.assertEqual(result.data, fake_video_bytes)
        mock_upload.assert_called_once_with(file="/tmp/frame1.png")
        kwargs = mock_create.call_args.kwargs
        self.assertEqual(len(kwargs["input"]), 2)
        self.assertEqual(kwargs["input"][0]["type"], "image")
        self.assertEqual(kwargs["input"][0]["uri"], "https://generativelanguage.googleapis.com/files/img1")
        self.assertEqual(kwargs["input"][1]["text"], "<FIRST_FRAME> Camera pans left")
        self.assertEqual(kwargs["response_format"]["duration"], 5)
        self.assertEqual(kwargs["response_format"]["resolution"], "1080p")

    async def test_generate_first_and_last_frame_interpolation_omni(self):
        generator = VideoGeneratorVeoGoogleAPI(api_key="secret-key")

        fake_video_bytes = b"fake-interp-mp4"
        fake_interaction = SimpleNamespace(
            output_video=SimpleNamespace(data=None, uri="https://generativelanguage.googleapis.com/files/vidout")
        )
        mock_create = MagicMock(return_value=fake_interaction)
        mock_upload = MagicMock(side_effect=[
            SimpleNamespace(uri="https://generativelanguage.googleapis.com/files/img1", mime_type="image/png"),
            SimpleNamespace(uri="https://generativelanguage.googleapis.com/files/img2", mime_type="image/png"),
        ])
        mock_download = MagicMock(return_value=fake_video_bytes)
        generator.client = SimpleNamespace(
            interactions=SimpleNamespace(create=mock_create),
            files=SimpleNamespace(upload=mock_upload, download=mock_download),
        )

        result = await generator.generate_single_video(
            prompt="Smooth morphing scene",
            reference_image_paths=["/tmp/start.png", "/tmp/end.png"],
            duration=12,  # Should clamp to 10
        )

        self.assertIsInstance(result, VideoOutput)
        self.assertEqual(result.data, fake_video_bytes)
        self.assertEqual(mock_upload.call_count, 2)
        kwargs = mock_create.call_args.kwargs
        self.assertEqual(len(kwargs["input"]), 3)
        self.assertEqual(kwargs["input"][2]["text"], "<FIRST_FRAME> <LAST_FRAME> Smooth morphing scene")
        self.assertEqual(kwargs["response_format"]["duration"], 10)  # Clamped to 10
        mock_download.assert_called_once_with(file="https://generativelanguage.googleapis.com/files/vidout")


if __name__ == "__main__":
    unittest.main()

