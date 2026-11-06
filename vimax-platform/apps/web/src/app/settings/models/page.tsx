"use client";

import { PageContainer } from "@vimax/ui";
import { Cpu } from "lucide-react";
import { useTranslations } from "next-intl";
import { ModelsSettingsPanel } from "../components/ModelsSettingsPanel";

export default function ModelsPage() {
  const t = useTranslations("settings");

  return (
    <PageContainer maxWidth="md">
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <Cpu className="size-5 text-[var(--color-accent)]" />
          <h1 className="text-xl font-bold text-[var(--color-text)]">
            {t("models.title")}
          </h1>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          管理文本、图像、视频模型的配置
        </p>
      </div>
      <ModelsSettingsPanel />
    </PageContainer>
  );
}
