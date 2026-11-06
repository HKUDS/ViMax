"""Smoke-test the ViMax agent bridge against the real framework.

Run inside the ViMax framework environment (the one the worker uses via
VIMAX_ROOT), not the bare worker venv:

    VIMAX_ROOT=. python ../workers/image/scripts/smoke_agent_bridge.py

Verifies that (1) every bridged agent imports, (2) the pipeline dispatch
table covers all job types, and (3) one instance-model bridge works
end-to-end with a fake chat model (no network, no API key).
"""
import asyncio
import json
import os
import sys
from pathlib import Path

VIMAX_ROOT = Path(os.environ.get("VIMAX_ROOT", ".")).resolve()
sys.path.insert(0, str(VIMAX_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vimax_image_worker import pipeline_handler, vimax_bridge  # noqa: E402

EXPECTED_JOB_TYPES = {
    "pipeline.script2storyboard",
    "pipeline.story_push",
    "pipeline.idea2script",
    "pipeline.script2characters",
    "pipeline.plan_script",
    "pipeline.enhance_script",
    "pipeline.novel2scenes",
    "pipeline.select_reference",
    "pipeline.select_best_image",
    "pipeline.camera_tree",
    "pipeline.character_portraits",
}


def check_imports() -> None:
    # The orphaned agents are not re-exported from agents/__init__ — the
    # bridge imports them from their submodules, so verify the same way.
    from agents.best_image_selector import BestImageSelector  # noqa: F401
    from agents.camera_image_generator import CameraImageGenerator  # noqa: F401
    from agents.character_extractor import CharacterExtractor  # noqa: F401
    from agents.character_portraits_generator import CharacterPortraitsGenerator  # noqa: F401
    from agents.event_extractor import EventExtractor  # noqa: F401
    from agents.global_information_planner import GlobalInformationPlanner  # noqa: F401
    from agents.novel_compressor import NovelCompressor  # noqa: F401
    from agents.reference_image_selector import ReferenceImageSelector  # noqa: F401
    from agents.scene_extractor import SceneExtractor  # noqa: F401
    from agents.script_enhancer import ScriptEnhancer  # noqa: F401
    from agents.script_planner import ScriptPlanner  # noqa: F401
    from agents.screenwriter import Screenwriter  # noqa: F401
    from agents.storyboard_artist import StoryboardArtist  # noqa: F401
    from interfaces import (  # noqa: F401
        Camera,
        CharacterInScene,
        Event,
        Scene,
        ShotBriefDescription,
    )
    print("[ok] all 13 agents + interfaces import")


def check_dispatch_table() -> None:
    assert set(pipeline_handler.PIPELINE_JOB_HANDLERS) == EXPECTED_JOB_TYPES
    print(f"[ok] dispatch table covers {len(EXPECTED_JOB_TYPES)} job types")


async def check_extract_characters_end_to_end() -> None:
    from langchain_core.messages import AIMessage
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    fake_response = json.dumps(
        {
            "characters": [
                {
                    "idx": 0,
                    "identifier_in_scene": "Alice",
                    "is_visible": True,
                    "static_features": "Long blonde hair, blue eyes, slender build.",
                    "dynamic_features": "Wearing a red coat.",
                }
            ]
        },
        ensure_ascii=False,
    )
    fake_model = GenericFakeChatModel(messages=iter([AIMessage(content=fake_response)]))

    original = vimax_bridge.init_chat_model_from_credential
    vimax_bridge.init_chat_model_from_credential = lambda _credential: fake_model
    try:
        characters = await vimax_bridge.extract_characters(
            "<SCRIPT>Alice enters the cafe.</SCRIPT>",
            {"api_key": "fake", "model": "fake"},
        )
    finally:
        vimax_bridge.init_chat_model_from_credential = original

    assert characters == [
        {
            "name": "Alice",
            "description": "Long blonde hair, blue eyes, slender build.",
            "static_features": "Long blonde hair, blue eyes, slender build.",
            "dynamic_features": "Wearing a red coat.",
            "is_visible": True,
        }
    ]
    print("[ok] CharacterExtractor bridge end-to-end with fake model")


def main() -> None:
    check_imports()
    check_dispatch_table()
    asyncio.run(check_extract_characters_end_to_end())
    print("SMOKE OK")


if __name__ == "__main__":
    main()
