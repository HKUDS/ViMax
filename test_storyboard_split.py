"""
Test script for storyboard panel splitting.

Usage:
    python test_storyboard_split.py <image_path> [output_dir]

Examples:
    python test_storyboard_split.py my_storyboard.png
    python test_storyboard_split.py my_storyboard.png ./cropped_panels
"""

import sys
import os
from utils.storyboard_splitter import StoryboardSplitter


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_storyboard_split.py <image_path> [output_dir]")
        sys.exit(1)

    image_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "./split_panels_output"

    if not os.path.isfile(image_path):
        print(f"Error: File not found: {image_path}")
        sys.exit(1)

    splitter = StoryboardSplitter()
    panel_paths = splitter.split(image_path, output_dir)

    print(f"\nResults:")
    print(f"  Input:  {image_path}")
    print(f"  Output: {output_dir}")
    print(f"  Panels: {len(panel_paths)}")
    for path in panel_paths:
        print(f"    - {path}")


if __name__ == "__main__":
    main()
