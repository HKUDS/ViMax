import io
import unittest

from PIL import Image, ImageDraw

from vimax_image_worker.handler import (
    compose_edit_prompt,
    png_ai_metadata,
    remove_background,
)


def _product_image(size: int = 100, subject: int = 60) -> Image.Image:
    img = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(img)
    x0 = (size - subject) // 2
    draw.rectangle([x0, x0, x0 + subject, x0 + subject], fill="black")
    return img


class RemoveBackgroundTest(unittest.TestCase):
    def test_corners_transparent_center_opaque(self):
        out = remove_background(_product_image())
        self.assertEqual(out.mode, "RGBA")
        self.assertEqual(out.getpixel((0, 0))[3], 0)
        self.assertEqual(out.getpixel((50, 50))[3], 255)

    def test_only_largest_component_survives(self):
        img = _product_image()
        ImageDraw.Draw(img).rectangle([0, 0, 5, 5], fill="black")
        out = remove_background(img)
        self.assertEqual(out.getpixel((2, 2))[3], 0)
        self.assertEqual(out.getpixel((50, 50))[3], 255)


class EditPromptTest(unittest.TestCase):
    def test_each_op_appends_its_constraint(self):
        keywords = {
            "inpaint": "masked region",
            "outpaint": "original frame",
            "replace_bg": "background only",
        }
        for op, keyword in keywords.items():
            prompt = compose_edit_prompt("studio shot", op)
            self.assertTrue(prompt.startswith("studio shot"))
            self.assertIn(keyword, prompt)

    def test_no_op_keeps_prompt_unchanged(self):
        self.assertEqual(compose_edit_prompt("studio shot", None), "studio shot")


class PngAiMetadataTest(unittest.TestCase):
    def test_marks_ai_generated_and_truncates_prompt(self):
        buf = io.BytesIO()
        Image.new("RGB", (4, 4), "white").save(buf, format="PNG", pnginfo=png_ai_metadata("x" * 600))
        with Image.open(buf) as img:
            self.assertEqual(img.text["AI-Generated"], "true")
            self.assertEqual(len(img.text["Prompt"]), 512)


if __name__ == "__main__":
    unittest.main()
