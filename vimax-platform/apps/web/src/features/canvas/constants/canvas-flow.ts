import { RUNNABLE_NODE_TYPE_SET } from "@vimax/contracts";
import {
  ScriptNode,
  CharacterNode,
  StoryboardCellNode,
  ShotNode,
  ImageNode,
  VideoNode,
  AudioNode,
  ConcatNode,
} from "../nodes/CanvasNodes";

export const canvasNodeTypes = {
  script: ScriptNode,
  character: CharacterNode,
  storyboard_cell: StoryboardCellNode,
  shot: ShotNode,
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
  concat: ConcatNode,
};

export const RUNNABLE_TYPES = RUNNABLE_NODE_TYPE_SET;

export type LayoutMode = "zone" | "LR" | "TB";

/** Zoom bounds for the canvas. React Flow's defaults (0.5–2) are too tight
 * for large production graphs; these give near-unlimited range while keeping
 * the transform math stable. */
export const CANVAS_MIN_ZOOM = 0.02;
export const CANVAS_MAX_ZOOM = 8;
