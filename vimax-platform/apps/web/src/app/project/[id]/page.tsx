"use client";

// ── Project page (result-first view, canvas-free UX) ────────────────
// 电商/短剧用户不读节点图：输入内容 → 等片子 → 看成片。这一页把画布的
// 产出按分镜顺序线性呈现：合成成片作主播放器，各镜头分段列出，可单独
// 重跑失败的段落。画布保留为「高级编辑」入口，不在此页打扰。

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { SkeletonList, cn } from "@vimax/ui";
import { toast } from "sonner";
import { AlertTriangle, Download, Film, Loader2, PencilRuler, RotateCcw } from "lucide-react";
import { useAssetSource } from "@/features/assets/useAssetSource";
import { runNodeWithLocalRestore } from "@/features/assets/restore-from-local";
import { downloadLocalAsset } from "@/lib/local-assets";

function AssetVideo({ assetId, className }: { assetId: string; className?: string }) {
  const { status, url } = useAssetSource(assetId);
  if (status !== "local" && status !== "cloud") {
    return (
      <div className={cn("flex items-center justify-center bg-[var(--color-surface-2)]", className)}>
        <Loader2 className="size-5 animate-spin text-[var(--color-ink-tertiary)]" />
      </div>
    );
  }
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <video src={url!} controls className={cn("w-full bg-black", className)} />;
}

function AssetDownload({ assetId }: { assetId: string }) {
  const { status, url } = useAssetSource(assetId);
  if (status === "loading") return null;
  // 本地金库直下；无本地副本时回退远端链接
  if (status === "local") {
    return (
      <button
        type="button"
        onClick={() => void downloadLocalAsset(assetId, `vimax-${assetId.slice(0, 8)}.mp4`)}
        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-hairline)] px-2 py-1 text-[11px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        <Download className="size-3" />
        下载
      </button>
    );
  }
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-hairline)] px-2 py-1 text-[11px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
    >
      <Download className="size-3" />
      下载
    </a>
  );
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const canvasId = params.id;

  const snapshot = trpc.canvas.snapshot.useQuery(
    { canvas_id: canvasId },
    // 生成期间自动轮询，全部完成后停止
    { refetchInterval: (query) => {
        const nodes = query.state.data?.nodes ?? [];
        const busy = nodes.some((n) => n.type === "video" || n.type === "concat");
        return busy ? 5000 : false;
      } },
  );

  const runNode = trpc.canvas.runNode.useMutation();
  const trpcUtils = trpc.useUtils();
  // 已本地化的输入资产（如参考图）会被服务端入队预检拦下，先从本地
  // 金库恢复再重试；本地也没有副本时抛出用户可读的提示。
  const runNodeRestored = (nodeId: string) =>
    runNodeWithLocalRestore(
      trpcUtils.client,
      { canvas_id: canvasId, node_id: nodeId },
      (input) => runNode.mutateAsync(input),
    );

  const model = useMemo(() => {
    const nodes = snapshot.data?.nodes ?? [];
    const edges = snapshot.data?.edges ?? [];

    const shotById = new Map(nodes.filter((n) => n.type === "shot").map((n) => [n.id, n]));
    const upMap = new Map<string, string[]>();
    for (const e of edges) {
      upMap.set(e.target_node_id, [...(upMap.get(e.target_node_id) ?? []), e.source_node_id]);
    }

    // 分镜顺序：每个视频段按其上游镜头的画布纵坐标排序（分区布局下
    // y 随分镜序递增），无上游时按节点创建时间兜底。
    const videoNodes = nodes
      .filter((n) => n.type === "video")
      .map((n) => {
        const shotId = upMap.get(n.id)?.find((s) => shotById.has(s));
        const shot = shotId ? shotById.get(shotId) : undefined;
        return { node: n, order: shot ? shot.position.y : Number.MAX_SAFE_INTEGER, shot };
      })
      .sort((a, b) => a.order - b.order);

    const concat = nodes.find((n) => n.type === "concat");
    const total = videoNodes.length;
    const done = videoNodes.filter((v) => v.node.output_asset_id).length;
    const failed = videoNodes.filter((v) => v.node.status === "failed").length;

    return { canvas: snapshot.data?.canvas, videoNodes, concat, total, done, failed };
  }, [snapshot.data]);

  if (snapshot.isLoading) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-10">
        <SkeletonList count={4} />
      </div>
    );
  }

  if (snapshot.isError || !model.canvas) {
    return (
      <div className="mx-auto flex max-w-[900px] flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-sm text-[var(--color-ink-muted)]">项目不存在或已删除</p>
        <Link href="/" className="text-sm text-[var(--color-accent)] no-underline">返回首页</Link>
      </div>
    );
  }

  const concatReady = !!model.concat?.output_asset_id;

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-[var(--color-ink)]">{model.canvas.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-xs text-[var(--color-ink-subtle)]">
            {model.total === 0 ? (
              "暂无视频段落，先在输入页创建内容"
            ) : model.failed > 0 ? (
              <>
                <AlertTriangle className="size-3.5 text-[var(--color-warning)]" />
                {model.failed} 段生成失败，可逐段重跑
              </>
            ) : model.done < model.total ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                生成中 {model.done}/{model.total} 段
              </>
            ) : (
              `全部 ${model.total} 段已生成`
            )}
          </p>
        </div>
        <Link
          href={`/canvas/${canvasId}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] transition-colors no-underline hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          title="进入节点画布进行精细调整"
        >
          <PencilRuler className="size-3.5" />
          高级编辑
        </Link>
      </div>

      {/* 主播放器：合成成片 */}
      {concatReady ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--color-hairline)] bg-black">
          <AssetVideo assetId={model.concat!.output_asset_id!} className="aspect-video" />
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface-1)]">
          <div className="text-center">
            <Film className="mx-auto size-8 text-[var(--color-ink-tertiary)]" />
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              {model.total === 0
                ? "等待内容创建"
                : model.done < model.total
                  ? `段落生成完成后自动合成成片（${model.done}/${model.total}）`
                  : "段落已就绪，点击下方「合成成片」按钮"}
            </p>
          </div>
        </div>
      )}

      {/* 合成按钮：段落齐备但 concat 无输出/失败时提供一键合成 */}
      {model.total >= 2 && model.done === model.total && !concatReady && model.concat && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            disabled={runNode.isPending}
            onClick={() =>
              runNodeRestored(model.concat!.id)
                .catch((err: unknown) => toast.error((err as Error).message.slice(0, 80)))
            }
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            {runNode.isPending ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
            合成成片
          </button>
        </div>
      )}

      {/* 分镜段落 */}
      {model.videoNodes.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-base font-semibold text-[var(--color-ink)]">分镜段落</h2>
          <div className="space-y-4">
            {model.videoNodes.map(({ node, shot }, index) => {
              const status = node.status;
              const prompt = ((shot?.data as Record<string, unknown> | undefined)?.ffDesc as string) ?? "";
              return (
                <div
                  key={node.id}
                  className="flex gap-4 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] p-4"
                >
                  <div className="w-[220px] shrink-0">
                    {node.output_asset_id ? (
                      <AssetVideo assetId={node.output_asset_id} className="aspect-video rounded-lg" />
                    ) : (
                      <div
                        className={cn(
                          "flex aspect-video items-center justify-center rounded-lg",
                          status === "failed"
                            ? "border border-[var(--color-danger)] bg-[var(--color-danger-subtle)]"
                            : "border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface-2)]",
                        )}
                      >
                        {status === "failed" ? (
                          <button
                            type="button"
                            title="重跑这一段"
                            onClick={() =>
                              runNodeRestored(node.id)
                                .catch((err: unknown) => toast.error((err as Error).message.slice(0, 60)))
                            }
                            className="flex items-center gap-1.5 rounded-md border border-[var(--color-danger)] px-3 py-1.5 text-xs text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-subtle)]"
                          >
                            <RotateCcw className="size-3.5" />
                            重跑
                          </button>
                        ) : (
                          <Loader2 className="size-6 animate-spin text-[var(--color-ink-tertiary)]" />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--color-ink)]">第 {index + 1} 镜</span>
                      {status === "done" && node.output_asset_id && <AssetDownload assetId={node.output_asset_id} />}
                    </div>
                    {prompt && (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">{prompt}</p>
                    )}
                    <div className="mt-auto pt-2 text-[11px] text-[var(--color-ink-tertiary)]">
                      {status === "done"
                        ? "已生成"
                        : status === "failed"
                          ? "生成失败"
                          : status === "running"
                            ? "生成中…"
                            : "排队中"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
