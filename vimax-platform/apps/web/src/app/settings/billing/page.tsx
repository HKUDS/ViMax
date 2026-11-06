"use client";

import { useState } from "react";
import { PageContainer, Button, Badge, cn } from "@vimax/ui";
import { Check, Zap, Building2, ArrowRight, Star } from "lucide-react";

// ── Plan Config ─────────────────────────────────────────────────────

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  highlighted?: boolean;
}

const PLANS: Plan[] = [
  {
    id: "free",
    name: "免费版",
    price: "免费",
    period: "永久",
    desc: "适合个人体验和探索",
    features: ["每月 10 次视频生成", "1 GB 存储空间", "最多 5 个项目", "基础 AI 模型", "社区支持"],
  },
  {
    id: "pro",
    name: "专业版",
    price: "¥99",
    period: "/月",
    desc: "适合专业创作者和小团队",
    highlighted: true,
    features: ["每月 100 次视频生成", "50 GB 存储空间", "无限项目", "高级 AI 模型", "优先渲染队列", "API 密钥自定义", "邮件支持"],
  },
  {
    id: "enterprise",
    name: "企业版",
    price: "¥499",
    period: "/月",
    desc: "适合团队协作和商业使用",
    features: ["无限视频生成", "500 GB 存储空间", "无限项目与协作", "全部 AI 模型", "最高渲染优先级", "OAuth / SSO 集成", "7×24 专属支持", "SLA 保障"],
  },
];

// ── Usage Mock ───────────────────────────────────────────────────────

const USAGE_STATS = [
  { label: "本月生成次数", value: 7, max: 10, unit: "次" },
  { label: "存储使用量", value: 0.34, max: 1, unit: "GB" },
  { label: "本月项目数", value: 3, max: 5, unit: "个" },
];

// ── Page ─────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [currentPlan] = useState<string>("free");

  return (
    <PageContainer maxWidth="lg">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-bold text-[var(--color-text)]">计费与订阅</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">选择适合你的套餐，解锁更多创作能力</p>
      </div>

      {/* Current Plan + Usage */}
      <div className="mb-10 p-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">当前套餐</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              <Badge variant="default">
                {PLANS.find((p) => p.id === currentPlan)?.name ?? "免费版"}
              </Badge>
            </p>
          </div>
          <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="size-3.5" />}>
            查看使用详情
          </Button>
        </div>

        {/* Usage bars */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">用量概览</h3>
          {USAGE_STATS.map((stat) => {
            const pct = Math.min((stat.value / stat.max) * 100, 100);
            const isHigh = pct > 80;
            return (
              <div key={stat.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-text-muted)]">{stat.label}</span>
                  <span className={cn("font-medium", isHigh ? "text-[var(--color-danger)]" : "text-[var(--color-text)]")}>
                    {stat.value} / {stat.max} {stat.unit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-bg)] overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", isHigh ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <div
              key={plan.id}
              className={cn(
                "relative rounded-2xl border p-6 transition-all duration-200 hover:shadow-md",
                plan.highlighted
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] shadow-lg shadow-[var(--color-accent)]/10"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-hover)]",
              )}
            >
              {plan.highlighted && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <span className="flex items-center gap-1 px-3 py-0.5 rounded-full text-[10px] font-bold bg-[var(--color-accent)] text-[var(--color-accent-on)]">
                    <Star className="size-3 fill-white" />
                    推荐
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h3 className="text-base font-bold text-[var(--color-text)]">{plan.name}</h3>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{plan.desc}</p>
              </div>

              <div className="mb-5">
                <span className="text-2xl font-bold text-[var(--color-text)]">{plan.price}</span>
                <span className="text-sm text-[var(--color-text-muted)]">{plan.period}</span>
              </div>

              <ul className="space-y-2 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]">
                    <Check className="size-3.5 text-[var(--color-success)] shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <Button disabled className="w-full" variant="secondary" size="sm">
                  当前方案
                </Button>
              ) : (
                <Button
                  className="w-full"
                  size="sm"
                  variant={plan.highlighted ? "primary" : "secondary"}
                >
                  {plan.id === "enterprise" ? (
                    <span className="flex items-center gap-1.5">
                      <Building2 className="size-3.5" />
                      联系销售
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Zap className="size-3.5" />
                      升级到 {plan.name}
                    </span>
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </PageContainer>
  );
}
