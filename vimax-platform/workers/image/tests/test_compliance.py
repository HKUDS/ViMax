import unittest

from PIL import Image, ImageDraw

from vimax_image_worker.compliance import (
    evaluate_platform,
    evaluate_platforms,
    subject_bbox_ratio,
    white_background_ratio,
)


def _product_image(size: tuple[int, int] = (1024, 1024), subject: int = 870) -> Image.Image:
    img = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(img)
    x0 = (size[0] - subject) // 2
    y0 = (size[1] - subject) // 2
    draw.rectangle([x0, y0, x0 + subject, y0 + subject], fill="black")
    return img


class WhiteBackgroundRatioTest(unittest.TestCase):
    def test_white_borders_score_full(self):
        self.assertEqual(white_background_ratio(_product_image()), 1.0)

    def test_colored_border_lowers_score(self):
        img = _product_image()
        ImageDraw.Draw(img).rectangle([0, 0, 1023, 7], fill="red")
        self.assertLess(white_background_ratio(img), 1.0)


class SubjectBboxRatioTest(unittest.TestCase):
    def test_matches_bbox_area_share(self):
        expected = (870 / 1024) ** 2
        self.assertAlmostEqual(subject_bbox_ratio(_product_image()), expected, delta=0.01)

    def test_all_white_image_has_no_subject(self):
        self.assertEqual(subject_bbox_ratio(Image.new("RGB", (512, 512), "white")), 0.0)


class EvaluatePlatformTest(unittest.TestCase):
    def test_amazon_white_bg_passes_but_subject_fails(self):
        report = evaluate_platform(_product_image(), "amazon")
        self.assertFalse(report["passed"])
        checks = {check["id"]: check for check in report["checks"]}
        self.assertTrue(checks["min_size"]["passed"])
        self.assertTrue(checks["white_background"]["passed"])
        self.assertFalse(checks["subject_coverage"]["passed"])
        self.assertTrue(checks["no_text_overlay"]["manual_review"])

    def test_tiktok_square_passes(self):
        self.assertTrue(evaluate_platform(_product_image(), "tiktok_shop")["passed"])

    def test_shopee_min_side(self):
        small = _product_image((499, 499), 400)
        self.assertFalse(evaluate_platform(small, "shopee")["passed"])
        exact = _product_image((500, 500), 400)
        self.assertTrue(evaluate_platform(exact, "shopee")["passed"])

    def test_shopify_accepts_4_5(self):
        portrait = _product_image((1024, 1280), 800)
        self.assertTrue(evaluate_platform(portrait, "shopify")["passed"])

    def test_unknown_platform_fails(self):
        report = evaluate_platform(_product_image(), "ebay")
        self.assertFalse(report["passed"])
        self.assertEqual(report["checks"][0]["id"], "platform_supported")

    def test_evaluate_platforms_keeps_order(self):
        reports = evaluate_platforms(_product_image(), ["amazon", "nope"])
        self.assertEqual([report["platform"] for report in reports], ["amazon", "nope"])


if __name__ == "__main__":
    unittest.main()
