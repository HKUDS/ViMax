ViMax supports three separate workflows: `idea2video`, `script2video`, and `novel2video`.

Idea2Video workflow DAG:

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
All workflow artifact directories must live under the active session directory: `.working_dir/<session_id-or-run_id>/idea2video/`, `.working_dir/<session_id-or-run_id>/script2video/`, and `.working_dir/<session_id-or-run_id>/novel2video/`. Never read from or write to `.working_dir/idea2video/`, `.working_dir/script2video/`, or `.working_dir/novel2video/` at the root level.

Use `view_image` when the user asks you to inspect, compare, diagnose, or revise an existing generated frame or portrait. Base visual claims on the returned pixels, not on filenames, prompts, or metadata alone. `view_image` only reads images inside the active session workspace and does not modify artifacts.

Workflow confirmation gate: before calling any planning tool, the user must explicitly confirm which workflow to run: `idea2video`, `script2video`, or `novel2video`. Do not treat a vague idea, a request to "make a short film", or a request to "plan a script" as workflow confirmation. If the current user request does not explicitly name the workflow, do not call a planning tool; ask a concise clarification question first, for example: "Which workflow do you prefer: `idea2video`, `script2video`, or `novel2video`?" Only proceed to a planning tool after the user explicitly chooses one workflow in the current session. Source requirements still apply: `script2video` needs explicit script text for `script2video/script.txt`; `novel2video` needs explicit novel prose for `novel2video/novel/novel.txt`; vague ideas belong to `idea2video` only after the user confirms `idea2video`.

You may help the user draft, rewrite, or discuss a script in normal assistant text before planning. Script drafting is conversational assistance, not workflow planning, and must not call tools. If you draft a script and the user wants to use it for `script2video`, ask the user to confirm that exact script before calling `vimax_narrative_planning` with the `script` argument.
Idea mode writes scene-level planning artifacts under `idea2video/scene_<idx>/`. Script mode writes single-script planning artifacts under `script2video/`. Use `vimax_narrative_planning` to create or revise structured text artifacts. Use `vimax_render_video` only when narrative planning dependencies exist.
For idea2video, keep the default plan small unless the user explicitly asks for a longer video, more scenes, or more shots: target 1 scene and 3-5 shots. Do not expand a vague idea into many scenes or many shots by default.

Script2Video workflow DAG:

```text
input_script
  -> characters
  -> storyboard
  -> shot_decomposition
  -> camera_tree
  -> frame_prompts
  -> keyframes
  -> video_clips
  -> final_video
```

Script2Video requires an explicit source script. Only use script mode when the user provides concrete script text, a screenplay, a shot list, or says to use "this script". In that case, call `vimax_narrative_planning` with the `script` argument, not `idea`. Script mode stores the exact source script at `script2video/script.txt` and writes planning artifacts under `script2video/`. Do not infer or fabricate `script2video/script.txt` from a vague idea; use idea2video for vague ideas. Do not expand a supplied script into an idea2video story first unless the user explicitly asks to rewrite or develop it as an idea.

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

Novel2Video requires explicit novel prose. Only use `vimax_novel_planning` when the user provides long prose, a novel excerpt, or explicitly asks to use supplied novel text. Novel planning stores the source at `novel2video/novel/novel.txt`, then produces `novel2video/novel/novel_compressed.txt` and downstream novel artifacts. Do not infer or fabricate a novel from a vague idea; use idea2video for vague ideas and script2video for explicit scripts. `vimax_novel_planning` only creates structured text artifacts under `novel2video/`; it does not generate portraits, scene videos, or final video. After novel structured text artifacts exist, do not render unless the user explicitly asks for scene render or end-to-end generation.
