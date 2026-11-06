"""Bridge ViMax Python agents into platform pipeline workers."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any

log = logging.getLogger("vimax-bridge")


def ensure_vimax_path() -> str:
    vimax_root = os.environ.get("VIMAX_ROOT", "/app/vimax")
    if vimax_root not in sys.path:
        sys.path.insert(0, vimax_root)
    return vimax_root


def init_chat_model_from_credential(credential: dict[str, Any]):
    ensure_vimax_path()
    from langchain.chat_models import init_chat_model
    from utils.provider_presets import resolve_chat_model_config

    api_key = (credential.get("api_key") or "").strip()
    if not api_key:
        raise ValueError(
            "Missing LLM api_key in job credential; configure API Key on the default text model in Settings > Models"
        )

    init_args = {
        "model": credential.get("model"),
        # Platform vendors may use custom names (e.g. "deepkey") for
        # OpenAI-compatible endpoints; langchain only accepts its built-in
        # provider names, so any explicit base_url routes through "openai".
        "model_provider": "openai" if credential.get("base_url") else (credential.get("model_provider") or "openai"),
        "api_key": api_key,
        "base_url": credential.get("base_url"),
        "temperature": credential.get("temperature", 0.7),
    }
    if not init_args["model"]:
        raise ValueError(
            "Missing LLM model in job credential; set vendor model id on the default text model in Settings > Models"
        )

    resolved = resolve_chat_model_config(init_args)
    return init_chat_model(**resolved)


def map_canvas_characters(raw_characters: list[dict[str, Any]] | None):
    ensure_vimax_path()
    from interfaces import CharacterInScene

    characters = []
    for index, item in enumerate(raw_characters or []):
        name = (item.get("name") or f"Character{index}").strip()
        description = (item.get("description") or "").strip()
        characters.append(
            CharacterInScene(
                idx=index,
                identifier_in_scene=name,
                is_visible=True,
                static_features=description or f"{name} appears in this scene.",
                dynamic_features="",
            )
        )
    return characters


def shot_brief_to_cell(shot) -> dict[str, Any]:
    audio = getattr(shot, "audio_desc", None) or ""
    return {
        "shotBrief": shot.visual_desc,
        "cameraIdx": shot.cam_idx,
        "ffDesc": "",
        "lfDesc": "",
        "motionDesc": "",
        "audioDesc": audio,
        "shotIdx": shot.idx,
    }


async def design_storyboard_cells(
    content: str,
    credential: dict[str, Any],
    *,
    characters: list[dict[str, Any]] | None = None,
    user_requirement: str | None = None,
) -> list[dict[str, Any]]:
    if not content.strip():
        raise ValueError("Script content is empty")

    ensure_vimax_path()
    from agents.storyboard_artist import StoryboardArtist

    chat_model = init_chat_model_from_credential(credential)
    artist = StoryboardArtist(chat_model=chat_model)
    mapped_characters = map_canvas_characters(characters)

    storyboard = await artist.design_storyboard(
        script=content,
        characters=mapped_characters,
        user_requirement=user_requirement,
    )
    if not storyboard:
        raise RuntimeError("StoryboardArtist returned no shots")

    return [shot_brief_to_cell(shot) for shot in storyboard]


# ── Credential args for agents that build their own chat model ──────
#
# ScriptPlanner / ScriptEnhancer / NovelCompressor / EventExtractor /
# SceneExtractor / GlobalInformationPlanner take (api_key, base_url,
# model_name, model_provider) instead of a model instance.


def credential_chat_model_args(credential: dict[str, Any]) -> dict[str, str]:
    api_key = (credential.get("api_key") or "").strip()
    if not api_key:
        raise ValueError(
            "Missing LLM api_key in job credential; configure API Key on the default text model in Settings > Models"
        )
    model = credential.get("model")
    if not model:
        raise ValueError(
            "Missing LLM model in job credential; set vendor model id on the default text model in Settings > Models"
        )
    return {
        "api_key": api_key,
        "base_url": credential.get("base_url") or "",
        "chat_model": model,
        "model_provider": credential.get("model_provider") or "openai",
    }


def _require_text(name: str, value: str | None) -> str:
    if not (value or "").strip():
        raise ValueError(f"{name} is empty")
    return value.strip()


# ── Screenwriter (创意 → 故事 → 剧本) ────────────────────────────────


async def develop_story(
    idea: str,
    credential: dict[str, Any],
    *,
    user_requirement: str | None = None,
) -> str:
    idea = _require_text("Idea", idea)
    ensure_vimax_path()
    from agents.screenwriter import Screenwriter

    screenwriter = Screenwriter(chat_model=init_chat_model_from_credential(credential))
    return await screenwriter.develop_story(idea=idea, user_requirement=user_requirement or "")


async def write_script(
    story: str,
    credential: dict[str, Any],
    *,
    user_requirement: str | None = None,
) -> list[str]:
    story = _require_text("Story", story)
    ensure_vimax_path()
    from agents.screenwriter import Screenwriter

    screenwriter = Screenwriter(chat_model=init_chat_model_from_credential(credential))
    scripts = await screenwriter.write_script_based_on_story(
        story=story, user_requirement=user_requirement or ""
    )
    if not scripts:
        raise RuntimeError("Screenwriter returned no scene scripts")
    return scripts


async def idea2script(
    idea: str,
    credential: dict[str, Any],
    *,
    user_requirement: str | None = None,
) -> dict[str, Any]:
    story = await develop_story(idea, credential, user_requirement=user_requirement)
    scripts = await write_script(story, credential, user_requirement=user_requirement)
    return {"story": story, "scripts": scripts}


# ── CharacterExtractor (剧本 → 角色清单) ─────────────────────────────


def _character_to_dict(character) -> dict[str, Any]:
    return {
        "name": character.identifier_in_scene,
        "description": character.static_features,
        "static_features": character.static_features,
        "dynamic_features": character.dynamic_features,
        "is_visible": character.is_visible,
    }


async def extract_characters(
    content: str,
    credential: dict[str, Any],
) -> list[dict[str, Any]]:
    content = _require_text("Script content", content)
    ensure_vimax_path()
    from agents.character_extractor import CharacterExtractor

    extractor = CharacterExtractor(chat_model=init_chat_model_from_credential(credential))
    characters = await extractor.extract_characters(content)
    if not characters:
        raise RuntimeError("CharacterExtractor returned no characters")
    return [_character_to_dict(character) for character in characters]


# ── ScriptPlanner (创意 → 详细剧本) / ScriptEnhancer (连续性润色) ────


def plan_script(
    basic_idea: str,
    credential: dict[str, Any],
) -> str:
    basic_idea = _require_text("Basic idea", basic_idea)
    ensure_vimax_path()
    from agents.script_planner import ScriptPlanner

    planner = ScriptPlanner(**credential_chat_model_args(credential))
    return planner.plan_script(basic_idea).planned_script


async def enhance_script(
    planned_script: str,
    credential: dict[str, Any],
) -> str:
    planned_script = _require_text("Planned script", planned_script)
    ensure_vimax_path()
    from agents.script_enhancer import ScriptEnhancer

    enhancer = ScriptEnhancer(**credential_chat_model_args(credential))
    return (await enhancer.enhance_script(planned_script)).enhanced_script


async def story_push_cells(
    credential: dict[str, Any],
    *,
    ff_desc: str = "",
    lf_desc: str = "",
    motion_desc: str = "",
    user_requirement: str | None = None,
    characters: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """剧情推演：ScriptPlanner 从当前镜头延展剧情，StoryboardArtist 生成分镜。"""
    current = _require_text(
        "Shot description",
        ff_desc or lf_desc or motion_desc,
    )
    idea = (
        f"Continue the story from this shot. First frame: {ff_desc}. "
        f"Last frame: {lf_desc}. Motion: {motion_desc}."
    )
    planned = await asyncio.to_thread(plan_script, idea, credential)
    requirement = user_requirement or "Push the story forward with exactly 4 following shots."
    return await design_storyboard_cells(
        planned,
        credential,
        characters=characters,
        user_requirement=requirement,
    )


# ── Novel chain (小说 → 压缩 → 事件 → 场景 → 角色融合) ───────────────


def _scene_to_dict(scene) -> dict[str, Any]:
    data = scene.model_dump()
    data["script"] = scene.script
    return data


def compress_novel(
    novel_text: str,
    credential: dict[str, Any],
    *,
    chunk_size: int = 65536,
    chunk_overlap: int = 8192,
) -> str:
    novel_text = _require_text("Novel text", novel_text)
    ensure_vimax_path()
    from agents.novel_compressor import NovelCompressor

    compressor = NovelCompressor(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        **credential_chat_model_args(credential),
    )
    chunks = compressor.split(novel_text)
    compressed = asyncio.run(
        compressor.compress(list(enumerate(chunks)))
    )
    return compressor.aggregate(compressed)


def extract_events(
    novel_text: str,
    credential: dict[str, Any],
    *,
    max_events: int = 8,
) -> list[dict[str, Any]]:
    novel_text = _require_text("Novel text", novel_text)
    ensure_vimax_path()
    from agents.event_extractor import EventExtractor

    extractor = EventExtractor(**credential_chat_model_args(credential))
    events: list = []
    while len(events) < max_events:
        event = extractor.extract_next_event(novel_text, events)
        events.append(event)
        if event.is_last:
            break
    return [event.model_dump() for event in events]


async def extract_scenes_for_event(
    relevant_chunks: list[str],
    event: dict[str, Any],
    credential: dict[str, Any],
    *,
    max_scenes: int = 4,
) -> list[dict[str, Any]]:
    ensure_vimax_path()
    from agents.scene_extractor import SceneExtractor
    from interfaces import Event

    extractor = SceneExtractor(**credential_chat_model_args(credential))
    event_model = Event.model_validate(event)

    scenes: list = []
    while len(scenes) < max_scenes:
        scene = await extractor.get_next_scene(relevant_chunks, event_model, scenes)
        scenes.append(scene)
        if scene.is_last:
            break
    return [_scene_to_dict(scene) for scene in scenes]


def merge_characters(
    scenes: list[dict[str, Any]],
    credential: dict[str, Any],
    *,
    event_idx: int = 0,
) -> list[dict[str, Any]]:
    ensure_vimax_path()
    from agents.global_information_planner import GlobalInformationPlanner
    from interfaces import Scene

    planner = GlobalInformationPlanner(**credential_chat_model_args(credential))
    scene_models = [Scene.model_validate(scene) for scene in scenes]
    merged = planner.merge_characters_across_scenes_in_event(
        event_idx=event_idx, scenes=scene_models
    )
    return [character.model_dump() for character in merged]


async def novel2scenes(
    novel_text: str,
    credential: dict[str, Any],
    *,
    max_events: int = 3,
    max_scenes_per_event: int = 2,
) -> dict[str, Any]:
    """小说改编全链：压缩 → 事件抽取 → 场景转写 → 跨场景角色融合。"""
    compressed = await asyncio.to_thread(compress_novel, novel_text, credential)
    events = await asyncio.to_thread(
        extract_events, compressed, credential, max_events=max_events
    )

    all_scenes: list[dict[str, Any]] = []
    merged_characters: list[dict[str, Any]] = []
    for event in events:
        scenes = await extract_scenes_for_event(
            [compressed], event, credential, max_scenes=max_scenes_per_event
        )
        all_scenes.extend(scenes)
        merged_characters.extend(
            await asyncio.to_thread(merge_characters, scenes, credential, event_idx=event["index"])
        )

    return {
        "compressed_novel": compressed,
        "events": events,
        "scenes": all_scenes,
        "characters": merged_characters,
    }


# ── Vision agents (参考图选择 / 候选图选优) ──────────────────────────
#
# Both need local image files; callers download storage keys into a workdir
# first and pass (path, text) pairs.


async def select_reference_images(
    image_path_and_text_pairs: list[tuple[str, str]],
    frame_description: str,
    credential: dict[str, Any],
) -> dict[str, Any]:
    frame_description = _require_text("Frame description", frame_description)
    if not image_path_and_text_pairs:
        raise ValueError("No reference images provided")
    ensure_vimax_path()
    from agents.reference_image_selector import ReferenceImageSelector

    selector = ReferenceImageSelector(chat_model=init_chat_model_from_credential(credential))
    selected = await selector.select_reference_images_and_generate_prompt(
        image_path_and_text_pairs, frame_description
    )
    # RefImageIndicesAndTextPrompt: ref_image_indices + text_prompt
    return {
        "ref_indices": list(getattr(selected, "ref_image_indices", []) or []),
        "prompt": getattr(selected, "text_prompt", "") or "",
    }


async def select_best_image(
    reference_image_path_and_text_pairs: list[tuple[str, str]],
    target_description: str,
    candidate_image_paths: list[str],
    credential: dict[str, Any],
) -> dict[str, Any]:
    target_description = _require_text("Target description", target_description)
    if not candidate_image_paths:
        raise ValueError("No candidate images provided")
    ensure_vimax_path()
    from agents.best_image_selector import BestImageSelector

    selector = BestImageSelector(chat_model=init_chat_model_from_credential(credential))
    best_path = await selector(
        reference_image_path_and_text_pairs,
        target_description,
        candidate_image_paths,
    )
    best_index = candidate_image_paths.index(best_path)
    return {"best_index": best_index, "best_storage_path": best_path}


# ── CameraImageGenerator (相机树) / CharacterPortraitsGenerator ─────


async def construct_camera_tree(
    cameras: list[dict[str, Any]],
    shot_descs: list[dict[str, Any]],
    credential: dict[str, Any],
) -> list[dict[str, Any]]:
    if not cameras:
        raise ValueError("No cameras provided")
    ensure_vimax_path()
    from agents.camera_image_generator import CameraImageGenerator
    from interfaces import Camera, ShotBriefDescription

    chat_model = init_chat_model_from_credential(credential)
    generator = CameraImageGenerator(
        chat_model=chat_model, image_generator=None, video_generator=None
    )

    camera_models = [Camera.model_validate(camera) for camera in cameras]
    # The platform always sends storyboard briefs (idx/is_last/cam_idx/visual_desc).
    desc_models = [ShotBriefDescription.model_validate(desc) for desc in shot_descs]
    tree = await generator.construct_camera_tree(camera_models, desc_models)
    return [camera.model_dump() for camera in tree]


def build_image_generator(credential: dict[str, Any]):
    from .handler import ImageJobCredential
    from .handler import build_image_generator as _build

    return _build(ImageJobCredential.model_validate(credential))


async def generate_character_portraits(
    character: dict[str, Any],
    style: str,
    credential: dict[str, Any],
    *,
    workdir: str,
) -> dict[str, Any]:
    """三视图一次生成：front → (front 参考) side / back。返回本地文件路径。"""
    ensure_vimax_path()
    from agents.character_portraits_generator import CharacterPortraitsGenerator
    from interfaces import CharacterInScene

    mapped = map_canvas_characters([character])
    if not mapped:
        raise ValueError("Character is empty")
    generator = CharacterPortraitsGenerator(image_generator=build_image_generator(credential))

    front = await generator.generate_front_portrait(mapped[0], style)
    front_path = os.path.join(workdir, "front.png")
    front.save(front_path)

    side = await generator.generate_side_portrait(mapped[0], front_path)
    side_path = os.path.join(workdir, "side.png")
    side.save(side_path)

    back = await generator.generate_back_portrait(mapped[0], front_path)
    back_path = os.path.join(workdir, "back.png")
    back.save(back_path)

    return {"front": front_path, "side": side_path, "back": back_path}
