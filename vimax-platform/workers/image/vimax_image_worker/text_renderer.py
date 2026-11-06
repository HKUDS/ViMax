"""Burn text layers onto images for image.text jobs."""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

# 部署镜像需安装 fonts-noto-cjk；缺失时 PIL 退回内置位图字体，无法渲染 CJK。
FALLBACK_CJK_FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"


def resolve_font(font: str | None) -> str | None:
    """Resolve a font to a file path: SUBTITLE_FONT env wins, then an existing
    file path, then the Noto CJK default. None lets PIL fall back to its bitmap
    font, which cannot render CJK (deployment needs fonts-noto-cjk)."""
    env_font = os.environ.get("SUBTITLE_FONT")
    if env_font and os.path.exists(env_font):
        return env_font
    if font and os.path.exists(font):
        return font
    if os.path.exists(FALLBACK_CJK_FONT):
        return FALLBACK_CJK_FONT
    return None


def render_text_layers(img: Image.Image, layers: list[dict]) -> Image.Image:
    """Composite text layers (x/y normalized 0-1, font_size in px, CSS hex
    color) onto a copy of img; align anchors the text horizontally on x.
    Returns a new RGB image."""
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    width, height = base.size
    for layer in layers:
        font_path = resolve_font(layer.get("font"))
        font = (
            ImageFont.truetype(font_path, layer["font_size"])
            if font_path
            else ImageFont.load_default(size=layer["font_size"])
        )
        text = layer["text"]
        x = layer["x"] * width
        align = layer.get("align") or "left"
        if align == "center":
            x -= draw.textlength(text, font=font) / 2
        elif align == "right":
            x -= draw.textlength(text, font=font)
        draw.text((x, layer["y"] * height), text, font=font, fill=_rgb(layer["color"]))
    return Image.alpha_composite(base, overlay).convert("RGB")


def _rgb(hex_color: str) -> tuple[int, int, int]:
    value = hex_color.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
