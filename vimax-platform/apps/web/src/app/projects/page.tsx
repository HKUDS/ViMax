"use client";

import { useState } from "react";
import { ChevronRight, Clock, Film, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, EmptyState, PageContainer, PageHeader, SkeletonList, useToast } from "@vimax/ui";
import { trpc } from "@/lib/trpc/client";

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const listCanvases = trpc.canvas.list.useQuery({ limit: 50 });
  const deleteCanvas = trpc.canvas.delete.useMutation();
  const utils = trpc.useUtils();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const projects = listCanvases.data?.items ?? [];

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCanvas.mutateAsync({ canvas_id: deleteTarget.id });
      utils.canvas.list.invalidate();
      toast.success(t("deleteSuccess", { name: deleteTarget.name }));
    } catch (err) {
      const trpcErr = err as { shape?: { data?: { code?: string } } };
      if (trpcErr.shape?.data?.code === "UNAUTHORIZED") return;
      toast.error(t("deleteFailed"));
    }
    setDeleteTarget(null);
  };

  return (
    <PageContainer maxWidth="xl">
      <PageHeader title={t("title")} description={t("xProjects", { count: projects.length })} className="mb-8" />

      {listCanvases.isLoading ? (
        <SkeletonList count={6} />
      ) : projects.length === 0 ? (
        <EmptyState title={t("noProjects")} description={t("noProjectsDesc")} />
      ) : (
        <div className="grid gap-2">
          {projects.map((p) => (
            <div
              key={p.canvas_id}
              className="group flex items-center gap-4 px-5 py-3.5 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] hover:border-[var(--color-hairline-strong)] hover:bg-[var(--color-surface-2)] transition-colors duration-200"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-accent-subtle)] shrink-0 group-hover:bg-[var(--color-accent-muted)] transition-colors">
                <Film className="size-4 text-[var(--color-accent)]" />
              </div>
              <a href={`/project/${p.canvas_id}`} className="flex-1 flex items-center justify-between no-underline text-inherit min-w-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--color-ink)] truncate group-hover:text-[var(--color-accent)] transition-colors">{p.name}</div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-subtle)] mt-0.5">
                    <span>{p.node_count} 节点</span>
                    <span className="flex items-center gap-1"><Clock className="size-2.5" />{new Date(p.updated_at).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <ChevronRight className="size-4 text-[var(--color-ink-tertiary)] opacity-0 group-hover:opacity-100 transition-all" />
              </a>
              <button
                onClick={() => setDeleteTarget({ id: p.canvas_id, name: p.name })}
                title={t("confirmDelete")}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--color-ink-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)] transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t("confirmDelete")}
        description={t("confirmDeleteDesc", { name: deleteTarget?.name ?? "" })}
        confirmLabel={tc("delete")}
        cancelLabel={tc("cancel")}
        variant="danger"
      />
    </PageContainer>
  );
}
