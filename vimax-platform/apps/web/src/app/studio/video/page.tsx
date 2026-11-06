"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AudioLines,
  Camera,
  Clapperboard,
  CloudCog,
  Crop,
  Dices,
  Download,
  Eraser,
  Film,
  Hourglass,
  Image as ImageIcon,
  Maximize,
  Play,
  PlusCircle,
  RectangleHorizontal,
  RectangleVertical,
  Repeat,
  Rocket,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Type,
} from "lucide-react";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_MOTION_PRESETS,
  VIDEO_STYLE_PRESETS,
} from "@vimax/contracts";
import { NegativePromptChips } from "@/features/prompt-words/PromptWordChips";
import { trpc } from "@/lib/trpc/client";
import { useTranslations } from "next-intl";
import { safeJsonParse } from "@/lib/safe-json";
import { FALLBACK_VIDEO_MODEL_ID } from "@/features/canvas/utils/node-defaults";

const DURATION_OPTIONS = [5, 10];
const FPS_OPTIONS = [16, 24];
const QUICK_MOTIONS = ["orbit", "push_in", "pan_right", "crane"];

/** Decorative gradient per style preset (design-style thumbnail tiles). */
const STYLE_GRADIENTS: Record<string, string> = {
  none: "from-slate-500 to-slate-700",
  cyberpunk: "from-fuchsia-500 to-cyan-400",
  anime: "from-sky-400 to-indigo-200",
  cinematic: "from-amber-600 to-stone-800",
  "3d-animation": "from-orange-300 to-rose-400",
  vaporwave: "from-purple-400 to-teal-300",
  "neo-chinese": "from-slate-700 to-amber-500",
  documentary: "from-emerald-600 to-neutral-500",
  watercolor: "from-indigo-300 to-pink-200",
  "film-noir": "from-neutral-600 to-neutral-900",
  claymation: "from-orange-300 to-yellow-200",
  "dark-epic": "from-red-900 to-slate-900",
};

/** Master inspiration seeds (大师级灵感词条) — click to fill the prompt. */
const INSPIRATION_PRESETS = [
  {
    tags: "#影视级运镜 #希区柯克",
    text: "穿云俯冲至霓虹废土，镜头极速缓停，大景深粒子飞散，金橙与青色强烈补色对比，电影级调色",
  },
  {
    tags: "#深海发光生物 #微距流体",
    text: "透明水母体内的微型发光星系，深渊幽蓝环境光，极慢速缓推，超采样渲染，微距流体细节",
  },
  {
    tags: "#赛博都市 #雨夜霓虹",
    text: "雨夜赛博都市的天际线，霓虹灯牌在湿滑地面的倒影，飞行器穿行云层，缓慢升降镜头",
  },
  {
    tags: "#自然纪录 #黄金时刻",
    text: "非洲草原黄金时刻的象群迁徙，逆光尘土飞扬，航拍缓慢跟随，纪录片质感，70mm 胶片颗粒",
  },
  {
    tags: "#新中式 #水墨科幻",
    text: "水墨山河间悬浮的青铜机械巨鲸，云雾缭绕，金线勾勒，镜头环绕推近，东方极简构图",
  },
  {
    tags: "#极速运动 #第一人称",
    text: "第一人称滑板穿越未来都市管廊，速度线拉伸，霓虹光轨，甩镜转场衔接两个空间",
  },
];

interface HistoryItem {
  job_id: string;
  status: string;
  prompt: string;
  mode?: string;
  model_id?: string;
  duration_sec?: number;
  aspect_ratio?: string;
  created_at: string;
}

// ── Shared building blocks (design console visual language) ─────────────

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)]/85 p-3 shadow-[var(--shadow-md)] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  tint = "var(--color-accent)",
  right,
}: {
  icon: React.ElementType;
  title: string;
  tint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="size-4" style={{ color: tint }} />
        <span className="text-sm font-semibold text-[var(--color-ink)]">{title}</span>
      </div>
      {right}
    </div>
  );
}

function OptionChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        selected
          ? "rounded px-2 py-1 font-mono text-[10px] font-bold text-[var(--color-accent-on)] transition-colors"
          : "rounded bg-[var(--color-surface-4)] px-2 py-1 font-mono text-[10px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]"
      }
      style={selected ? { background: "var(--color-accent)" } : undefined}
    >
      {children}
    </button>
  );
}

// ── Frame reference uploader (i2v: first/last frame) ────────────────────

function FrameUploader({
  assetIds,
  onUpload,
  onRemove,
}: {
  assetIds: string[];
  onUpload: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("studioVideo");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestUpload = trpc.asset.requestUpload.useMutation();
  const confirmUpload = trpc.asset.confirmUpload.useMutation();

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const req = await requestUpload.mutateAsync({
          mime_type: file.type as "image/png" | "image/jpeg" | "image/webp",
          size_bytes: file.size,
        });
        await fetch(req.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        const buf = await file.arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", buf);
        const sha256 = Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.src = URL.createObjectURL(file);
        });
        await confirmUpload.mutateAsync({
          asset_id: req.asset_id,
          sha256,
          width: dims.w,
          height: dims.h,
        });
        onUpload(req.asset_id);
      } catch (err) {
        console.error("Upload failed", err);
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [requestUpload, confirmUpload, onUpload],
  );

  const slotLabels = [t("firstFrame"), t("lastFrame")];

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {assetIds.map((id, i) => (
          <div
            key={id}
            className="relative flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-4)] font-mono text-[10px] text-[var(--color-ink-muted)]"
          >
            <button
              type="button"
              onClick={() => onRemove(id)}
              aria-label={t("refRemove")}
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-danger)] text-[10px] text-white"
            >
              ×
            </button>
            {slotLabels[i] ?? t("refThumb")}
          </div>
        ))}
        {assetIds.length < 2 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-label={t("refUpload")}
            className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-[var(--color-hairline-strong)] text-2xl text-[var(--color-ink-subtle)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            {uploading ? "…" : "+"}
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export default function StudioVideoPage() {
  const t = useTranslations("studioVideo");
  const [mode, setMode] = useState<"t2v" | "i2v">("t2v");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [modelId, setModelId] = useState(FALLBACK_VIDEO_MODEL_ID);
  const [durationSec, setDurationSec] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [fps, setFps] = useState<16 | 24>(16);
  const [stylePresetId, setStylePresetId] = useState("none");
  const [motionPresetId, setMotionPresetId] = useState("");
  const [motionIntensity, setMotionIntensity] = useState(5);
  const [refAssetIds, setRefAssetIds] = useState<string[]>([]);
  const [rightTab, setRightTab] = useState<"history" | "inspiration" | "models">("history");

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sseRef = useRef<EventSource | null>(null);

  const generateMutation = trpc.video.generate.useMutation();
  const getJobQuery = trpc.video.getJob.useQuery(
    { job_id: activeJobId! },
    { enabled: !!activeJobId, refetchInterval: false },
  );
  const historyQuery = trpc.video.listHistory.useQuery({ limit: 20 }, { refetchInterval: 10_000 });

  const { data: modelData } = trpc.model.listVideoModels.useQuery();
  const models = modelData?.items ?? [];
  const currentModel = models.find((m) => m.id === modelId);
  const availableDurations = DURATION_OPTIONS.filter((d) => d <= (currentModel?.maxDuration ?? 10));
  const availableResolutions: string[] = currentModel?.resolutions ?? ["720p"];
  const creditsPerSecond = currentModel?.credits_per_second ?? 1;
  const creditEstimate = creditsPerSecond * durationSec;

  useEffect(() => {
    if (!availableDurations.includes(durationSec) && availableDurations.length > 0) {
      setDurationSec(availableDurations[0]);
    }
    if (!availableResolutions.includes(resolution)) {
      setResolution(availableResolutions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  const subscribeSSE = useCallback(
    (jobId: string) => {
      sseRef.current?.close();
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL?.replace("/trpc", "") ?? "http://localhost:3001";
      const es = new EventSource(`${apiBase}/sse/jobs/${jobId}`);
      sseRef.current = es;
      es.addEventListener("started", () => setJobStatus("running"));
      es.addEventListener("progress", (e) => {
        const d = safeJsonParse<Record<string, unknown>>(e.data, {});
        setJobProgress(typeof d.percent === "number" ? d.percent : 0);
      });
      es.addEventListener("completed", () => {
        setJobStatus("succeeded");
        setJobProgress(100);
        es.close();
        getJobQuery
          .refetch()
          .then((res) => {
            if (res.data?.output_url) setOutputUrl(res.data.output_url);
          })
          .catch(() => setErrorMessage(t("fetchUrlFailed")));
      });
      es.addEventListener("failed", (e) => {
        const d = safeJsonParse<{ error_message?: string }>(e.data, {});
        setJobStatus("failed");
        setErrorMessage(d.error_message ?? "Unknown error");
        es.close();
      });
      es.onerror = () => es.close();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getJobQuery, t],
  );

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setOutputUrl(null);
    setErrorMessage(null);
    setJobProgress(0);
    setJobStatus("queued");
    try {
      const res = await generateMutation.mutateAsync({
        mode,
        prompt: prompt.trim(),
        model_id: modelId,
        duration_sec: durationSec,
        resolution,
        aspect_ratio: aspectRatio,
        fps,
        negative_prompt: negativePrompt.trim() || undefined,
        style_preset_id: stylePresetId === "none" ? undefined : stylePresetId,
        motion_preset_id: motionPresetId || undefined,
        motion_intensity: motionPresetId ? motionIntensity : undefined,
        reference_asset_ids: mode === "i2v" ? refAssetIds : undefined,
        force: false,
      });
      setActiveJobId(res.job_id);
      if (res.cache_hit && res.output_asset_id) {
        setJobStatus("cached");
        setJobProgress(100);
        const job = await getJobQuery.refetch();
        if (job.data?.output_url) setOutputUrl(job.data.output_url);
      } else {
        subscribeSSE(res.job_id);
      }
    } catch (err) {
      setJobStatus("failed");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const randomInspiration = () => {
    const pick = INSPIRATION_PRESETS[Math.floor(Math.random() * INSPIRATION_PRESETS.length)];
    setPrompt(pick.text);
  };

  const reuseHistory = (item: HistoryItem) => {
    setPrompt(item.prompt);
    if (item.mode === "t2v" || item.mode === "i2v") setMode(item.mode);
    if (item.model_id) setModelId(item.model_id);
    if (item.duration_sec) setDurationSec(item.duration_sec);
    if (item.aspect_ratio) setAspectRatio(item.aspect_ratio);
  };

  const loadHistoryJob = (item: HistoryItem) => {
    if (item.status !== "succeeded") return;
    setActiveJobId(item.job_id);
    setJobStatus("succeeded");
    setJobProgress(100);
    getJobQuery.refetch().then((res) => {
      if (res.data?.output_url) setOutputUrl(res.data.output_url);
    });
  };

  useEffect(() => {
    return () => sseRef.current?.close();
  }, []);

  const isGenerating = jobStatus === "queued" || jobStatus === "running";
  const aspectIcons = [RectangleHorizontal, RectangleVertical, Crop, Square];

  return (
    <div className="relative h-full overflow-y-auto bg-[var(--color-canvas)] lg:overflow-hidden">
      {/* Ambient glow orbs (design background) */}
      <div className="pointer-events-none fixed left-1/4 top-20 -z-10 h-[420px] w-[420px] rounded-full bg-[var(--color-accent)]/10 blur-[130px]" />
      <div className="pointer-events-none fixed bottom-10 right-1/4 -z-10 h-[380px] w-[380px] rounded-full bg-[var(--color-secondary)]/10 blur-[130px]" />

      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-4 p-4 pb-24 lg:h-full lg:min-h-0 lg:flex-row lg:items-stretch lg:pb-4">
        {/* ═══ 1. LEFT: Prompt Engineering & Generation Mechanics (380px) ═══ */}
        <aside className="flex w-full shrink-0 flex-col gap-3 lg:min-h-0 lg:w-[380px] lg:overflow-y-auto lg:pb-2">
          {/* Creation Mode Switcher */}
          <Panel className="!p-1.5">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setMode("t2v")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition-all ${
                  mode === "t2v"
                    ? "bg-[var(--color-accent)] font-semibold text-[var(--color-accent-on)] shadow-sm"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
                }`}
              >
                <Type className="size-4" />
                {t("modeT2V")}
              </button>
              <button
                type="button"
                onClick={() => setMode("i2v")}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition-all ${
                  mode === "i2v"
                    ? "bg-[var(--color-accent)] font-semibold text-[var(--color-accent-on)] shadow-sm"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
                }`}
              >
                <ImageIcon className="size-4" />
                {t("modeI2V")}
              </button>
            </div>
          </Panel>

          {/* Smart Prompt Module */}
          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-[var(--color-accent)]" />
                <span className="text-sm font-semibold text-[var(--color-ink)]">
                  {t("promptLabel")}
                </span>
                <span className="rounded-full bg-[var(--color-surface-4)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-secondary)]">
                  {t("promptBadge")}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg bg-[var(--color-surface-4)]/60 p-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t("promptPlaceholderT2V")}
                rows={4}
                className="w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--color-ink)] placeholder-[var(--color-ink-subtle)] focus:outline-none"
              />
              <div className="flex items-center justify-between rounded bg-[var(--color-surface-2)]/40 px-2 py-1">
                <div className="flex items-center gap-1 text-[var(--color-ink-subtle)]">
                  <SlidersHorizontal className="size-3.5" />
                  <span className="font-mono text-[10px]">
                    Tokens: <strong className="text-[var(--color-secondary)]">{prompt.length}</strong> / 4000
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={randomInspiration}
                    title={t("randomInspiration")}
                    className="text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                  >
                    <Dices className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrompt("")}
                    title={t("clearPrompt")}
                    className="text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-danger)]"
                  >
                    <Eraser className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Negative prompt drawer */}
            <div className="mt-2 rounded-lg bg-[var(--color-surface-2)]/60 p-2">
              <button
                type="button"
                onClick={() => setNegativeOpen((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <span className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                  <span className="size-1.5 rounded-full bg-[var(--color-danger)]" />
                  {t("negativeLabel")}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
                  {negativeOpen ? "−" : "+"}
                </span>
              </button>
              {negativeOpen && (
                <div className="mt-2 flex flex-col gap-2">
                  <NegativePromptChips
                    value={negativePrompt}
                    onChange={setNegativePrompt}
                    includeVideoGroup
                  />
                  <input
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder={t("negativePlaceholder")}
                    className="w-full rounded bg-[var(--color-surface-4)] px-2.5 py-1.5 text-xs text-[var(--color-ink-muted)] placeholder-[var(--color-ink-subtle)] focus:text-[var(--color-ink)] focus:outline-none"
                  />
                </div>
              )}
            </div>
          </Panel>

          {/* i2v frames */}
          {mode === "i2v" && (
            <Panel>
              <PanelHeader icon={Film} title={t("refLabel")} tint="var(--color-secondary)" />
              <FrameUploader
                assetIds={refAssetIds}
                onUpload={(id) => setRefAssetIds((prev) => [...prev, id])}
                onRemove={(id) => setRefAssetIds((prev) => prev.filter((x) => x !== id))}
              />
            </Panel>
          )}

          {/* Visual Style Preset Grid */}
          <Panel>
            <PanelHeader
              icon={Sparkles}
              title={t("styleLabel")}
              tint="var(--color-secondary)"
              right={
                <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
                  {VIDEO_STYLE_PRESETS.length - 1} {t("presetCount")}
                </span>
              }
            />
            <div className="grid grid-cols-3 gap-1.5">
              {VIDEO_STYLE_PRESETS.filter((s) => s.id !== "none").map((s) => {
                const selected = stylePresetId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStylePresetId(selected ? "none" : s.id)}
                    className={`group relative overflow-hidden rounded-lg bg-gradient-to-br ${
                      STYLE_GRADIENTS[s.id] ?? "from-slate-500 to-slate-700"
                    } p-0.5 transition-all ${
                      selected
                        ? "ring-2 ring-[var(--color-secondary)] shadow-[0_0_12px_rgba(76,215,246,0.35)]"
                        : "opacity-80 hover:opacity-100"
                    }`}
                  >
                    <div className="relative h-12 rounded-md">
                      <div className="absolute inset-0 rounded-md bg-gradient-to-t from-[rgba(10,14,24,0.9)] via-transparent to-transparent" />
                      <span className="absolute bottom-1 left-1.5 font-mono text-[10px] font-semibold text-white">
                        {s.label}
                      </span>
                      {selected && (
                        <span className="absolute right-1 top-1 size-2 rounded-full bg-[var(--color-secondary)] shadow-[0_0_6px_#4cd7f6]" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Panel>

          {/* Engine & Camera Parameters */}
          <Panel>
            <PanelHeader icon={Clapperboard} title={t("engineLabel")} tint="var(--color-tertiary)" />

            {/* Model picker */}
            <div className="mb-2 flex flex-col gap-1">
              <label className="flex items-center justify-between font-mono text-[10px] text-[var(--color-ink-muted)]">
                <span>{t("modelLabel")}</span>
                <span className="rounded-full bg-[var(--color-tertiary-container)] px-1.5 py-0.5 text-[var(--color-tertiary)]">
                  {creditsPerSecond} {t("creditsPerSec")}
                </span>
              </label>
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                className="w-full cursor-pointer rounded-lg bg-[var(--color-surface-4)] px-2.5 py-2 text-sm text-[var(--color-ink)] focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Aspect ratio selector */}
            <div className="mb-2 flex flex-col gap-1">
              <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                {t("aspectLabel")}
              </span>
              <div className="grid grid-cols-4 gap-1">
                {VIDEO_ASPECT_RATIOS.map((a, i) => {
                  const Icon = aspectIcons[i] ?? Crop;
                  const selected = aspectRatio === a.ratio;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAspectRatio(a.ratio)}
                      className={`flex flex-col items-center gap-1 rounded-lg py-2 font-mono text-[10px] transition-colors ${
                        selected
                          ? "bg-[var(--color-accent)] text-[var(--color-accent-on)] shadow-sm"
                          : "bg-[var(--color-surface-4)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      <Icon className="size-4" />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Motion presets: quick tiles + full select */}
            <div className="mb-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {t("motionLabel")}
                </span>
                {motionPresetId && (
                  <span className="font-mono text-[10px] text-[var(--color-secondary)]">
                    {VIDEO_MOTION_PRESETS.find((p) => p.id === motionPresetId)?.label}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {QUICK_MOTIONS.map((id) => {
                  const preset = VIDEO_MOTION_PRESETS.find((p) => p.id === id);
                  if (!preset) return null;
                  const selected = motionPresetId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setMotionPresetId(selected ? "" : id)}
                      className={`rounded p-1.5 text-center transition-colors ${
                        selected
                          ? "bg-gradient-to-t from-[var(--color-secondary)]/20 to-transparent text-[var(--color-secondary)]"
                          : "bg-[var(--color-surface-4)]/80 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      <Camera className="mx-auto mb-0.5 block size-4" />
                      <span className="font-mono text-[10px] leading-tight">
                        {preset.label.split(" (")[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <select
                value={motionPresetId}
                onChange={(e) => setMotionPresetId(e.target.value)}
                className="w-full cursor-pointer rounded bg-[var(--color-surface-4)]/80 px-2 py-1.5 text-xs text-[var(--color-ink-muted)] focus:outline-none"
              >
                <option value="">{t("motionNone")}</option>
                {["basic", "movement", "effect"].map((cat) => (
                  <optgroup key={cat} label={t(`motion${cat.charAt(0).toUpperCase() + cat.slice(1)}`)}>
                    {VIDEO_MOTION_PRESETS.filter((p) => p.category === cat).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Motion intensity slider */}
            {motionPresetId && (
              <div className="mb-2 flex flex-col gap-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-[var(--color-ink-muted)]">{t("motionIntensity")}</span>
                  <span className="font-bold text-[var(--color-accent)]">{motionIntensity} / 10</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={motionIntensity}
                  onChange={(e) => setMotionIntensity(Number(e.target.value))}
                  aria-label={t("motionIntensity")}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            )}

            {/* Duration + FPS + Resolution */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <div className="flex items-center justify-between rounded-lg bg-[var(--color-surface-4)]/60 p-2">
                <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {t("durationLabel")}
                </span>
                <div className="flex gap-1">
                  {availableDurations.map((d) => (
                    <OptionChip key={d} selected={durationSec === d} onClick={() => setDurationSec(d)}>
                      {d}s
                    </OptionChip>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-[var(--color-surface-4)]/60 p-2">
                <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {t("fpsLabel")}
                </span>
                <div className="flex gap-1">
                  {FPS_OPTIONS.map((f) => (
                    <OptionChip key={f} selected={fps === f} onClick={() => setFps(f as 16 | 24)}>
                      {f}
                    </OptionChip>
                  ))}
                </div>
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-lg bg-[var(--color-surface-4)]/60 p-2">
                <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {t("resolutionLabel")}
                </span>
                <div className="flex gap-1">
                  {availableResolutions.map((r) => (
                    <OptionChip key={r} selected={resolution === r} onClick={() => setResolution(r)}>
                      {r}
                    </OptionChip>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          {/* Primary action */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating || (mode === "i2v" && refAssetIds.length === 0)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-secondary)] to-[var(--color-tertiary)] py-3.5 text-sm font-bold tracking-tight text-[#0a0e18] shadow-[0_0_24px_rgba(160,120,255,0.4)] transition-all hover:shadow-[0_0_32px_rgba(76,215,246,0.55)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Rocket className="size-5" />
              {isGenerating ? t("generating") : `${t("generate")} (≈ ${creditEstimate} ${t("credits")})`}
            </button>
            <div className="flex items-center justify-between px-3 pt-1.5 font-mono text-[10px] text-[var(--color-ink-subtle)]">
              <span className="flex items-center gap-1">
                <Hourglass className="size-3.5" />
                {t("renderHint")}
              </span>
              <span className="flex items-center gap-1">
                <CloudCog className="size-3.5 text-[var(--color-secondary)]" />
                {t("queueStatus")}
              </span>
            </div>
          </div>
        </aside>

        {/* ═══ 2. CENTER: Viewport & Shot Strip (fluid) ═══ */}
        <section className="hidden min-w-0 flex-1 flex-col gap-3 lg:flex lg:min-h-0 lg:overflow-y-auto lg:pb-2">
          {/* Viewport header strip */}
          <Panel className="!py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Film className="size-5 shrink-0 text-[var(--color-secondary)]" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-[var(--color-ink)]">
                    {activeJobId ? `${t("jobPrefix")}_${activeJobId.slice(0, 8)}.mp4` : t("viewportIdle")}
                  </span>
                  <span className="truncate font-mono text-[10px] text-[var(--color-ink-subtle)]">
                    {activeJobId ? `${t("jobId")}: ${activeJobId.slice(0, 8)}` : t("viewportHint")}
                  </span>
                </div>
                {activeJobId && (
                  <>
                    <span className="ml-1 rounded-full bg-[var(--color-secondary)]/15 px-2 py-0.5 font-mono text-[10px] text-[var(--color-secondary)]">
                      {resolution} · {fps}fps
                    </span>
                    <span className="rounded-full bg-[var(--color-surface-4)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-ink-muted)]">
                      {aspectRatio}
                    </span>
                  </>
                )}
              </div>
              {outputUrl && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={outputUrl}
                    download
                    title={t("download")}
                    className="flex size-8 items-center justify-center rounded-full bg-[var(--color-surface-4)] text-[var(--color-ink)] transition-colors hover:text-[var(--color-accent)]"
                  >
                    <Download className="size-4" />
                  </a>
                  <a
                    href={outputUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={t("openFullscreen")}
                    className="flex size-8 items-center justify-center rounded-full bg-[var(--color-surface-4)] text-[var(--color-ink)] transition-colors hover:text-[var(--color-accent)]"
                  >
                    <Maximize className="size-4" />
                  </a>
                </div>
              )}
            </div>
          </Panel>

          {/* Live rendering status banner */}
          {activeJobId && isGenerating && (
            <div className="relative flex items-center justify-between overflow-hidden rounded-lg border border-[var(--color-hairline)] bg-gradient-to-r from-[var(--color-surface-1)] via-[var(--color-surface-2)] to-[var(--color-surface-1)] px-4 py-2 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-tertiary)] opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-[var(--color-tertiary)]" />
                </span>
                <span className="text-sm text-[var(--color-ink)]">
                  {jobStatus === "queued" ? t("statusQueued") : t("statusRunning", { percent: jobProgress })}
                </span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-surface-4)]">
                <div
                  className="h-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-secondary)] to-[var(--color-tertiary)] transition-all"
                  style={{ width: `${jobProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Cinematic viewport */}
          <div className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl bg-[var(--color-bg-base)] shadow-2xl">
            {outputUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={outputUrl}
                controls
                autoPlay
                loop
                muted
                playsInline
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="relative flex h-full w-full flex-col items-center justify-center gap-3">
                {/* rule-of-thirds grid overlay */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-15">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="border-b border-r border-[var(--color-ink)]/40" />
                  ))}
                </div>
                <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-[var(--color-surface-4)]/80 px-2.5 py-1 backdrop-blur-md">
                  <span className="size-2 rounded-full bg-[var(--color-danger)]" />
                  <span className="font-mono text-[10px] font-bold tracking-widest text-[var(--color-tertiary)]">
                    LIVE PREVIEW
                  </span>
                </div>
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex size-14 items-center justify-center rounded-full bg-[var(--color-surface-4)]/80 backdrop-blur-xl">
                      <Play className="ml-1 size-6 text-[var(--color-ink-muted)]" />
                    </div>
                    <p className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
                      {t("statusRunning", { percent: jobProgress })}
                    </p>
                  </div>
                ) : (
                  <p className="px-8 text-center text-sm text-[var(--color-ink-subtle)]">
                    {activeJobId ? t("viewportEmptyAfterJob") : t("viewportHint")}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Shot strip (single-shot console; multi-shot lives on the canvas) */}
          <Panel className="!p-2">
            <div className="flex items-center justify-between rounded-lg bg-[var(--color-bg-base)]/50 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <Clapperboard className="size-4 text-[var(--color-accent)]" />
                <span className="text-xs font-semibold text-[var(--color-ink)]">
                  {t("shotStrip")}
                </span>
                <span className="rounded bg-[var(--color-surface-4)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink-subtle)]">
                  1 {t("shotUnit")} · {durationSec}.0s
                </span>
              </div>
              <Link
                href="/"
                className="font-mono text-[10px] text-[var(--color-accent)] hover:underline"
              >
                {t("multiShotLink")} →
              </Link>
            </div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div className="flex w-20 shrink-0 items-center gap-1 font-mono text-[10px] text-[var(--color-ink-muted)]">
                  <Film className="size-3.5 text-[var(--color-accent)]" />
                  {t("videoTrack")}
                </div>
                <div className="relative h-12 flex-1 overflow-hidden rounded-lg bg-[var(--color-bg-base)]/80 p-1">
                  <div
                    className={`relative h-full rounded-md border transition-all ${
                      jobStatus === "succeeded" || jobStatus === "cached"
                        ? "border-[var(--color-secondary)]/40 bg-gradient-to-r from-[var(--color-accent)]/25 to-[var(--color-secondary)]/20"
                        : isGenerating
                          ? "animate-pulse border-[var(--color-secondary)]/60 bg-gradient-to-r from-[var(--color-accent)]/30 to-[var(--color-secondary)]/20"
                          : "border-transparent bg-[var(--color-surface-3)]"
                    }`}
                  >
                    <span className="absolute left-2 top-1 rounded bg-[var(--color-bg-base)]/80 px-1 font-mono text-[10px] text-[var(--color-ink)]">
                      {t("shotLabel")} · {prompt.slice(0, 14) || "—"}
                    </span>
                    <span className="absolute bottom-1 right-2 font-mono text-[10px] text-[var(--color-secondary)]">
                      00:00 - 00:{String(durationSec).padStart(2, "0")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex w-20 shrink-0 items-center gap-1 font-mono text-[10px] text-[var(--color-ink-muted)]">
                  <Camera className="size-3.5 text-[var(--color-secondary)]" />
                  {t("cameraTrack")}
                </div>
                <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-[var(--color-bg-base)]/80">
                  <svg className="h-full w-full text-[var(--color-secondary)]" preserveAspectRatio="none" viewBox="0 0 400 28">
                    <path
                      d="M0,14 Q100,4 150,20 T280,10 T400,16"
                      fill="none"
                      stroke="currentColor"
                      strokeDasharray="4 2"
                      strokeWidth="2"
                    />
                    <circle cx="10" cy="14" r="3" fill="#4cd7f6" stroke="#0a0e18" strokeWidth="1.5" />
                    <circle cx="200" cy="12" r="3" fill="#d0bcff" stroke="#0a0e18" strokeWidth="1.5" />
                    <circle cx="390" cy="16" r="3" fill="#ffb690" stroke="#0a0e18" strokeWidth="1.5" />
                  </svg>
                  <span className="absolute left-2 font-mono text-[9px] text-[var(--color-ink-subtle)]">
                    {motionPresetId
                      ? (VIDEO_MOTION_PRESETS.find((p) => p.id === motionPresetId)?.label ?? "")
                      : t("cameraTrackIdle")}
                  </span>
                </div>
              </div>
            </div>
          </Panel>
        </section>

        {/* ═══ 3. RIGHT: History / Inspiration / Models (340px) ═══ */}
        <aside className="hidden w-[340px] shrink-0 flex-col gap-3 xl:flex xl:min-h-0 xl:overflow-y-auto xl:pb-2">
          {/* Right tabs */}
          <Panel className="!p-1.5">
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ["history", t("historyTab")],
                  ["inspiration", t("inspirationTab")],
                  ["models", t("modelsTab")],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRightTab(key)}
                  className={`rounded-lg py-1.5 text-center font-mono text-[10px] font-semibold transition-colors ${
                    rightTab === key
                      ? "bg-[var(--color-accent)] text-[var(--color-accent-on)] shadow-sm"
                      : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Panel>

          {/* History batches */}
          {rightTab === "history" && (
            <Panel className="">
              <PanelHeader icon={Hourglass} title={t("history")} />
              {historyQuery.isLoading && (
                <p className="text-xs text-[var(--color-ink-subtle)]">{t("historyLoading")}</p>
              )}
              {!historyQuery.isLoading && historyQuery.data?.items?.length === 0 && (
                <p className="text-xs text-[var(--color-ink-subtle)]">{t("historyEmpty")}</p>
              )}
              <div className="flex flex-col gap-2">
                {historyQuery.data?.items?.map((item: HistoryItem) => (
                  <div
                    key={item.job_id}
                    className="group flex flex-col gap-1.5 rounded-xl bg-[var(--color-surface-4)]/60 p-2 transition-colors hover:bg-[var(--color-surface-3)]"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          item.status === "succeeded"
                            ? "bg-[var(--color-secondary)]/15 text-[var(--color-secondary)]"
                            : item.status === "failed"
                              ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
                              : "bg-[var(--color-surface-4)] text-[var(--color-ink-muted)]"
                        }`}
                      >
                        {item.status === "succeeded"
                          ? t("statusSucceeded")
                          : item.status === "failed"
                            ? t("statusFailed")
                            : item.status}{" "}
                        · {item.duration_sec ?? "—"}s
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
                        {new Date(item.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="truncate text-xs text-[var(--color-ink)]">{item.prompt}</p>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
                        {item.aspect_ratio ?? "16:9"}
                      </span>
                      <div className="flex gap-1.5">
                        {item.status === "succeeded" && (
                          <button
                            type="button"
                            onClick={() => loadHistoryJob(item)}
                            className="rounded bg-[var(--color-surface-4)] px-2 py-1 font-mono text-[10px] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                          >
                            {t("preview")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => reuseHistory(item)}
                          title={t("reuseHint")}
                          className="flex items-center gap-1 rounded bg-[var(--color-accent)]/15 px-2 py-1 font-mono text-[10px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-on)]"
                        >
                          <Repeat className="size-3" />
                          {t("reuse")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {/* Inspiration seeds */}
          {rightTab === "inspiration" && (
            <Panel className="">
              <PanelHeader icon={Sparkles} title={t("inspirationTitle")} tint="var(--color-secondary)" />
              <div className="flex flex-col gap-2">
                {INSPIRATION_PRESETS.map((preset) => (
                  <button
                    key={preset.tags}
                    type="button"
                    onClick={() => setPrompt(preset.text)}
                    className="flex flex-col gap-1 rounded-lg border border-transparent bg-[var(--color-surface-4)]/60 p-2.5 text-left transition-colors hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-3)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] font-semibold text-[var(--color-secondary)]">
                        {preset.tags}
                      </span>
                      <PlusCircle className="size-3.5 text-[var(--color-ink-subtle)]" />
                    </div>
                    <p className="line-clamp-2 text-xs text-[var(--color-ink-muted)]">{preset.text}</p>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {/* Model assets */}
          {rightTab === "models" && (
            <Panel className="">
              <PanelHeader icon={AudioLines} title={t("modelsTitle")} tint="var(--color-tertiary)" />
              <div className="flex flex-col gap-2">
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModelId(m.id)}
                    className={`flex flex-col gap-1 rounded-xl border p-2.5 text-left transition-colors ${
                      modelId === m.id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                        : "border-transparent bg-[var(--color-surface-4)]/60 hover:bg-[var(--color-surface-3)]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--color-ink)]">{m.label}</span>
                      <span className="rounded-full bg-[var(--color-secondary)]/15 px-2 py-0.5 font-mono text-[10px] text-[var(--color-secondary)]">
                        {m.credits_per_second} {t("creditsPerSec")}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
                      ≤ {m.maxDuration}s · {(m.resolutions ?? []).join(" / ")}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
