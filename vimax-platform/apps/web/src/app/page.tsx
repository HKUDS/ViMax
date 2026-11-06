"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { trpc } from "@/lib/trpc/client";
import { Button, Input, Textarea, useToast, cn } from "@vimax/ui";
import { useTranslations } from "next-intl";
import { WelcomeOverlay } from "@/features/onboarding/WelcomeOverlay";
import { GenerationOverlay } from "@/features/generation/GenerationOverlay";
import { ModelSelect } from "@/features/models/ModelSelect";
import { StarfieldBackground } from "@/features/home/StarfieldBackground";
import { CinematicBackdrop } from "@/features/home/CinematicBackdrop";
import { useAuth } from "@/features/auth/AuthProvider";
import { ThesaurusChips } from "@/features/prompt-words/PromptWordChips";
import {
  Sparkles,
  ChevronRight,
  Lightbulb,
  ScrollText,
  Type,
  Image as ImageIcon,
  Clapperboard,
  Package,
  Building2,
  BookOpen,
  FolderOpen,
  Compass,
  Cpu,
  LayoutTemplate,
  Loader2,
} from "lucide-react";
import { buildCanvasUrl } from "@/features/canvas/utils/canvas-navigation";

gsap.registerPlugin(ScrollTrigger);

// Client components are still SSR-rendered, so guard useLayoutEffect.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type CreateMode = "idea" | "script";

const MODES = {
  idea: { label: "灵感生视频", icon: Lightbulb, desc: "描述创意想法，AI 自动编剧、分镜、生成视频", placeholder: "例如：一个孤独的宇航员在火星上发现了一扇通往异世界的门…", hint: "描述越详细效果越好。可指定美术风格、角色外貌、场景氛围。", submit: "开始生成" },
  script: { label: "剧本生视频", icon: ScrollText, desc: "粘贴剧本内容，AI 根据剧本分镜和视频生成", placeholder: "例如：\n第1场 - 咖啡厅 日内\n角色A推门走进咖啡厅…", hint: "建议包含场景标题、角色对话和动作描述。", submit: "开始生成" },
};

/** 创作目标（DAAI "你想做什么" 板块）：点击预填创作输入。
 *  tint 在品牌三色（紫/青/珊瑚）间轮转，让卡片组有视觉节奏。 */
const GOALS = [
  { title: "灵感短片", desc: "一句话生成创意短片", icon: Lightbulb, mode: "idea" as CreateMode, prompt: "一只柯基在海边追浪花，夕阳金色光线，治愈系短片", tint: "var(--color-accent)" },
  { title: "剧本改编", desc: "粘贴剧本自动分镜出片", icon: ScrollText, mode: "script" as CreateMode, prompt: "第1场 - 城市天台 夜\n主角站在天台边缘俯瞰城市灯火，风吹起衣角……", tint: "var(--color-tertiary)" },
  { title: "产品广告", desc: "商品卖点视觉化", icon: Package, mode: "idea" as CreateMode, prompt: "一台便携咖啡机在露营场景中使用，突出便携与三秒出杯，产品广告质感", tint: "var(--color-secondary)" },
  { title: "城市印象", desc: "文旅宣传镜头语言", icon: Building2, mode: "idea" as CreateMode, prompt: "清晨的城市街道，阳光穿过高楼，行人与车流延时摄影，城市宣传质感", tint: "var(--color-accent)" },
  { title: "动画预告", desc: "二次元动画预告片", icon: Clapperboard, mode: "idea" as CreateMode, prompt: "少女在樱花树下回眸，花瓣飘落，日式动画风格预告片", tint: "var(--color-tertiary)" },
  { title: "知识科普", desc: "科普可视化短片", icon: BookOpen, mode: "idea" as CreateMode, prompt: "太阳系行星运转的三维可视化演示，深邃星空背景，科技感", tint: "var(--color-secondary)" },
];

/** 常用工具（DAAI 工具行）：全部为真实路由入口。 */
const TOOLS = [
  { label: "生图工坊", href: "/studio/image", icon: ImageIcon },
  { label: "资产库", href: "/assets", icon: FolderOpen },
  { label: "发现", href: "/explore", icon: Compass },
  { label: "模型配置", href: "/settings/models", icon: Cpu },
];

export default function HomePage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const t = useTranslations("home");

  const [mode, setMode] = useState<CreateMode>("idea");
  const [input, setInput] = useState("");
  const [canvasName, setCanvasName] = useState("");

  // Generation overlay state — shows AI generation process on home page
  const [generationState, setGenerationState] = useState<{
    canvasId: string;
    conversationId: string;
    prompt: string;
    mode: CreateMode;
  } | null>(null);

  // Model selection state
  const [textModelId, setTextModelId] = useState("");
  const [imageModelId, setImageModelId] = useState("");
  const [videoModelId, setVideoModelId] = useState("");

  // Fetch defaults
  const { data: textModels } = trpc.modelConfig.list.useQuery({ type: "text" }, { staleTime: 60_000 });
  const { data: imageModels } = trpc.modelConfig.list.useQuery({ type: "image" }, { staleTime: 60_000 });
  const { data: videoModels } = trpc.modelConfig.list.useQuery({ type: "video" }, { staleTime: 60_000 });

  // Set default model IDs when data loads
  useEffect(() => {
    const textDef = textModels?.items?.find((m) => m.isDefault);
    if (textDef && !textModelId) setTextModelId(textDef.id);
  }, [textModels, textModelId]);
  useEffect(() => {
    const imgDef = imageModels?.items?.find((m) => m.isDefault);
    if (imgDef && !imageModelId) setImageModelId(imgDef.id);
  }, [imageModels, imageModelId]);
  useEffect(() => {
    const vidDef = videoModels?.items?.find((m) => m.isDefault);
    if (vidDef && !videoModelId) setVideoModelId(vidDef.id);
  }, [videoModels, videoModelId]);

  const createCanvas = trpc.canvas.create.useMutation();
  const createConversation = trpc.chat.createConversation.useMutation();
  const templates = trpc.canvas.listTemplates.useQuery();
  const instantiateTemplate = trpc.canvas.instantiateTemplate.useMutation();
  const requestUpload = trpc.asset.requestUpload.useMutation();
  const confirmUpload = trpc.asset.confirmUpload.useMutation();
  const utils = trpc.useUtils();

  const config = MODES[mode];

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [productImage, setProductImage] = useState<{ assetId: string; previewUrl: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // DAAI-style input: upload a product image that becomes the i2i
  // reference on the canvas (asset.requestUpload → PUT → confirmUpload).
  const handleProductUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    setUploadingImage(true);
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
      await confirmUpload.mutateAsync({
        asset_id: req.asset_id,
        sha256,
        width: 0,
        height: 0,
      });
      setProductImage({ assetId: req.asset_id, previewUrl: URL.createObjectURL(file) });
      toast.success("产品图已上传，将作为生成参考");
    } catch (err) {
      toast.error(`上传失败: ${(err as Error).message.slice(0, 60)}`);
    } finally {
      setUploadingImage(false);
    }
  };

  const applyGoal = (goal: (typeof GOALS)[number]) => {
    setMode(goal.mode);
    setInput(goal.prompt);
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => inputRef.current?.focus(), 400);
  };

  const useTemplate = async (tpl: { id: string; name: string }) => {
    try {
      const c = await createCanvas.mutateAsync({ name: tpl.name });
      await instantiateTemplate.mutateAsync({ canvas_id: c.canvas_id, template_id: tpl.id });
      router.push(`/canvas/${c.canvas_id}`);
    } catch (err) {
      const trpcErr = err as { shape?: { data?: { code?: string } } };
      if (trpcErr.shape?.data?.code === "UNAUTHORIZED") return;
      toast.error("模板创建失败");
    }
  };

  // ── Entrance: stagger the hero stack in on mount ──
  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.set("[data-motion]", { opacity: 0, y: 22 });
      gsap.to("[data-motion]", {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.08,
      });
    }, root);
    return () => ctx.revert();
  }, []);

  // ── Reveal: rows fade up as they enter the viewport ──
  // Geometry-driven on the AppShell <main> scroll container: scroll events
  // dispatch synchronously (unlike IntersectionObserver/ScrollTrigger
  // callbacks, which stall while the page is occluded), so reveals are
  // deterministic in every window state.
  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (rows.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const scroller = root.closest("main");
    const pending = rows.filter((row) => row.dataset.revealed !== "1");

    const reveal = () => {
      const threshold = window.innerHeight * 0.92;
      for (const row of pending) {
        if (row.dataset.revealed === "1") continue;
        if (row.getBoundingClientRect().top > threshold) continue;
        row.dataset.revealed = "1";
        row.style.transition = "opacity 0.55s cubic-bezier(0.16,1,0.3,1), transform 0.55s cubic-bezier(0.16,1,0.3,1)";
        row.style.opacity = "1";
        row.style.transform = "translateY(0)";
      }
    };

    rows.forEach((row) => {
      if (row.dataset.revealed === "1") return;
      row.style.opacity = "0";
      row.style.transform = "translateY(18px)";
    });

    scroller?.addEventListener("scroll", reveal, { passive: true });
    window.addEventListener("resize", reveal);
    reveal();
    return () => {
      scroller?.removeEventListener("scroll", reveal);
      window.removeEventListener("resize", reveal);
    };
  }, [templates.data]);

  // ── Hover lift: feature cards and project rows ease up under the cursor ──
  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lift = (el: HTMLElement) => {
      const enter = () => gsap.to(el, { y: -4, duration: 0.25, ease: "power2.out" });
      const leave = () => gsap.to(el, { y: 0, duration: 0.35, ease: "power2.out" });
      el.addEventListener("mouseenter", enter);
      el.addEventListener("mouseleave", leave);
      return () => {
        el.removeEventListener("mouseenter", enter);
        el.removeEventListener("mouseleave", leave);
      };
    };
    const cards = root.querySelectorAll<HTMLElement>("[data-lift]");
    const cleanups = Array.from(cards, lift);
    return () => {
      cleanups.forEach((fn) => fn());
      gsap.killTweensOf(cards);
    };
  }, [templates.data]);

  const handleCreate = async () => {
    if (!input.trim()) return;

    // Pre-flight auth check — give immediate feedback before hitting the API
    if (!user) {
      toast.warning("请先登录", {
        description: "登录后即可开始创作视频",
        action: {
          label: "去登录",
          onClick: () => router.push("/login"),
        },
        duration: 5000,
      });
      return;
    }

    try {
      const name = canvasName.trim() || `${config.label} - ${new Date().toLocaleDateString("zh-CN")}`;
      const canvas = await createCanvas.mutateAsync({ name });
      // 有产品图：直接进画布——参考图节点自动挂载，Chat Agent 按输入开工
      if (productImage) {
        router.push(
          buildCanvasUrl(canvas.canvas_id, {
            textModelId: textModelId || undefined,
            imageModelId: imageModelId || undefined,
            videoModelId: videoModelId || undefined,
            prompt: input.trim(),
            mode,
            productAssetId: productImage.assetId,
          }),
        );
        setInput("");
        return;
      }
      const conv = await createConversation.mutateAsync({ canvasId: canvas.canvas_id });
      // Open generation overlay instead of navigating immediately
      setGenerationState({
        canvasId: canvas.canvas_id,
        conversationId: conv.conversation.id,
        prompt: input.trim(),
        mode,
      });
      setInput("");
      setCanvasName("");
    } catch (err) {
      // Skip generic toast for UNAUTHORIZED — the global error handler already shows "请先登录"
      const trpcErr = err as { shape?: { data?: { code?: string } } };
      if (trpcErr.shape?.data?.code === "UNAUTHORIZED") return;
      toast.error(t("createFailed"));
    }
  };

  return (
    <>
      <div ref={rootRef} className="flex flex-col min-h-full bg-[var(--color-canvas)]">
        {/* ═══ Hero — Cursor editorial voice × Linear surface ═══ */}
        <section className="relative flex flex-col items-center px-6 pt-28 pb-16 overflow-hidden">
          <StarfieldBackground className="pointer-events-none absolute inset-0 h-full w-full opacity-45" />
          <CinematicBackdrop className="pointer-events-none absolute inset-0 h-full w-full" />

          <div className="relative z-10 text-center max-w-[680px]">
            {/* Eyebrow */}
            <div data-motion className="inline-flex items-center gap-2 px-4 py-1.5 mb-8 rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-[11px] font-semibold text-[var(--color-ink-subtle)] tracking-[var(--tracking-eyebrow)] uppercase">
              {t("badge")}
            </div>

            {/* Display — Cursor editorial: 400-600 weight, negative tracking */}
            <h1 data-motion className="text-[var(--hero-title-size)] font-[var(--hero-title-weight)] text-[var(--color-ink)] leading-[var(--hero-title-leading)] tracking-[var(--hero-title-tracking)]">
              {t("title")}
            </h1>
            <p data-motion className="text-[var(--text-body-lg)] text-[var(--color-ink-muted)] mt-5 max-w-[520px] mx-auto leading-[var(--leading-relaxed)]">
              {t("subtitle")}
            </p>
          </div>

          {/* Mode toggle — pill segment */}
          <div data-motion className="relative z-10 mt-12 inline-flex bg-[var(--color-surface-1)] rounded-full p-1 border border-[var(--color-hairline)]">
            {(Object.entries(MODES) as [CreateMode, typeof config][]).map(([m, mc]) => {
              const active = mode === m;
              const ModeIcon = mc.icon;
              return (
                <button key={m} onClick={() => setMode(m)} className={cn(
                  "relative flex items-center gap-2.5 px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200",
                  active ? "bg-[var(--color-accent)] text-[var(--color-accent-on)] shadow-[var(--shadow-accent-sm)]" : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
                )}>
                  <ModeIcon className="size-4" />
                  {mc.label}
                </button>
              );
            })}
          </div>

          <p data-motion className="relative z-10 text-xs text-[var(--color-ink-subtle)] text-center mt-5 max-w-[440px] leading-relaxed">{config.desc}</p>

          {/* Model selectors — wrap on narrow screens */}
          <div data-motion className="relative z-10 mx-auto mt-6 flex w-full max-w-[680px] flex-wrap items-center justify-center gap-3 px-4">
            <div className="flex items-center gap-2">
              <Type className="size-3 text-[var(--color-ink-subtle)]" />
              <ModelSelect
                type="text"
                value={textModelId}
                onChange={setTextModelId}
                placeholder="选择文本模型"
              />
            </div>
            <div className="flex items-center gap-2">
              <ImageIcon className="size-3 text-[var(--color-ink-subtle)]" />
              <ModelSelect
                type="image"
                value={imageModelId}
                onChange={setImageModelId}
                placeholder="选择图像模型"
              />
            </div>
            <div className="flex items-center gap-2">
              <Clapperboard className="size-3 text-[var(--color-ink-subtle)]" />
              <ModelSelect
                type="video"
                value={videoModelId}
                onChange={setVideoModelId}
                placeholder="选择视频模型"
              />
            </div>
          </div>

          {/* Input area — Linear card */}
          <div data-motion className="relative z-10 w-full max-w-[680px] mt-8 space-y-3">
            {/* 产品图上传（DAAI 输入流） */}
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleProductUpload(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploadingImage}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-hairline-strong)] px-3 py-2 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-60"
              >
                {uploadingImage ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                {uploadingImage ? "上传中…" : "上传产品图（可选）"}
              </button>
              {productImage && (
                <span className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={productImage.previewUrl} alt="产品图" className="size-12 rounded-lg border border-[var(--color-hairline)] object-cover" />
                  <button
                    type="button"
                    onClick={() => setProductImage(null)}
                    title="移除"
                    className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface-1)] text-[9px] text-[var(--color-ink-muted)] hover:text-[var(--color-danger)]"
                  >
                    ×
                  </button>
                </span>
              )}
              {productImage && (
                <span className="text-[11px] text-[var(--color-ink-subtle)]">将作为画面参考，保持产品一致</span>
              )}
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--color-ink-subtle)] block mb-2 ml-2">{t("canvasNameLabel")}</label>
              <Input value={canvasName} onChange={(e) => setCanvasName(e.target.value)} placeholder={t("canvasNamePlaceholder")} />
            </div>

            {/* Prompt card — Linear: hairline border, no shadow */}
            <div className="relative rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] transition-all duration-200 hover:border-[var(--color-hairline-strong)] group">
              <div className="absolute top-0 left-4 right-4 h-px opacity-0 group-hover:opacity-40 transition-opacity duration-500" style={{ background: "var(--gradient-brand)" }} />
              <div className="p-5">
                <Textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleCreate(); }} placeholder={config.placeholder} rows={mode === "idea" ? 3 : 8} className="min-h-[80px] border-0 bg-transparent resize-none focus-visible:ring-0 p-0 text-sm leading-relaxed placeholder:text-[var(--color-ink-tertiary)]" style={mode === "script" ? { minHeight: 180 } : undefined} />
                {/* 联想词：维度词条点击追加进输入（不覆盖已输入内容） */}
                <div className="mt-3">
                  <ThesaurusChips onAppend={(fragment) => setInput((v) => [v.trim(), fragment].filter(Boolean).join(", "))} />
                </div>
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--color-hairline)]">
                  <div className="flex items-center gap-2">
                    <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--color-surface-2)] text-[10px] font-mono text-[var(--color-ink-subtle)] border border-[var(--color-hairline)]">Ctrl + ↵</kbd>
                    <span className="text-[11px] text-[var(--color-ink-tertiary)]">{t("ctrlEnterHint")}</span>
                  </div>
                  <Button onClick={handleCreate} loading={createCanvas.isPending} disabled={!input.trim()} size="lg" leftIcon={<Sparkles className="size-3.5" />}>{config.submit}</Button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-[var(--color-ink-subtle)] ml-2 leading-relaxed opacity-60">{config.hint}</p>
          </div>

        </section>

        {/* ═══ 你想做什么？（创作目标 · DAAI 板块） ═══ */}
        <section className="px-6 pb-4 pt-8 max-w-[900px] mx-auto w-full">
          <div data-reveal className="mb-5 flex items-end justify-between">
            <div>
              <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">你想做什么？</h2>
              <p className="text-xs text-[var(--color-ink-subtle)] mt-1">选择一个创作目标，自动填入灵感起点</p>
            </div>
          </div>
          <div data-reveal className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {GOALS.map((goal) => { const Icon = goal.icon; return (
              <button
                key={goal.title}
                type="button"
                data-lift
                onClick={() => applyGoal(goal)}
                style={{ "--goal-tint": goal.tint } as React.CSSProperties}
                className="group relative overflow-hidden flex items-start gap-3 p-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] hover:border-[color:var(--goal-tint)] transition-colors duration-200 text-left"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(135deg, color-mix(in oklab, var(--goal-tint) 14%, transparent), transparent 55%)",
                  }}
                />
                <span
                  className="relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors"
                  style={{
                    backgroundColor: "color-mix(in oklab, var(--goal-tint) 18%, transparent)",
                    color: "var(--goal-tint)",
                  }}
                >
                  <Icon className="size-4" />
                </span>
                <span className="relative min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--color-ink)]">{goal.title}</span>
                  <span className="block text-[11px] text-[var(--color-ink-subtle)] mt-0.5">{goal.desc}</span>
                </span>
              </button>
            );})}
          </div>
        </section>

        {/* ═══ 常用工具 ═══ */}
        <section className="px-6 pb-4 pt-8 max-w-[900px] mx-auto w-full">
          <div data-reveal className="mb-5">
            <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">常用工具</h2>
          </div>
          <div data-reveal className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TOOLS.map((tool) => { const Icon = tool.icon; return (
              <a
                key={tool.href}
                href={tool.href}
                data-lift
                className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] hover:border-[var(--color-accent)] transition-colors duration-200 no-underline"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-3)] text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors">
                  <Icon className="size-4" />
                </span>
                <span className="text-[13px] font-medium text-[var(--color-ink)]">{tool.label}</span>
              </a>
            );})}
          </div>
        </section>

        {/* ═══ 灵感模板 ═══ */}
        {!templates.isLoading && (templates.data?.length ?? 0) > 0 && (
          <section className="px-6 pb-16 pt-8 max-w-[900px] mx-auto w-full">
            <div data-reveal className="mb-5 flex items-end justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-ink)] tracking-tight">灵感模板</h2>
                <p className="text-xs text-[var(--color-ink-subtle)] mt-1">一键套用完整工作流，创建即含全部节点</p>
              </div>
            </div>
            <div data-reveal className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(templates.data ?? []).slice(0, 4).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  data-lift
                  onClick={() => void useTemplate(tpl)}
                  disabled={instantiateTemplate.isPending || createCanvas.isPending}
                  className="group flex items-start gap-3 p-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] hover:border-[var(--color-accent)] transition-colors duration-200 text-left disabled:opacity-60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
                    <LayoutTemplate className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[var(--color-ink)] truncate">{tpl.name}</span>
                      <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] bg-[var(--color-surface-3)] text-[var(--color-ink-subtle)]">{tpl.nodeCount} 节点</span>
                    </span>
                    <span className="block text-[11px] text-[var(--color-ink-subtle)] mt-0.5 line-clamp-2">{tpl.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-tertiary)] group-hover:text-[var(--color-accent)] transition-colors" />
                </button>
              ))}
            </div>
          </section>
        )}

        <footer className="flex items-center justify-center gap-6 py-6 border-t border-[var(--color-hairline)] bg-[var(--color-surface-1)] shrink-0 mt-auto">
          <span className="text-[11px] text-[var(--color-ink-subtle)]">{t("footer")}</span>
          <span className="text-[11px] text-[var(--color-ink-tertiary)]">{t("footerPowered")}</span>
        </footer>
      </div>

      <WelcomeOverlay />

      {/* Generation overlay — shows AI streaming response after clicking generate */}
      {generationState && (
        <GenerationOverlay
          open={!!generationState}
          canvasId={generationState.canvasId}
          conversationId={generationState.conversationId}
          prompt={generationState.prompt}
          mode={generationState.mode}
          modelId={textModelId || undefined}
          onClose={() => setGenerationState(null)}
          onNavigate={(canvasId) => {
            const state = generationState;
            setGenerationState(null);
            utils.canvas.list.invalidate();
            router.push(
              `/project/${canvasId}`,
            );
            router.prefetch(
              buildCanvasUrl(canvasId, {
                textModelId: textModelId || undefined,
                imageModelId: imageModelId || undefined,
                videoModelId: videoModelId || undefined,
                prompt: state?.prompt,
                mode: state?.mode,
              }),
            );
          }}
        />
      )}
    </>
  );
}
