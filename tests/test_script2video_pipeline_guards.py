import tempfile
import unittest
from pathlib import Path

from interfaces import Camera, ShotBriefDescription, ShotDescription
from pipelines.script2video_pipeline import Script2VideoPipeline, _group_shots_into_cameras


class FlakyCameraImageGenerator:
    def __init__(self):
        self.calls = 0

    async def construct_camera_tree(self, cameras, shot_descs):
        self.calls += 1
        if self.calls == 1:
            return ["not-a-camera"]
        return cameras


class Script2VideoPipelineGuardTests(unittest.IsolatedAsyncioTestCase):
    def test_group_shots_into_cameras_does_not_use_camera_idx_as_list_index(self):
        shots = [
            ShotDescription(idx=0, is_last=False, cam_idx=2, visual_desc="a", variation_type="small", variation_reason="same", ff_desc="a", ff_vis_char_idxs=[], lf_desc="a", lf_vis_char_idxs=[], motion_desc="a", audio_desc="none"),
            ShotDescription(idx=1, is_last=True, cam_idx=5, visual_desc="b", variation_type="small", variation_reason="same", ff_desc="b", ff_vis_char_idxs=[], lf_desc="b", lf_vis_char_idxs=[], motion_desc="b", audio_desc="none"),
            ShotDescription(idx=2, is_last=True, cam_idx=2, visual_desc="c", variation_type="small", variation_reason="same", ff_desc="c", ff_vis_char_idxs=[], lf_desc="c", lf_vis_char_idxs=[], motion_desc="c", audio_desc="none"),
        ]
        cameras = _group_shots_into_cameras(shots)
        self.assertEqual([camera.idx for camera in cameras], [2, 5])
        self.assertEqual(cameras[0].active_shot_idxs, [0, 2])
        self.assertEqual(cameras[1].active_shot_idxs, [1])

    async def test_plan_text_artifacts_retries_bad_camera_tree_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            pipeline = Script2VideoPipeline(chat_model=object(), image_generator=object(), video_generator=object(), working_dir=tmp)
            pipeline.camera_image_generator = FlakyCameraImageGenerator()

            async def design_storyboard(script, characters, user_requirement, quiet=False):
                return [{"idx": 0, "is_last": True, "cam_idx": 3, "visual_desc": "wide shot", "audio_desc": "waves"}]

            async def decompose_visual_descriptions(shot_brief_descriptions, characters, quiet=False):
                return [{"idx": 0, "is_last": True, "cam_idx": 3, "visual_desc": "wide shot", "variation_type": "small", "variation_reason": "simple", "ff_desc": "start", "ff_vis_char_idxs": [], "lf_desc": "end", "lf_vis_char_idxs": [], "motion_desc": "walk", "audio_desc": "waves"}]

            pipeline.design_storyboard = design_storyboard
            pipeline.decompose_visual_descriptions = decompose_visual_descriptions
            events = []
            result = await pipeline.plan_text_artifacts(
                "script",
                "req",
                "style",
                characters=[{"idx": 0, "identifier_in_scene": "Man", "is_visible": True, "static_features": "adult", "dynamic_features": "coat"}],
                progress=lambda stage, message, metadata=None: events.append(stage),
                quiet=True,
            )

            self.assertEqual(pipeline.camera_image_generator.calls, 2)
            self.assertIn("construct_camera_tree_retry", events)
            self.assertEqual(result["camera_tree"][0].idx, 3)
            self.assertTrue((Path(tmp) / "camera_tree.json").exists())

    async def test_aspect_ratio_nine_sixteen_configuration(self):
        with tempfile.TemporaryDirectory() as tmp:
            captured_image_calls = []
            captured_video_calls = []

            class FakeImageGenerator:
                async def generate_single_image(self, **kwargs):
                    from interfaces.image_output import ImageOutput
                    from PIL import Image
                    captured_image_calls.append(kwargs)
                    return ImageOutput(fmt="pil", ext="png", data=Image.new("RGB", (900, 1600), "blue"))

            class FakeVideoGenerator:
                async def generate_single_video(self, **kwargs):
                    from interfaces.video_output import VideoOutput
                    captured_video_calls.append(kwargs)
                    return VideoOutput(fmt="bytes", ext="mp4", data=b"fake-video")

            pipeline = Script2VideoPipeline(
                chat_model=object(),
                image_generator=FakeImageGenerator(),
                video_generator=FakeVideoGenerator(),
                working_dir=tmp,
                aspect_ratio="9:16",
            )
            self.assertEqual(pipeline.aspect_ratio, "9:16")
            self.assertEqual(pipeline.frame_size, "900x1600")

            # Test generate_and_select_best_image with candidate validation
            img = await pipeline.generate_and_select_best_image(
                prompt="vertical shot",
                reference_image_paths=[],
                reference_image_path_and_text_pairs=[],
                target_description="vertical shot",
                num_candidates=1,
            )
            self.assertEqual(captured_image_calls[0]["aspect_ratio"], "9:16")
            self.assertEqual(captured_image_calls[0]["size"], "900x1600")
            self.assertEqual(img.data.size, (900, 1600))


if __name__ == "__main__":
    unittest.main()
