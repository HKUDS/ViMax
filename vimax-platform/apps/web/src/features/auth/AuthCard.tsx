"use client";

// Auth card in the DAAI/LibTV pattern: one modal card, two tabs (login /
// signup), agreement checkbox, a single primary button that both logs in
// and registers. Kept free of fake abilities — only email+password, which
// the backend really supports.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, useToast, cn } from "@vimax/ui";
import { Film, Lock, Mail, User, X } from "lucide-react";
import { CinematicBackdrop } from "@/features/home/CinematicBackdrop";
import { useAuth } from "./AuthProvider";

type AuthMode = "login" | "signup";

export function AuthCard({ initialMode = "login", onDone }: { initialMode?: AuthMode; onDone?: () => void }) {
  const router = useRouter();
  const { login, signup } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const finish = (message: string) => {
    toast.success(message);
    onDone?.();
    router.push("/");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === "signup") {
      if (!agreed) {
        toast.warning("请先阅读并同意用户服务协议");
        return;
      }
      if (password.length < 6) {
        toast.warning("密码至少 6 个字符");
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
        finish("登录成功");
      } else {
        await signup(email.trim(), password, name.trim() || email.trim().split("@")[0], inviteCode.trim());
        finish("注册成功，已自动登录");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative w-full max-w-[400px] rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] p-7 shadow-lg">
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">
        {mode === "login" ? "欢迎使用 ViMax" : "创建你的 ViMax 账号"}
      </h1>

      {/* Mode tabs */}
      <div className="mt-5 grid grid-cols-2 rounded-lg bg-[var(--color-surface-2)] p-1">
        {(["login", "signup"] as AuthMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md py-1.5 text-[13px] font-medium transition-colors",
              mode === m
                ? "bg-[var(--color-surface-1)] text-[var(--color-ink)] shadow-sm"
                : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
            )}
          >
            {m === "login" ? "密码登录" : "邮箱注册"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        {mode === "signup" && (
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-tertiary)]" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入昵称" className="pl-9" />
          </div>
        )}
        {mode === "signup" && (
          <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="团队邀请码（生产环境必填）" />
        )}
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-tertiary)]" />
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="请输入邮箱"
            className="pl-9"
            required
          />
        </div>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-tertiary)]" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码（至少 6 位）"
            className="pl-9"
            required
          />
        </div>

        {mode === "signup" && (
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--color-ink-subtle)]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--color-accent)]"
            />
            <span>
              我已阅读并同意
              <span className="font-medium text-[var(--color-ink)]"> 用户服务协议 </span>与
              <span className="font-medium text-[var(--color-ink)]"> 隐私政策</span>
            </span>
          </label>
        )}

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {mode === "login" ? "登录" : "注册并登录"}
        </Button>
      </form>
    </div>
  );
}

/** Global modal wrapper: dims the page, closes on backdrop/Escape. */
export function AuthDialog({
  open,
  initialMode = "login",
  onClose,
}: {
  open: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 flex size-7 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface-1)] text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          title="关闭"
          aria-label="关闭"
        >
          <X className="size-3.5" />
        </button>
        <AuthCard initialMode={initialMode} onDone={onClose} />
      </div>
    </div>
  );
}

/** Standalone auth page (kept for /login and /signup deep links). */
export function AuthPage({ initialMode }: { initialMode: AuthMode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-bg)] p-4">
      <CinematicBackdrop className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative z-10 w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: "var(--gradient-brand)" }}>
              <Film className="size-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">ViMax</span>
          </Link>
        </div>
        <AuthCard initialMode={initialMode} />
        <p className="mt-5 text-center text-[11px] text-[var(--color-ink-tertiary)]">
          <Link href="/" className="transition-colors hover:text-[var(--color-ink-muted)]">返回首页</Link>
        </p>
      </div>
    </div>
  );
}
