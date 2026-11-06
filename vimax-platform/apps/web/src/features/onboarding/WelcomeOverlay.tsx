"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@vimax/ui";
import { Sparkles, Film, Image, GitBranch, MessageCircle, Zap, X, ChevronRight, ChevronLeft } from "lucide-react";

const STORAGE_KEY = "vimax-onboarding-complete";

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: <Film className="size-8 text-[var(--color-accent)]" />,
    title: "欢迎来到 ViMax Studio",
    description: "AI 驱动的视频生成工作台——从创意到视频，一站式完成编剧、分镜、生成和剪辑。",
  },
  {
    icon: <GitBranch className="size-8 text-[var(--color-accent)]" />,
    title: "无限画布工作流",
    description: "在画布上自由拖拽和组织节点——剧本、角色、分镜、镜头、图片、视频，构建你的 DAG 生成流水线。",
  },
  {
    icon: <MessageCircle className="size-8 text-[var(--color-accent)]" />,
    title: "AI 智能协作",
    description: "与 AI Agent 对话，它会自动创建节点、生成内容、修改画布——就像有个创作伙伴在你身边。",
  },
  {
    icon: <Zap className="size-8 text-[var(--color-accent)]" />,
    title: "快速上手",
    description: "在首页输入你的想法或剧本，AI 将自动搭建画布并开始生成。按下 Ctrl+K 随时搜索，按 ? 查看快捷键。",
  },
];

export function WelcomeOverlay() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [exiting, setExiting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if onboarding already completed
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      // Small delay for smooth entrance
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, []);

  const close = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      localStorage.setItem(STORAGE_KEY, "true");
    }, 300);
  }, []);

  const nextStep = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  }, [step, close]);

  const prevStep = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      ref={overlayRef}
      className={cn(
        "fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-md transition-opacity duration-300",
        exiting ? "opacity-0" : "opacity-100",
      )}
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div
        className={cn(
          "relative w-full max-w-md mx-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl p-8 transition-all duration-300",
          exiting ? "scale-95 opacity-0" : "scale-100 opacity-100",
        )}
      >
        {/* Close button */}
        <button
          onClick={close}
          className="absolute top-4 right-4 p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
        >
          <X className="size-4" />
        </button>

        {/* Step indicator dots */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-all duration-300",
                i === step ? "w-4 bg-[var(--color-accent)]" : "bg-[var(--color-border)]",
              )}
            />
          ))}
        </div>

        {/* Content */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-xl bg-[var(--color-accent-subtle)]">
              {current.icon}
            </div>
          </div>
          <h2 className="text-lg font-bold text-[var(--color-text)] mb-2">
            {current.title}
          </h2>
          <p className="text-sm text-[var(--color-text-muted)] leading-relaxed max-w-sm mx-auto">
            {current.description}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={prevStep}
            disabled={step === 0}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              step === 0
                ? "text-[var(--color-text-dim)] cursor-not-allowed"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]",
            )}
          >
            <ChevronLeft className="size-3.5" />
            上一步
          </button>

          {isLast ? (
            <button
              onClick={close}
              className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              <Sparkles className="size-4" />
              开始创作
            </button>
          ) : (
            <button
              onClick={nextStep}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              下一步
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>

        {/* Skip link */}
        {!isLast && (
          <button
            onClick={close}
            className="block mx-auto mt-4 text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)] transition-colors"
          >
            跳过引导
          </button>
        )}
      </div>
    </div>
  );
}
