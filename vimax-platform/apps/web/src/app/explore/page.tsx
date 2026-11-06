"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PageContainer, PageHeader, EmptyState, SkeletonList, Input, Button, useToast } from "@vimax/ui";
import { Search, LayoutTemplate, ChevronRight, Sparkles, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

// ── Explore — 灵感模板（真数据）────────────────────────────────────
// 社区作品流上线前，探索页以画布模板库为数据源：搜索 + 一键套用，
// 点击即创建含完整工作流节点的画布。不做任何假数据兜底。

export default function ExplorePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const templatesQuery = trpc.canvas.listTemplates.useQuery();
  const createCanvas = trpc.canvas.create.useMutation();
  const instantiateTemplate = trpc.canvas.instantiateTemplate.useMutation();

  const templates = templatesQuery.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const s = search.trim().toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        (t.description ?? "").toLowerCase().includes(s),
    );
  }, [templates, search]);

  const useTemplate = async (tpl: { id: string; name: string }) => {
    try {
      const c = await createCanvas.mutateAsync({ name: tpl.name });
      await instantiateTemplate.mutateAsync({ canvas_id: c.canvas_id, template_id: tpl.id });
      router.push(`/canvas/${c.canvas_id}`);
    } catch (err) {
      const trpcErr = err as { shape?: { data?: { code?: string } } };
      if (trpcErr.shape?.data?.code === "UNAUTHORIZED") return;
      toast.error("模板创建失败，请稍后重试");
    }
  };

  return (
    <PageContainer maxWidth="xl">
      <PageHeader
        title="发现"
        description="浏览灵感模板，一键套用完整工作流，创建即含全部节点"
      />

      {/* Search */}
      <div className="relative mt-6 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-subtle)]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索模板…"
          aria-label="搜索模板"
          className="pl-9"
        />
      </div>

      {/* Template Grid */}
      <div className="mt-6">
        {templatesQuery.isLoading ? (
          <SkeletonList count={6} />
        ) : templatesQuery.isError ? (
          <EmptyState
            icon={<RefreshCw className="size-5" />}
            title="模板加载失败"
            description="请检查网络后重试"
            action={<Button variant="secondary" onClick={() => void templatesQuery.refetch()}>重新加载</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title={search ? "没有找到匹配的模板" : "暂无可用模板"}
            description={search ? "尝试调整搜索关键词" : "模板上线后将在这里展示"}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => void useTemplate(tpl)}
                disabled={createCanvas.isPending || instantiateTemplate.isPending}
                className="group flex items-start gap-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] p-4 text-left transition-colors duration-200 hover:border-[var(--color-accent)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-focus)]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-subtle)] text-[var(--color-accent)] transition-colors group-hover:bg-[var(--color-accent-muted)]">
                  <LayoutTemplate className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--color-ink)] group-hover:text-[var(--color-accent)] transition-colors">
                      {tpl.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-[var(--color-surface-3)] px-1.5 py-px text-[10px] text-[var(--color-ink-subtle)]">
                      {tpl.nodeCount} 节点
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-[var(--color-ink-subtle)]">
                    {tpl.description || "套用后将创建完整工作流"}
                  </span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-[var(--color-ink-tertiary)] transition-colors group-hover:text-[var(--color-accent)]" />
              </button>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
