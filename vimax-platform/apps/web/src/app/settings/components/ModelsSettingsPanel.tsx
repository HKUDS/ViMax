"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button, Badge, Dialog, useToast } from "@vimax/ui";
import type { ModelType } from "@vimax/contracts";
import { Plus, Pencil, Trash2, Cpu, Type, Image as ImageIcon, Clapperboard } from "lucide-react";

// ── Model Type Tabs ────────────────────────────────────────────────────

const MODEL_TYPE_TABS: { type: ModelType; label: string; icon: typeof Type }[] = [
  { type: "text", label: "文本模型", icon: Type },
  { type: "image", label: "图像模型", icon: ImageIcon },
  { type: "video", label: "视频模型", icon: Clapperboard },
];

// ── Model Form Fields ──────────────────────────────────────────────────

interface ModelFormData {
  name: string;
  type: ModelType;
  provider: string;
  vendorId: string;
  vendorModelId: string;
  classPath: string;
  baseUrl: string;
  apiKey: string;
  isDefault: boolean;
  isEnabled: boolean;
  config: string; // JSON string for editing
}

const EMPTY_FORM: ModelFormData = {
  name: "",
  type: "text",
  provider: "",
  vendorId: "",
  vendorModelId: "",
  classPath: "",
  baseUrl: "",
  apiKey: "",
  isDefault: false,
  isEnabled: true,
  config: "{}",
};

// ── Component ──────────────────────────────────────────────────────────

export function ModelsSettingsPanel() {
  const [activeType, setActiveType] = useState<ModelType>("text");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ModelFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const { toast } = useToast();

  const utils = trpc.useUtils();

  // Queries
  const { data, isLoading } = trpc.modelConfig.list.useQuery(
    { type: activeType },
    { staleTime: 30_000 },
  );

  // Mutations
  const createMut = trpc.modelConfig.create.useMutation();
  const updateMut = trpc.modelConfig.update.useMutation();
  const deleteMut = trpc.modelConfig.delete.useMutation();

  const models = data?.items ?? [];

  // ── Form handlers ─────────────────────────────────────────────────

  const openCreateForm = (type: ModelType) => {
    setFormData({ ...EMPTY_FORM, type });
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (model: (typeof models)[number]) => {
    setFormData({
      name: model.name,
      type: model.type,
      provider: model.provider,
      vendorId: model.vendorId ?? "",
      vendorModelId: model.vendorModelId ?? "",
      classPath: model.classPath ?? "",
      baseUrl: model.baseUrl ?? "",
      apiKey: (model as any).apiKey ?? "",
      isDefault: model.isDefault,
      isEnabled: model.isEnabled,
      config: JSON.stringify(model.config, null, 2),
    });
    setEditingId(model.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      const input = {
        name: formData.name,
        type: formData.type,
        provider: formData.provider,
        vendorId: formData.vendorId || undefined,
        vendorModelId: formData.vendorModelId || undefined,
        classPath: formData.classPath || undefined,
        baseUrl: formData.baseUrl || undefined,
        apiKey: formData.apiKey || undefined,
        isDefault: formData.isDefault,
        isEnabled: formData.isEnabled,
        config: (() => { try { return JSON.parse(formData.config); } catch { return {}; } })(),
      };

      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, ...input });
        toast("模型已更新");
      } else {
        await createMut.mutateAsync(input);
        toast("模型已创建");
      }

      setShowForm(false);
      utils.modelConfig.list.invalidate({ type: activeType });
    } catch (err) {
      toast.error(`保存失败: ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget });
      toast("模型已删除");
      setDeleteTarget(null);
      utils.modelConfig.list.invalidate({ type: activeType });
    } catch (err) {
      toast.error(`删除失败: ${(err as Error).message}`);
    }
  };

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div>
      {/* Type tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--color-hairline)] pb-0">
        {MODEL_TYPE_TABS.map((tab) => (
          <button
            key={tab.type}
            onClick={() => setActiveType(tab.type)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px"
            style={{
              borderBottomColor: activeType === tab.type
                ? "var(--color-accent)"
                : "transparent",
              color: activeType === tab.type
                ? "var(--color-text)"
                : "var(--color-text-muted)",
            }}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Add button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          {models.length} 个模型
        </p>
        <Button
          size="sm"
          leftIcon={<Plus className="size-3" />}
          onClick={() => openCreateForm(activeType)}
        >
          添加模型
        </Button>
      </div>

      {/* Model list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-[var(--color-surface-1)] animate-pulse" />
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-12">
          <Cpu className="size-8 text-[var(--color-text-dim)] mx-auto mb-3" />
          <p className="text-sm text-[var(--color-text-muted)]">暂无模型配置</p>
          <p className="text-xs text-[var(--color-text-dim)] mt-1">点击「添加模型」开始配置</p>
        </div>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <div
              key={model.id}
              className="flex items-center gap-4 px-4 py-3 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)] hover:border-[var(--color-hairline-strong)] transition-all"
            >
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)] truncate">
                    {model.name}
                  </span>
                  {model.isDefault && (
                    <Badge variant="accent">默认</Badge>
                  )}
                  {!model.isEnabled && (
                    <Badge variant="warning">已禁用</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {model.provider}
                  </span>
                  {model.vendorModelId && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-[var(--color-ink-tertiary)] opacity-40" />
                      <span className="text-[11px] text-[var(--color-text-dim)] font-mono">
                        {model.vendorModelId}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEditForm(model)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
                  title="编辑"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => setDeleteTarget(model.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)] transition-colors"
                  title="删除"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add/Edit Model Dialog ── */}
      {showForm && (
        <Dialog
          open={showForm}
          onClose={() => setShowForm(false)}
          title={editingId ? "编辑模型" : "添加模型"}
        >
          <div className="space-y-4 mt-4">
            {/* ── 基本信息（必填） ── */}
            <div className="pb-4 border-b border-[var(--color-hairline)]">
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">基本信息</p>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                      模型名称 <span className="text-[var(--color-danger)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                      placeholder="例如: GPT-4o"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                      类型
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as ModelType })}
                      disabled={!!editingId}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] appearance-none"
                    >
                      <option value="text">文本 (text)</option>
                      <option value="image">图像 (image)</option>
                      <option value="video">视频 (video)</option>
                      <option value="tts">语音 (tts)</option>
                      <option value="embedding">嵌入 (embedding)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    提供商 <span className="text-[var(--color-danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.provider}
                    onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                    placeholder="例如: openai, doubao, google"
                  />
                </div>
              </div>
            </div>

            {/* ── 接口配置（必填） ── */}
            <div className="pb-4 border-b border-[var(--color-hairline)]">
              <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">接口配置</p>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={formData.baseUrl}
                    onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                    placeholder="例如: https://api.openai.com/v1"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    模型 ID <span className="text-[var(--color-danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.vendorModelId}
                    onChange={(e) => setFormData({ ...formData, vendorModelId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] font-mono"
                    placeholder="例如: gpt-4o, glm-4.7, cogview-3-flash"
                  />
                  <p className="text-[10px] text-[var(--color-text-dim)] mt-1">
                    实际调用时发送给服务商的模型 ID（名称仅用于显示）
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                    placeholder={editingId ? "留空则保持不变" : "输入 API Key"}
                  />
                  {editingId && (
                    <p className="text-[10px] text-[var(--color-text-dim)] mt-1">留空表示不修改已有的 Key</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── 高级配置 ── */}
            <details className="group">
              <summary className="cursor-pointer text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider hover:text-[var(--color-text)] transition-colors">
                高级配置
              </summary>

              <div className="space-y-3 mt-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    Vendor ID
                  </label>
                  <input
                    type="text"
                    value={formData.vendorId}
                    onChange={(e) => setFormData({ ...formData, vendorId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                    placeholder="例如: openai-compatible"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    Class Path (Worker 调度用)
                  </label>
                  <input
                    type="text"
                    value={formData.classPath}
                    onChange={(e) => setFormData({ ...formData, classPath: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                    placeholder="例如: tools.ImageGeneratorDoubaoSeedreamYunwuAPI"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-text-muted)] mb-1">
                    配置 (JSON)
                  </label>
                  <textarea
                    value={formData.config}
                    onChange={(e) => setFormData({ ...formData, config: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] font-mono resize-y"
                    placeholder='{}'
                  />
                </div>
              </div>
            </details>

            {/* ── 状态开关 ── */}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded"
                />
                设为默认
              </label>

              <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isEnabled}
                  onChange={(e) => setFormData({ ...formData, isEnabled: e.target.checked })}
                  className="rounded"
                />
                启用
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-hairline)]">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                取消
              </Button>
              <Button
                onClick={handleSave}
                loading={createMut.isPending || updateMut.isPending}
                disabled={!formData.name.trim() || !formData.provider.trim()}
              >
                {editingId ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* ── Delete Confirmation ── */}
      {deleteTarget && (
        <Dialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          title="确认删除"
        >
          <div className="mt-4 space-y-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              此操作无法撤销。确定要删除此模型配置吗？
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                取消
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                loading={deleteMut.isPending}
              >
                删除
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
