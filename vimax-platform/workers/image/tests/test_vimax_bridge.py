import unittest
import sys
from types import SimpleNamespace
from unittest import mock

from vimax_image_worker.vimax_bridge import (
    credential_chat_model_args,
    map_canvas_characters,
    shot_brief_to_cell,
)


class _ShotBrief:
    def __init__(self):
        self.idx = 2
        self.cam_idx = 1
        self.visual_desc = "Medium shot of <Alice> entering the room."
        self.audio_desc = "[Speaker] Alice (Calm): Hello."


class StoryboardBridgeTest(unittest.TestCase):
    def test_shot_brief_to_cell_maps_vimax_fields(self):
        cell = shot_brief_to_cell(_ShotBrief())

        self.assertEqual(cell["shotBrief"], "Medium shot of <Alice> entering the room.")
        self.assertEqual(cell["cameraIdx"], 1)
        self.assertEqual(cell["shotIdx"], 2)
        self.assertEqual(cell["audioDesc"], "[Speaker] Alice (Calm): Hello.")


class CredentialArgsTest(unittest.TestCase):
    def test_missing_api_key_raises(self):
        with self.assertRaises(ValueError):
            credential_chat_model_args({"model": "gpt-x"})

    def test_missing_model_raises(self):
        with self.assertRaises(ValueError):
            credential_chat_model_args({"api_key": "sk-test"})

    def test_full_credential_maps_agent_args(self):
        args = credential_chat_model_args(
            {
                "api_key": "sk-test",
                "base_url": "https://api.example.com/v1",
                "model": "gpt-x",
                "model_provider": "openai",
            }
        )

        self.assertEqual(
            args,
            {
                "api_key": "sk-test",
                "base_url": "https://api.example.com/v1",
                "chat_model": "gpt-x",
                "model_provider": "openai",
            },
        )

    def test_base_url_defaults_empty(self):
        args = credential_chat_model_args({"api_key": "sk-test", "model": "m"})

        self.assertEqual(args["base_url"], "")
        self.assertEqual(args["model_provider"], "openai")


class MapCanvasCharactersTest(unittest.TestCase):
    def setUp(self):
        class CharacterInScene:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        patcher = mock.patch.dict(
            sys.modules,
            {"interfaces": SimpleNamespace(CharacterInScene=CharacterInScene)},
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_maps_name_and_description(self):
        characters = map_canvas_characters(
            [{"name": "Alice", "description": "Long blonde hair."}]
        )

        self.assertEqual(len(characters), 1)
        self.assertEqual(characters[0].identifier_in_scene, "Alice")
        self.assertEqual(characters[0].static_features, "Long blonde hair.")
        self.assertTrue(characters[0].is_visible)

    def test_fills_defaults_for_blank_entries(self):
        characters = map_canvas_characters([{}])

        self.assertEqual(characters[0].identifier_in_scene, "Character0")
        self.assertIn("Character0", characters[0].static_features)

    def test_none_yields_empty_list(self):
        self.assertEqual(map_canvas_characters(None), [])


if __name__ == "__main__":
    unittest.main()
