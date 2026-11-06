"""Marketplace compliance checks for product images (image.compliance jobs).

纯像素启发式（无 OCR、无模型调用），规则表整理自各电商平台主图规范。
"""

from __future__ import annotations

from PIL import Image, ImageChops

PLATFORM_RULES: dict[str, dict] = {
    "amazon": {
        "min_side": 1000,
        "white_background": True,
        "min_subject_ratio": 0.85,
        "text_review": True,
    },
    "tiktok_shop": {"min_side": 600, "white_background": True, "aspect_ratios": ((1, 1),)},
    "shopee": {"min_side": 500, "aspect_ratios": ((1, 1),)},
    "shopify": {"min_side": 1000, "aspect_ratios": ((1, 1), (4, 5))},
}

EDGE_BAND_PX = 8
WHITE_TOLERANCE = 10
WHITE_BACKGROUND_PASS_RATIO = 0.95
ASPECT_TOLERANCE = 0.02


def white_background_ratio(img: Image.Image, tolerance: int = WHITE_TOLERANCE) -> float:
    """Fraction of near-white pixels within the 8px border band."""
    rgb = img.convert("RGB")
    width, height = rgb.size
    band = EDGE_BAND_PX
    strips = [
        rgb.crop((0, 0, width, band)),
        rgb.crop((0, height - band, width, height)),
        rgb.crop((0, band, band, height - band)),
        rgb.crop((width - band, band, width, height - band)),
    ]
    total = sum(strip.width * strip.height for strip in strips)
    near_white = sum(_near_white_count(strip, tolerance) for strip in strips)
    return near_white / total


def subject_bbox_ratio(img: Image.Image, tolerance: int = WHITE_TOLERANCE) -> float:
    """Area of the non-white bounding box over total image area."""
    distance = _white_distance(img)
    mask = distance.point(lambda v: 255 if v > tolerance else 0)
    bbox = mask.getbbox()
    if bbox is None:
        return 0.0
    width, height = img.size
    return ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / (width * height)


def evaluate_platform(img: Image.Image, platform: str) -> dict:
    rules = PLATFORM_RULES.get(platform)
    if rules is None:
        return {
            "platform": platform,
            "passed": False,
            "checks": [
                {
                    "id": "platform_supported",
                    "label": f"Platform '{platform}' is supported",
                    "passed": False,
                }
            ],
        }

    width, height = img.size
    checks: list[dict] = []

    min_side = rules["min_side"]
    checks.append(
        {
            "id": "min_size",
            "label": f"Minimum side {min_side}px",
            "passed": min(width, height) >= min_side,
            "detail": f"{width}x{height}",
        }
    )

    if rules.get("white_background"):
        ratio = white_background_ratio(img)
        checks.append(
            {
                "id": "white_background",
                "label": "Pure white background",
                "passed": ratio >= WHITE_BACKGROUND_PASS_RATIO,
                "detail": f"edge band near-white ratio {ratio:.2f}",
            }
        )

    if "min_subject_ratio" in rules:
        ratio = subject_bbox_ratio(img)
        required = rules["min_subject_ratio"]
        checks.append(
            {
                "id": "subject_coverage",
                "label": f"Subject fills at least {required:.0%} of the frame",
                "passed": ratio >= required,
                "detail": f"subject bbox ratio {ratio:.2f}",
            }
        )

    if "aspect_ratios" in rules:
        targets = " or ".join(f"{w}:{h}" for w, h in rules["aspect_ratios"])
        matched, detail = _aspect_check(width, height, rules["aspect_ratios"])
        checks.append(
            {
                "id": "aspect_ratio",
                "label": f"Aspect ratio {targets} (±2%)",
                "passed": matched,
                "detail": detail,
            }
        )

    if rules.get("text_review"):
        # 无 OCR，无法机器判定主图文字；诚实降级为人工复核，不据此判失败。
        checks.append(
            {
                "id": "no_text_overlay",
                "label": "Main image must not contain text",
                "passed": True,
                "manual_review": True,
                "detail": "no OCR in worker; human review required",
            }
        )

    return {
        "platform": platform,
        "passed": all(check["passed"] for check in checks),
        "checks": checks,
    }


def evaluate_platforms(img: Image.Image, platforms: list[str]) -> list[dict]:
    return [evaluate_platform(img, platform) for platform in platforms]


def _white_distance(img: Image.Image) -> Image.Image:
    """Per-pixel max channel distance from pure white, as an L-mode image."""
    rgb = img.convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, "white"))
    r, g, b = diff.split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b)


def _near_white_count(img: Image.Image, tolerance: int) -> int:
    histogram = _white_distance(img).histogram()
    return sum(histogram[: tolerance + 1])


def _aspect_check(width: int, height: int, ratios: tuple) -> tuple[bool, str]:
    actual = width / height
    detail = f"actual {width}:{height}"
    for target_w, target_h in ratios:
        target = target_w / target_h
        if abs(actual - target) / target <= ASPECT_TOLERANCE:
            return True, detail
    return False, detail
