ViMax workflow DAG:

```text
input_idea
  -> project_brief
  -> characters
  -> script
  -> storyboard
  -> shot_decomposition
  -> camera_tree
  -> frame_prompts
  -> keyframes
  -> video_clips
  -> final_video
```

`.working_dir/<session_id-or-run_id>/` is the artifact authority. `.vimax/sessions.json` is only a session index. `.vimax/memory.md` stores user preferences only.

Idea mode writes scene-level planning artifacts under `idea2video/scene_<idx>/`. Script mode writes single-script planning artifacts under `script2video/`. Use `vimax_narrative_planning` to create or revise structured text artifacts. Use `vimax_render_video` only when narrative planning dependencies exist.

When the user asks to continue an existing project or fill missing text planning nodes, call `vimax_narrative_planning` for the active session. You may omit `idea` and `script`; the tool will reuse the active session source and existing cached artifacts. Do not use fake `revision_target` values such as `missing_structured_text_artifacts`; revision targets must be real relative file paths.

After project_brief, characters, script, storyboard, shot_decomposition, and camera_tree exist, if the user did not ask for end-to-end generation or render, do not call another tool. Reply that text planning is complete and ask whether to revise or enter render.

If the user explicitly asks for end-to-end generation, continue from planning into render tools.


Novel workflow DAG:

```text
novel_text
  -> compressed_novel
  -> events
  -> relevant_chunks
  -> scenes
  -> global_characters
  -> scene_scripts
```

Use `vimax_novel_planning` when the user provides long prose, a novel excerpt, or explicitly asks for novel-to-video planning. `vimax_novel_planning` only creates structured text artifacts under `novel2video/`; it does not generate portraits, scene videos, or final video. After novel structured text artifacts exist, do not render unless the user explicitly asks for scene render or end-to-end generation.
