import os
import unittest
from unittest import mock

from PIL import Image, ImageStat

from vimax_image_worker.text_renderer import render_text_layers, resolve_font


def _layer(**overrides) -> dict:
    layer = {
        "text": "Hello",
        "x": 0.25,
        "y": 0.25,
        "font_size": 32,
        "color": "#000000",
    }
    layer.update(overrides)
    return layer


class ResolveFontTest(unittest.TestCase):
    def test_env_var_takes_priority(self):
        env = {"SUBTITLE_FONT": "C:/fonts/custom.ttf"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch(
            "os.path.exists", return_value=True
        ):
            self.assertEqual(resolve_font(None), "C:/fonts/custom.ttf")
            self.assertEqual(resolve_font("other.ttf"), "C:/fonts/custom.ttf")

    def test_font_argument_used_when_it_exists(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(resolve_font(__file__), __file__)

    def test_no_font_available_returns_none(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch(
            "os.path.exists", return_value=False
        ):
            self.assertIsNone(resolve_font(None))


class RenderTextLayersTest(unittest.TestCase):
    def test_rendered_text_darkens_target_region(self):
        img = Image.new("RGB", (200, 100), "white")
        out = render_text_layers(img, [_layer()])
        mean = ImageStat.Stat(out.crop((40, 20, 160, 70))).mean
        self.assertLess(sum(mean) / 3, 255.0)

    def test_area_outside_layer_stays_background(self):
        img = Image.new("RGB", (200, 100), "white")
        out = render_text_layers(img, [_layer()])
        mean = ImageStat.Stat(out.crop((0, 0, 20, 20))).mean
        self.assertEqual(mean, [255.0, 255.0, 255.0])

    def test_align_variants_render_without_error(self):
        img = Image.new("RGB", (300, 100), "white")
        for align in ("left", "center", "right"):
            out = render_text_layers(img, [_layer(align=align, x=0.5, y=0.4)])
            self.assertLess(ImageStat.Stat(out.convert("L")).mean[0], 255.0)

    def test_rgba_input_returns_rgb(self):
        img = Image.new("RGBA", (100, 100), "white")
        out = render_text_layers(img, [_layer(font_size=16)])
        self.assertEqual(out.mode, "RGB")


if __name__ == "__main__":
    unittest.main()
