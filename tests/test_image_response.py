import base64
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image

from tools.image_response import image_from_response_part


class ImageResponseTests(unittest.TestCase):
    def test_extracts_image_when_part_has_no_as_image_method(self):
        expected = Image.new("RGB", (1, 1), (255, 0, 0))
        with patch("tools.image_response.Image.open", return_value=expected):
            part = SimpleNamespace(inline_data=SimpleNamespace(data=b"fake-png"))
            image = image_from_response_part(part)
        self.assertEqual(image.size, (1, 1))

    def test_extracts_base64_data_url(self):
        expected = Image.new("RGB", (1, 1), (255, 0, 0))
        payload = "data:image/png;base64," + base64.b64encode(b"fake-png").decode("ascii")
        with patch("tools.image_response.Image.open", return_value=expected):
            part = {"inline_data": {"data": payload}}
            image = image_from_response_part(part)
        self.assertEqual(image.size, (1, 1))


if __name__ == "__main__":
    unittest.main()
