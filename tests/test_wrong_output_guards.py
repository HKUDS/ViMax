"""Regression tests for silent wrong-output bugs in the script2video render path."""

import asyncio
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock

from agents.reference_image_selector import select_pairs_by_indices
from agents.storyboard_artist import validate_char_idxs
from interfaces.camera import Camera
from interfaces.shot_description import ShotDescription
from pipelines.script2video_pipeline import (
    Script2VideoPipeline,
    _collect_priority_shot_idxs,
    _group_shots_into_cameras,
)
from utils.text import safe_path_component


def _shot(idx, cam_idx, variation_type="small", ff_chars=None, lf_chars=None):
    return ShotDescription(
        idx=idx,
        is_last=False,
        cam_idx=cam_idx,
        visual_desc=f"shot {idx}",
        variation_type=variation_type,
        variation_reason="r",
        ff_desc=f"first frame {idx}",
        ff_vis_char_idxs=ff_chars or [],
        lf_desc=f"last frame {idx}",
        lf_vis_char_idxs=lf_chars or [],
        motion_desc="m",
        audio_desc="a",
    )


class TestCameraGrouping(unittest.TestCase):
    def test_out_of_order_camera_indices_group_correctly(self):
        # Shot 0 uses camera 1, shot 1 uses camera 0, shot 2 uses camera 1 again.
        shots = [_shot(0, cam_idx=1), _shot(1, cam_idx=0), _shot(2, cam_idx=1)]
        cameras = _group_shots_into_cameras(shots)
        by_idx = {camera.idx: camera for camera in cameras}
        self.assertEqual(by_idx[1].active_shot_idxs, [0, 2])
        self.assertEqual(by_idx[0].active_shot_idxs, [1])


class TestPriorityShotIdxs(unittest.TestCase):
    def test_priorities_are_shot_indices_not_camera_indices(self):
        # Camera 2 depends on shot 7 of camera 0: shot 7 must be prioritized.
        camera_tree = [
            Camera(idx=0, active_shot_idxs=[7, 8]),
            Camera(idx=2, active_shot_idxs=[9], parent_cam_idx=0, parent_shot_idx=7),
        ]
        self.assertEqual(_collect_priority_shot_idxs(camera_tree), [7])


class TestEventDictsAreInstanceState(unittest.TestCase):
    def _pipeline(self, working_dir):
        return Script2VideoPipeline(
            chat_model=MagicMock(),
            image_generator=MagicMock(),
            video_generator=MagicMock(),
            working_dir=working_dir,
        )

    def test_two_pipelines_do_not_share_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            p1 = self._pipeline(os.path.join(tmp, "a"))
            p2 = self._pipeline(os.path.join(tmp, "b"))
            p1.frame_events[0] = {"first_frame": asyncio.Event()}
            p1.shot_desc_events[0] = asyncio.Event()
            p1.character_portrait_events[0] = asyncio.Event()
            self.assertEqual(p2.frame_events, {})
            self.assertEqual(p2.shot_desc_events, {})
            self.assertEqual(p2.character_portrait_events, {})

    def test_no_class_level_mutable_event_dicts(self):
        for name in ("frame_events", "shot_desc_events", "character_portrait_events"):
            self.assertNotIsInstance(
                Script2VideoPipeline.__dict__.get(name), dict,
                f"{name} must not be shared class state",
            )


class TestResumeIncludesNewCameraReference(unittest.IsolatedAsyncioTestCase):
    async def test_existing_new_camera_image_is_still_offered_to_selector(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Script2VideoPipeline(
                chat_model=MagicMock(),
                image_generator=MagicMock(),
                video_generator=MagicMock(),
                working_dir=tmp,
                num_image_candidates=1,
            )
            shots = [_shot(0, cam_idx=0), _shot(1, cam_idx=1)]
            camera = Camera(
                idx=1, active_shot_idxs=[1],
                parent_cam_idx=0, parent_shot_idx=0,
                missing_info="wrong background",
            )
            parent_done = asyncio.Event()
            parent_done.set()
            pipeline.frame_events = {
                0: {"first_frame": parent_done},
                1: {"first_frame": asyncio.Event()},
            }

            # Resume state: transition video and new-camera image already on disk.
            shot_dir = os.path.join(tmp, "shots", "1")
            os.makedirs(shot_dir, exist_ok=True)
            new_camera_path = os.path.join(shot_dir, "new_camera_1.png")
            open(os.path.join(shot_dir, "transition_video_from_shot_0.mp4"), "wb").close()
            open(new_camera_path, "wb").close()

            selector = AsyncMock(return_value={"reference_image_path_and_text_pairs": [], "text_prompt": "p"})
            pipeline.reference_image_selector = MagicMock(select_reference_images_and_generate_prompt=selector)
            fake_image = MagicMock()
            pipeline.image_generator.generate_single_image = AsyncMock(return_value=fake_image)

            await pipeline.generate_frames_for_single_camera(
                camera=camera,
                shot_descriptions=shots,
                characters=[],
                character_portraits_registry={},
                priority_shot_idxs=[],
            )

            selector.assert_awaited_once()
            offered = selector.await_args.kwargs["available_image_path_and_text_pairs"]
            offered_paths = [pair[0] for pair in offered]
            self.assertIn(new_camera_path, offered_paths,
                          "resumed runs must offer the new-camera reference image to the selector")


class TestCharIdxValidation(unittest.TestCase):
    def test_valid_indices_pass(self):
        validate_char_idxs([0, 1], 2, "ff_vis_char_idxs")

    def test_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            validate_char_idxs([0, 2], 2, "ff_vis_char_idxs")

    def test_negative_rejected(self):
        with self.assertRaises(ValueError):
            validate_char_idxs([-1], 2, "lf_vis_char_idxs")


class TestReferenceSelectorIndices(unittest.TestCase):
    def test_valid_selection(self):
        pairs = [("a.png", "a"), ("b.png", "b")]
        self.assertEqual(select_pairs_by_indices(pairs, [1]), [("b.png", "b")])

    def test_negative_index_rejected(self):
        with self.assertRaises(ValueError):
            select_pairs_by_indices([("a.png", "a")], [-1])

    def test_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            select_pairs_by_indices([("a.png", "a")], [3])


class TestSafePathComponent(unittest.TestCase):
    def test_clean_names_unchanged(self):
        self.assertEqual(safe_path_component("Alice"), "Alice")
        self.assertEqual(safe_path_component("Bob_2"), "Bob_2")

    def test_unicode_names_preserved(self):
        self.assertEqual(safe_path_component("李雷"), "李雷")

    def test_path_separators_removed(self):
        self.assertNotIn("/", safe_path_component("a/b"))
        self.assertNotIn("\\", safe_path_component("a\\b"))

    def test_traversal_neutralized(self):
        cleaned = safe_path_component("../../etc/passwd")
        self.assertNotIn("/", cleaned)
        self.assertFalse(cleaned.startswith("."))

    def test_empty_becomes_placeholder(self):
        self.assertEqual(safe_path_component(""), "unnamed")


if __name__ == "__main__":
    unittest.main()
