import os
import unittest
from unittest.mock import patch

from PIL import Image

from tools.image_orientation import ensure_not_portrait, landscape_guard_requested


class ImageOrientationTests(unittest.TestCase):
    def test_landscape_guard_requested_defaults_to_all_images(self):
        self.assertTrue(landscape_guard_requested(size="1600x900"))
        self.assertTrue(landscape_guard_requested(size="512x512"))
        self.assertTrue(landscape_guard_requested(size=None))
        self.assertTrue(landscape_guard_requested(aspect_ratio="16:9", enforce_landscape=False))
        self.assertFalse(landscape_guard_requested(allow_portrait=True))

    def test_portrait_detection_allows_slightly_tall_images(self):
        ensure_not_portrait(Image.new("RGB", (1000, 1040)))
        with self.assertRaises(ValueError):
            ensure_not_portrait(Image.new("RGB", (1000, 1100)))

    def test_portrait_tolerance_env_override(self):
        with patch.dict(os.environ, {"VIMAX_IMAGE_PORTRAIT_RETRY_TOLERANCE": "1.20"}):
            ensure_not_portrait(Image.new("RGB", (1000, 1100)))


if __name__ == "__main__":
    unittest.main()
