import cv2
import numpy as np
from typing import List
import os
import logging

logger = logging.getLogger(__name__)


class StoryboardSplitter:
    """Splits a storyboard image into individual panels by detecting black borders."""

    def __init__(
        self,
        border_color_threshold: int = 50,
        min_panel_area_ratio: float = 0.005,
        padding: int = 5,
    ):
        """
        Args:
            border_color_threshold: Pixel intensity below which is considered 'black' border.
            min_panel_area_ratio: Minimum panel area as fraction of total image area to filter noise.
            padding: Pixels to inset from detected contour to avoid including border in crop.
        """
        self.border_color_threshold = border_color_threshold
        self.min_panel_area_ratio = min_panel_area_ratio
        self.padding = padding

    def split(
        self,
        image_path: str,
        output_dir: str,
    ) -> List[str]:
        """
        Split a storyboard image into individual panel images.

        Args:
            image_path: Path to the storyboard image (PNG/JPG).
            output_dir: Directory to save cropped panel images.

        Returns:
            List of file paths to cropped panel images, ordered left-to-right,
            top-to-bottom.
        """
        os.makedirs(output_dir, exist_ok=True)

        img = cv2.imread(image_path)
        if img is None:
            raise FileNotFoundError(f"Cannot read image at {image_path}")

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape
        total_area = h * w

        # Create binary mask: panel content is white (255), borders are black (0)
        _, binary = cv2.threshold(
            gray, self.border_color_threshold, 255, cv2.THRESH_BINARY
        )

        # Morphological operations to clean up noise and close small gaps
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)

        # Find contours of white regions (panel content)
        contours, _ = cv2.findContours(
            binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        # Filter contours by area and aspect ratio
        panel_rects = []
        for contour in contours:
            x, y, cw, ch = cv2.boundingRect(contour)
            area = cw * ch
            if area < total_area * self.min_panel_area_ratio:
                continue
            aspect_ratio = cw / ch if ch > 0 else 0
            if aspect_ratio < 0.2 or aspect_ratio > 5.0:
                continue  # Skip very thin strips (likely borders, not panels)
            panel_rects.append((x, y, cw, ch))

        if not panel_rects:
            logger.warning(
                "Contour detection found no panels. "
                "Falling back to uniform 4-column grid split."
            )
            panel_rects = self._fallback_grid_split(h, w)

        # Sort into reading order: group by rows, then left-to-right within each row
        ordered_rects = self._sort_reading_order(panel_rects, h)

        # Crop and save each panel
        panel_paths = []
        for idx, (x, y, cw, ch) in enumerate(ordered_rects):
            x1 = max(0, x + self.padding)
            y1 = max(0, y + self.padding)
            x2 = min(w, x + cw - self.padding)
            y2 = min(h, y + ch - self.padding)

            if x2 <= x1 or y2 <= y1:
                logger.warning(f"Panel {idx} has zero or negative dimensions after padding, skipping.")
                continue

            panel_crop = img[y1:y2, x1:x2]
            panel_path = os.path.join(output_dir, f"panel_{idx:03d}.png")
            cv2.imwrite(panel_path, panel_crop)
            panel_paths.append(panel_path)
            logger.info(f"Saved panel {idx} to {panel_path} (size: {x2-x1}x{y2-y1})")

        print(f"✅ Split storyboard into {len(panel_paths)} panels.")
        return panel_paths

    def _sort_reading_order(
        self,
        panel_rects: List[tuple],
        image_height: int,
    ) -> List[tuple]:
        """Sort panel rectangles into reading order: top-to-bottom rows, left-to-right within rows."""
        if not panel_rects:
            return []

        # Sort by y-coordinate first
        panel_rects = sorted(panel_rects, key=lambda r: r[1])

        # Group into rows by y-coordinate proximity
        row_threshold = image_height * 0.05  # 5% of image height tolerance
        rows = []
        current_row = [panel_rects[0]]

        for rect in panel_rects[1:]:
            if abs(rect[1] - current_row[0][1]) < row_threshold:
                current_row.append(rect)
            else:
                rows.append(sorted(current_row, key=lambda r: r[0]))
                current_row = [rect]
        rows.append(sorted(current_row, key=lambda r: r[0]))

        # Flatten rows into final ordered list
        return [rect for row in rows for rect in row]

    def _fallback_grid_split(
        self,
        image_height: int,
        image_width: int,
        cols: int = 4,
    ) -> List[tuple]:
        """Fallback: split image into a uniform grid of cols columns."""
        panel_w = image_width // cols
        # Estimate rows from aspect ratio of individual panels
        # Assume roughly square panels
        rows = max(1, round(image_height / panel_w))
        panel_h = image_height // rows

        rects = []
        for r in range(rows):
            for c in range(cols):
                x = c * panel_w
                y = r * panel_h
                rects.append((x, y, panel_w, panel_h))

        logger.info(f"Fallback grid: {cols}x{rows} = {len(rects)} panels")
        return rects
