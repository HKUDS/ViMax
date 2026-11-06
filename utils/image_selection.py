"""Shared configuration for keyframe candidate generation."""

import os

DEFAULT_IMAGE_CANDIDATES = 2


def validate_image_candidate_count(value: object) -> int:
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if type(value) is not int or value < 1:
        raise ValueError("image_selection.num_candidates must be a positive integer")
    return value


def image_candidate_count_from_config(config: dict) -> int:
    override = os.environ.get("VIMAX_IMAGE_NUM_CANDIDATES")
    if override is not None:
        return validate_image_candidate_count(override)
    section = config.get("image_selection", {})
    if not isinstance(section, dict):
        raise ValueError("image_selection must be a YAML mapping")
    return validate_image_candidate_count(section.get("num_candidates", DEFAULT_IMAGE_CANDIDATES))
