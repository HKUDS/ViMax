# Storyboard2Video Pipeline Specification

## What It Does

A new pipeline that takes a single storyboard image and produces a long-form video. The storyboard image is the **sole source of information** — no text input from the user.

This pipeline becomes the **default entry point** for ViMax. Existing pipelines (Idea2Video, Script2Video) remain accessible via explicit selection.

## Input

- Single image file (PNG/JPG)
- Layout: 4 columns × n rows (max 5 rows, max 20 panels)
- Panels are rectangular/square, uniform size, with clear black frames around each panel
- Content is purely visual — no text annotations
- AI-generated storyboard panels
- Reading order: left-to-right, top-to-bottom

## Output

A long-form video that:
- Faithfully represents the storyboard narrative
- Matches the visual style of the storyboard
- Maintains character consistency across all scenes
- Has system-inferred transitions, audio, and dialogue
- Each panel becomes one scene with multiple shots (count decided by the system)

## Pipeline Steps

### 1. Panel Splitting
Programmatic (OpenCV), not LLM-based. Detect black borders, crop individual panels, order them left-to-right top-to-bottom.

### 2. Holistic Storyboard Analysis
Send all panels to a multimodal LLM. Extract: overall narrative, tone, visual style, genre, narrative arc, setting, themes. This provides global context for all subsequent steps.

### 3. Panel-by-Panel Scene Analysis
For each panel (informed by holistic analysis), extract:
- Scene description
- Environment/setting
- Characters present (appearance, pose, expression, position)
- Camera angle/framing
- Mood
- Implied action/motion
- Implied audio/dialogue
- Narrative continuity with adjacent panels

### 4. Character Identification & Tracking
Across all panels:
- Identify all visually distinct characters
- Assign unique identifiers (e.g., "Character A — woman with red dress and black hair")
- Extract static features (appearance, physique) and dynamic features (clothing, accessories)
- Map which characters appear in which panels
- Handle multiple characters per panel

### 5. Character Portrait Generation
Reuse existing `CharacterPortraitsGenerator`. Generate front/side/back reference portraits for each character, style-matched to the storyboard.

### 6. Script Generation
Convert all visual analysis into a structured screenplay. One scene per panel with environment, characters, action, dialogue, and audio notes. Output must be compatible with existing `Scene` interface.

### 7. Storyboarding (Scene → Shots)
Reuse existing `StoryboardArtist`. Each scene is broken into multiple shots. System decides shot count based on panel content complexity. Original panel images used as additional reference.

### 8. Shot-to-Video Generation
Reuse existing `Script2VideoPipeline` machinery:
- Reference image selection (character portraits + original panels + prior shots)
- Image generation
- Best image selection
- Video generation
- Concatenation into final video

## New Components to Build

| Component | Type | Description |
|---|---|---|
| `StoryboardSplitter` | Utility | OpenCV-based panel detection and cropping |
| `StoryboardAnalyzer` | Agent | Holistic narrative/style/tone analysis |
| `PanelAnalyzer` | Agent | Per-panel scene extraction |
| `VisualCharacterExtractor` | Agent | Cross-panel character identification and tracking |
| `SceneScriptWriter` | Agent | Converts visual analysis into structured screenplay |
| `Storyboard2VideoPipeline` | Pipeline | Orchestrates all steps |
| `main_storyboard2video.py` | Entry Point | Default; prompts user for storyboard image path |
| `configs/storyboard2video.yaml` | Config | Pipeline configuration |

## Existing Components to Reuse

- `CharacterPortraitsGenerator` — feed visual character descriptions
- `StoryboardArtist` — feed generated script + panel images as reference
- `CameraImageGenerator`, `ReferenceImageSelector`, `BestImageSelector` — as-is
- Video/image generator tools — as-is
- `RateLimiter`, `utils/image.py`, `utils/video.py` — as-is
- `interfaces/` models — may need minor extensions

## New Data Models

**StoryboardMeta**: narrative_summary, tone, visual_style, genre, narrative_arc, setting_description, total_panels

**PanelAnalysis**: panel_idx, panel_image_path, scene_description, environment, characters_present, camera_angle, mood, implied_action, implied_audio, narrative_continuity

**VisualCharacter**: identifier, static_features, dynamic_features, panel_appearances

## Configuration

New file `configs/storyboard2video.yaml` — same structure as existing configs. The chat model **must** be multimodal (supports image input).

## Flow Diagram

```
Storyboard Image (4×n grid)
    │
    ▼
Panel Splitting (OpenCV)
    │
    ▼
Holistic Analysis (all panels → narrative, style, tone)
    │
    ▼
Panel-by-Panel Analysis (each panel → scene details)
    │
    ▼
Character ID & Tracking (cross-panel, unique IDs)
    │
    ▼
Character Portraits (front/side/back per character)
    │
    ▼
Script Generation (visual analysis → screenplay)
    │
    ▼
Storyboarding (scene → multiple shots)
    │
    ▼
Shot-to-Video (reference selection → image gen → video gen → concat)
    │
    ▼
Final Video
```
