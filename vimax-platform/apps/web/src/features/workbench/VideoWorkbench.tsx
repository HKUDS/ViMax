"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Track, Clip, TrackType } from "@vimax/contracts";
import { Clapperboard, Pause, Play, Square, X } from "lucide-react";
import { CLIP_VISUAL_CONFIG, createDefaultTracks } from "@vimax/contracts";
import { trpc } from "@/lib/trpc/client";

// ── Workbench Props ─────────────────────────────────────────────────

interface VideoWorkbenchProps {
  workbenchId: string;
  resolution?: string;
  fps?: number;
  onClose: () => void;
}

// ── Video Workbench (Toonflow-style fullscreen editor) ──────────────

export function VideoWorkbench({
  workbenchId,
  resolution = "1920x1080",
  fps = 24,
  onClose,
}: VideoWorkbenchProps) {
  const utils = trpc.useUtils();

  // ── Query: load workbench from API ──
  const { data: wbData, isLoading } = trpc.workbench.get.useQuery(
    { id: workbenchId },
    { enabled: !!workbenchId },
  );

  // ── Mutation: save tracks (debounced) ──
  const updateTracks = trpc.workbench.updateTracks.useMutation();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Initialize tracks from API or defaults ──
  useEffect(() => {
    const apiTracks = wbData?.tracks as Track[] | undefined;
    if (apiTracks && Array.isArray(apiTracks) && apiTracks.length > 0) {
      setTracks(apiTracks);
    } else if (!isLoading && wbData) {
      // New workbench: use default tracks
      setTracks(createDefaultTracks());
    }
  }, [wbData, isLoading]);

  // ── Debounced persist ──
  const persistTracks = useCallback(
    (updatedTracks: Track[]) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateTracks.mutate(
          { workbenchId, tracks: updatedTracks as unknown as Record<string, unknown>[] },
          {
            onSuccess: () => {
              utils.workbench.get.invalidate({ id: workbenchId });
            },
          },
        );
      }, 1000);
    },
    [workbenchId, updateTracks, utils],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Playback engine ──
  const totalDurationMs = computeTotalDuration(tracks);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;

      setPlaybackMs((prev) => {
        const next = prev + delta;
        if (totalDurationMs > 0 && next >= totalDurationMs) {
          setIsPlaying(false);
          return totalDurationMs;
        }
        return next;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, totalDurationMs]);

  // ── Playback controls ──
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);
  const stop = useCallback(() => {
    setIsPlaying(false);
    setPlaybackMs(0);
  }, []);

  // ── Track management ──
  const addTrack = useCallback(
    (type: TrackType) => {
      setTracks((prev) => {
        const newTrack: Track = {
          id: `track-${type}-${Date.now()}`,
          type,
          name: TRACK_LABELS[type] ?? type,
          order: prev.length,
          clips: [],
        };
        const updated = [...prev, newTrack];
        persistTracks(updated);
        return updated;
      });
    },
    [persistTracks],
  );

  const removeTrack = useCallback(
    (trackId: string) => {
      setTracks((prev) => {
        const updated = prev.filter((t) => t.id !== trackId);
        persistTracks(updated);
        return updated;
      });
    },
    [persistTracks],
  );

  // ── Clip management ──
  const addClip = useCallback(
    (trackId: string, clip: Omit<Clip, "id" | "trackId">) => {
      setTracks((prev) => {
        const updated = prev.map((t) =>
          t.id === trackId
            ? {
                ...t,
                clips: [
                  ...t.clips,
                  { ...clip, id: `clip-${Date.now()}`, trackId },
                ],
              }
            : t,
        );
        persistTracks(updated);
        return updated;
      });
    },
    [persistTracks],
  );

  const removeClip = useCallback(
    (trackId: string, clipId: string) => {
      setTracks((prev) => {
        const updated = prev.map((t) =>
          t.id === trackId
            ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
            : t,
        );
        persistTracks(updated);
        return updated;
      });
    },
    [persistTracks],
  );

  // ── Loading state ──
  if (isLoading) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          backgroundColor: "var(--color-canvas-cinema)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ color: "var(--color-text-muted)", fontSize: 14 }}>
          加载工作台…
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "var(--color-canvas-cinema)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "inherit",
      }}
    >
      {/* ── Top Bar ── */}
      <div
        style={{
          flexShrink: 0,
          height: 50,
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          borderBottom: "1px solid var(--color-border)",
          backgroundColor: "var(--color-surface)",
          gap: 12,
        }}
      >
        <button
          onClick={onClose}
          aria-label="关闭"
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "none",
            backgroundColor: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <X size={18} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Clapperboard className="size-4" />
          视频工作台
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          {wbData?.resolution ?? resolution} · {wbData?.fps ?? fps}fps
        </span>
        {updateTracks.isPending && (
          <span style={{ fontSize: 10, color: "var(--color-accent)" }}>保存中…</span>
        )}
        <div style={{ flex: 1 }} />

        {/* Add track buttons */}
        {(["video", "image", "audio", "subtitle", "filter"] as TrackType[]).map(
          (type) => (
            <button
              key={type}
              onClick={() => addTrack(type)}
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid var(--color-border)",
                backgroundColor: "transparent",
                color: "var(--color-text-muted)",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              + {TRACK_LABELS[type] ?? type}
            </button>
          ),
        )}
      </div>

      {/* ── Main Content Area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Preview Area */}
        <div
          ref={containerRef}
          style={{
            flex: "0 0 55%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#000",
            position: "relative",
          }}
        >
          <div
            style={{
              width: "60%",
              aspectRatio:
                (wbData?.resolution ?? resolution) === "1080x1920"
                  ? "9/16"
                  : (wbData?.resolution ?? resolution) === "1080x1080"
                    ? "1/1"
                    : "16/9",
              borderRadius: 10,
              background: "linear-gradient(135deg, var(--color-surface-3), var(--color-surface-2))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--color-border)",
            }}
          >
            <span
              onClick={togglePlay}
              style={{ fontSize: 48, color: "rgba(255,255,255,0.6)", cursor: "pointer" }}
            >
              {isPlaying ? <Pause className="size-8" /> : <Play className="size-10" />}
            </span>
          </div>

          {/* Playback time overlay */}
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "4px 12px",
              borderRadius: 8,
              backgroundColor: "rgba(0,0,0,0.6)",
              color: "#fff",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            {formatTime(playbackMs)} / {formatTime(totalDurationMs)}
          </div>
        </div>

        {/* Timeline Area */}
        <div
          style={{
            flex: "0 0 45%",
            display: "flex",
            flexDirection: "column",
            borderTop: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {/* Playback controls */}
          <div
            style={{
              flexShrink: 0,
              height: 36,
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              gap: 8,
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <button onClick={togglePlay} style={controlBtn}>
              {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button onClick={stop} style={controlBtn} aria-label="停止">
              <Square className="size-3.5" />
            </button>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
              {formatTime(playbackMs)}
            </span>

            {/* Playback cursor */}
            <div style={{ flex: 1, height: 2, backgroundColor: "var(--color-border)", position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: `${totalDurationMs > 0 ? (playbackMs / totalDurationMs) * 100 : 0}%`,
                  top: -3,
                  width: 2,
                  height: 8,
                  backgroundColor: "var(--color-danger)",
                  transition: "left 0.05s linear",
                }}
              />
            </div>

            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
              {formatTime(totalDurationMs)}
            </span>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>缩放:</span>
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
              {scale.toFixed(1)}x
            </span>
          </div>

          {/* Track rows */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {tracks.length === 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                }}
              >
                点击上方按钮添加轨道
              </div>
            )}
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                scale={scale}
                onRemoveTrack={removeTrack}
                onRemoveClip={removeClip}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Track Row Component ────────────────────────────────────────────

function TrackRow({
  track,
  scale,
  onRemoveTrack,
  onRemoveClip,
}: {
  track: Track;
  scale: number;
  onRemoveTrack: (id: string) => void;
  onRemoveClip: (trackId: string, clipId: string) => void;
}) {
  const config = CLIP_VISUAL_CONFIG[track.type] ?? CLIP_VISUAL_CONFIG.video!;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        minHeight: config.height + 20,
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Track label */}
      <div
        style={{
          width: 120,
          flexShrink: 0,
          padding: "4px 8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          borderRight: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text)" }}>
          {track.name}
        </span>
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <span
            style={{
              fontSize: 9,
              padding: "1px 4px",
              borderRadius: 2,
              backgroundColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            {track.type}
          </span>
          <button
            onClick={() => onRemoveTrack(track.id)}
            aria-label="移除轨道"
            style={{
              border: "none",
              background: "none",
              color: "var(--color-danger)",
              cursor: "pointer",
              padding: 0,
              display: "flex",
            }}
          >
            <X size={9} />
          </button>
        </div>
      </div>

      {/* Track timeline */}
      <div
        style={{
          flex: 1,
          position: "relative",
          height: config.height + 20,
          overflow: "hidden",
        }}
      >
        {track.clips.map((clip) => {
          const left = (clip.startTimeMs / 1000) * 100 * scale;
          const width = (clip.durationMs / 1000) * 100 * scale;
          return (
            <div
              key={clip.id}
              style={{
                position: "absolute",
                left,
                top: 10,
                width: Math.max(width, 20),
                height: config.height,
                borderRadius: 4,
                background: config.backgroundColor,
                border: `1px solid ${config.borderColor}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                overflow: "hidden",
                transition: "border-color 0.15s",
              }}
              title={clip.label}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "#fff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  padding: "0 4px",
                }}
              >
                {clip.label}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveClip(track.id, clip.id);
                }}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  border: "none",
                  background: "rgba(220,50,50,0.7)",
                  color: "#fff",
                  fontSize: 8,
                  borderRadius: 6,
                  width: 14,
                  height: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  opacity: 0,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.opacity = "0";
                }}
              >
                <X size={8} strokeWidth={3} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

const TRACK_LABELS: Record<string, string> = {
  video: "视频",
  image: "图片",
  audio: "音频",
  subtitle: "字幕",
  text: "文本",
  sticker: "贴纸",
  filter: "滤镜",
  effect: "特效",
  transition: "转场",
};

const controlBtn: React.CSSProperties = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "none",
  backgroundColor: "transparent",
  color: "var(--color-text)",
  fontSize: 14,
  cursor: "pointer",
};

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function computeTotalDuration(tracks: Track[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      const end = clip.startTimeMs + clip.durationMs;
      if (end > maxEnd) maxEnd = end;
    }
  }
  // Minimum 30s timeline
  return Math.max(maxEnd, 30000);
}
