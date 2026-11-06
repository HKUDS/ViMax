// ── Workbench / Video Track Types ───────────────────────────────────
// Adapted from Toonflow's workbench type system.

// ── Track Types ────────────────────────────────────────────────────

export const TRACK_TYPES = [
  "video",
  "image",
  "audio",
  "subtitle",
  "text",
  "sticker",
  "filter",
  "effect",
  "transition",
] as const;

export type TrackType = (typeof TRACK_TYPES)[number];

// ── Track ──────────────────────────────────────────────────────────

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  order: number;
  isMain?: boolean;
  clips: Clip[];
}

// ── Clip ───────────────────────────────────────────────────────────

export interface Clip {
  id: string;
  trackId: string;
  sourceType: "video" | "image" | "audio" | "subtitle" | "text" | "sticker";
  sourceUrl?: string;
  label: string;
  startTimeMs: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

// ── Workbench ──────────────────────────────────────────────────────

export interface Workbench {
  id: string;
  canvasId: string | null;
  name: string;
  durationMs: number;
  resolution: "1920x1080" | "1080x1080" | "1080x1920";
  fps: number;
  tracks: Track[];
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Create/Update Types ────────────────────────────────────────────

export interface CreateWorkbenchInput {
  canvasId?: string;
  name: string;
  resolution?: "1920x1080" | "1080x1080" | "1080x1920";
  fps?: number;
}

export interface UpdateWorkbenchTracksInput {
  workbenchId: string;
  tracks: Track[];
}

// ── Clip Visual Config (matching Toonflow's clipConfigs) ───────────

export const CLIP_VISUAL_CONFIG: Record<
  string,
  {
    backgroundColor: string;
    borderColor: string;
    height: number;
    selected: { borderColor: string; boxShadow?: string };
  }
> = {
  video: {
    backgroundColor: "linear-gradient(45deg, #667eea 0%, #764ba2 100%)",
    borderColor: "#000000",
    height: 60,
    selected: {
      borderColor: "#ff6b6b",
      boxShadow: "0 0 0 3px rgba(255, 107, 107, 0.3)",
    },
  },
  image: {
    backgroundColor: "linear-gradient(45deg, #43e97b 0%, #38f9d7 100%)",
    borderColor: "#43e97b",
    height: 60,
    selected: {
      borderColor: "#ff6b6b",
      boxShadow: "0 0 0 3px rgba(255, 107, 107, 0.3)",
    },
  },
  audio: {
    backgroundColor: "linear-gradient(45deg, #f093fb 0%, #f5576c 100%)",
    borderColor: "#f093fb",
    height: 36,
    selected: {
      borderColor: "#4ecdc4",
    },
  },
  subtitle: {
    backgroundColor: "linear-gradient(45deg, #fbbf24 0%, #f59e0b 100%)",
    borderColor: "#fbbf24",
    height: 30,
    selected: {
      borderColor: "#ff6b6b",
    },
  },
};

// ── Default Tracks ─────────────────────────────────────────────────

export function createDefaultTracks(): Track[] {
  return [
    {
      id: "track-video-1",
      type: "video",
      name: "主轨道",
      order: 0,
      isMain: true,
      clips: [],
    },
    {
      id: "track-audio-1",
      type: "audio",
      name: "音频",
      order: 2,
      clips: [],
    },
    {
      id: "track-subtitle-1",
      type: "subtitle",
      name: "字幕",
      order: 3,
      clips: [],
    },
    {
      id: "track-filter-1",
      type: "filter",
      name: "滤镜",
      order: 4,
      clips: [],
    },
  ];
}
