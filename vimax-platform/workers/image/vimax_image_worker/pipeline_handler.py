"""Pipeline job handler — every ViMax agent exposed as one job type."""
import asyncio
import shutil
import tempfile
from pathlib import Path

from vimax_image_worker.asset_downloader import download_objects
from vimax_image_worker.asset_uploader import upload_file
from vimax_image_worker.reporter import JobReporter
from vimax_image_worker import vimax_bridge
from vimax_image_worker.worker_retry import retry_backoff_seconds, should_retry
import asyncio


async def handle_pipeline_job(payload: dict, reporter: JobReporter):
    """Dispatch a pipeline job to its agent bridge by job_type."""
    job_type = payload.get("job_type", "")
    handler = PIPELINE_JOB_HANDLERS.get(job_type)
    if handler is None:
        await reporter.started()
        await reporter.failed(
            error_code="worker.unknown_job_type",
            error_message=f"Unknown pipeline job type: {job_type}",
            retryable=False,
        )
        return

    await reporter.started()

    try:
        result = await handler(payload, reporter)
        await reporter.completed(_json_output(result))
    except Exception as e:
        attempt = int(payload.get("attempt", 0))
        if should_retry(attempt, retryable=True):
            await asyncio.sleep(retry_backoff_seconds(attempt))
            retry_payload = {**payload, "attempt": attempt + 1}
            reporter.requeue("vimax:queue:q.pipeline.full", retry_payload)
            return
        await reporter.failed(error_code="worker.internal", error_message=str(e), retryable=True)


def _json_output(result: dict) -> dict:
    return {
        "storage_key": "",
        "width": 0,
        "height": 0,
        "sha256": "",
        "mime_type": "application/json",
        "size_bytes": 0,
        **result,
    }


def _input(payload: dict) -> dict:
    return payload.get("input") or {}


def _credential(payload: dict) -> dict:
    return payload.get("credential") or {}


def _workdir(payload: dict) -> Path:
    return Path(tempfile.mkdtemp(prefix=f"vimax-{payload['job_id']}-"))


# ── Job handlers ────────────────────────────────────────────────────


async def _script2storyboard(payload: dict, reporter: JobReporter) -> dict:
    """StoryboardArtist.design_storyboard → cells（沿用既有 cells 回流通道）。"""
    content = _input(payload)["content"]
    cells = await vimax_bridge.design_storyboard_cells(
        content,
        _credential(payload),
        characters=_input(payload).get("characters"),
        user_requirement=_input(payload).get("user_requirement"),
    )
    return {"cells": cells}


async def _story_push(payload: dict, reporter: JobReporter) -> dict:
    """ScriptPlanner 延展剧情 + StoryboardArtist 生成分镜（剧情推演）。"""
    data = _input(payload)
    cells = await vimax_bridge.story_push_cells(
        _credential(payload),
        ff_desc=data.get("ff_desc", ""),
        lf_desc=data.get("lf_desc", ""),
        motion_desc=data.get("motion_desc", ""),
        user_requirement=data.get("user_requirement"),
        characters=data.get("characters"),
    )
    return {"cells": cells}


async def _idea2script(payload: dict, reporter: JobReporter) -> dict:
    """Screenwriter 两段式：创意 → 故事 → 场景剧本。"""
    data = _input(payload)
    return await vimax_bridge.idea2script(
        data.get("idea") or data.get("content", ""),
        _credential(payload),
        user_requirement=data.get("user_requirement"),
    )


async def _script2characters(payload: dict, reporter: JobReporter) -> dict:
    """CharacterExtractor：剧本 → 角色清单。"""
    characters = await vimax_bridge.extract_characters(
        _input(payload)["content"], _credential(payload)
    )
    return {"characters": characters}


async def _plan_script(payload: dict, reporter: JobReporter) -> dict:
    """ScriptPlanner：基础创意 → 详细剧本。"""
    data = _input(payload)
    planned = await asyncio.to_thread(
        vimax_bridge.plan_script,
        data.get("idea") or data.get("content", ""),
        _credential(payload),
    )
    return {"planned_script": planned}


async def _enhance_script(payload: dict, reporter: JobReporter) -> dict:
    """ScriptEnhancer：连续性与细节润色。"""
    enhanced = await vimax_bridge.enhance_script(
        _input(payload)["content"], _credential(payload)
    )
    return {"enhanced_script": enhanced}


async def _novel2scenes(payload: dict, reporter: JobReporter) -> dict:
    """小说改编全链：压缩 → 事件 → 场景 → 角色融合。"""
    data = _input(payload)
    result = await vimax_bridge.novel2scenes(
        data.get("novel_text") or data.get("content", ""),
        _credential(payload),
        max_events=data.get("max_events", 3),
        max_scenes_per_event=data.get("max_scenes_per_event", 2),
    )
    await reporter.progress(90, "Novel chain complete")
    return result


async def _select_reference(payload: dict, reporter: JobReporter) -> dict:
    """ReferenceImageSelector：多模态选参考图并构建生成提示词。"""
    data = _input(payload)
    pairs = data.get("reference_pairs") or []
    workdir = _workdir(payload)
    try:
        keys = [pair["storage_key"] for pair in pairs]
        paths = download_objects(keys, workdir, bucket=payload["callback"]["upload_bucket"])
        selected = await vimax_bridge.select_reference_images(
            list(zip(paths, [pair.get("text", "") for pair in pairs])),
            data["target_description"],
            _credential(payload),
        )
        selected["ref_storage_keys"] = [
            keys[index] for index in selected.get("ref_indices", []) if index < len(keys)
        ]
        return {"reference_plan": selected}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def _select_best_image(payload: dict, reporter: JobReporter) -> dict:
    """BestImageSelector：按与参考图/描述的一致性为候选图选优。"""
    data = _input(payload)
    candidate_keys = data.get("candidate_storage_keys") or []
    ref_pairs = data.get("reference_pairs") or []
    workdir = _workdir(payload)
    try:
        bucket = payload["callback"]["upload_bucket"]
        ref_keys = [pair["storage_key"] for pair in ref_pairs]
        ref_paths = download_objects(ref_keys, workdir, bucket=bucket)
        candidate_paths = download_objects(candidate_keys, workdir, bucket=bucket)
        selected = await vimax_bridge.select_best_image(
            list(zip(ref_paths, [pair.get("text", "") for pair in ref_pairs])),
            data["target_description"],
            candidate_paths,
            _credential(payload),
        )
        selected["best_storage_key"] = candidate_keys[selected["best_index"]]
        return {"best_image": selected}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def _camera_tree(payload: dict, reporter: JobReporter) -> dict:
    """CameraImageGenerator.construct_camera_tree：机位层级规划。"""
    data = _input(payload)
    cameras = await vimax_bridge.construct_camera_tree(
        data.get("cameras") or [],
        data.get("shot_descs") or [],
        _credential(payload),
    )
    return {"camera_tree": cameras}


async def _character_portraits(payload: dict, reporter: JobReporter) -> dict:
    """CharacterPortraitsGenerator：三视图一次生成并上传。"""
    data = _input(payload)
    workdir = _workdir(payload)
    try:
        paths = await vimax_bridge.generate_character_portraits(
            data["character"],
            data.get("style", ""),
            _credential(payload),
            workdir=str(workdir),
        )
        bucket = payload["callback"]["upload_bucket"]
        prefix = payload["callback"]["upload_prefix"]
        portraits = {}
        for view, local_path in paths.items():
            portraits[view] = upload_file(Path(local_path), bucket=bucket, prefix=prefix)
        return {"portraits": portraits}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


PIPELINE_JOB_HANDLERS = {
    "pipeline.script2storyboard": _script2storyboard,
    "pipeline.story_push": _story_push,
    "pipeline.idea2script": _idea2script,
    "pipeline.script2characters": _script2characters,
    "pipeline.plan_script": _plan_script,
    "pipeline.enhance_script": _enhance_script,
    "pipeline.novel2scenes": _novel2scenes,
    "pipeline.select_reference": _select_reference,
    "pipeline.select_best_image": _select_best_image,
    "pipeline.camera_tree": _camera_tree,
    "pipeline.character_portraits": _character_portraits,
}
