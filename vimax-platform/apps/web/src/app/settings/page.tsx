"use client";

import { Tabs, Button, Input, Select, Switch, useToast, PageContainer, PageHeader } from "@vimax/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { User, Key, Settings2, CreditCard, Cpu } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const t = useTranslations("settings");
  const tModels = useTranslations("settings.models");
  const [tab, setTab] = useState("profile");

  // Navigate to billing page when billing tab is selected
  useEffect(() => {
    if (tab === "billing") {
      router.push("/settings/billing");
    }
  }, [tab, router]);

  // Navigate to standalone models page when models tab is selected
  useEffect(() => {
    if (tab === "models") {
      router.push("/settings/models");
    }
  }, [tab, router]);

  // Preferences state
  const [theme, setTheme] = useState("system");
  const [language, setLanguage] = useState("zh-CN");

  const tabs = [
    { id: "profile", label: t("profile"), icon: <User className="size-3.5" /> },
    { id: "api-keys", label: t("apiKeys"), icon: <Key className="size-3.5" /> },
    { id: "models", label: tModels("title"), icon: <Cpu className="size-3.5" /> },
    { id: "preferences", label: t("preferences"), icon: <Settings2 className="size-3.5" /> },
    { id: "billing", label: t("billing"), icon: <CreditCard className="size-3.5" /> },
  ];

  return (
    <PageContainer maxWidth="md">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-[var(--color-text)]">{t("title")}</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{t("subtitle")}</p>
      </div>

      <Tabs tabs={tabs} activeTab={tab} onTabChange={setTab}>
        <div className="pt-6">
          {/* ── Profile Tab ── */}
          {tab === "profile" && (
            <div className="space-y-6 max-w-md">
              {user ? (
                <>
                  <div className="flex items-center gap-4">
                    <div className="size-16 rounded-full bg-[var(--color-accent-subtle)] flex items-center justify-center">
                      <span className="text-xl font-bold text-[var(--color-accent)]">
                        {user.name.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-[var(--color-text)]">{user.name}</h2>
                      <p className="text-sm text-[var(--color-text-muted)]">{user.email}</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">{t("nameLabel")}</label>
                    <Input value={user.name} disabled />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">{t("emailLabel")}</label>
                    <Input value={user.email} disabled />
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">{t("loginRequired")}</p>
              )}
            </div>
          )}

          {/* ── API Keys Tab ── */}
          {tab === "api-keys" && (
            <div className="space-y-4 max-w-md">
              <p className="text-sm text-[var(--color-text-muted)]">{t("apiKeysDesc")}</p>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                  {t("arkApiKey")}
                </label>
                <Input type="password" placeholder="••••••••" disabled />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                  {t("openaiApiKey")}
                </label>
                <Input type="password" placeholder="••••••••" disabled />
              </div>

              <p className="text-xs text-[var(--color-text-dim)]">{t("apiKeysHint")}</p>
            </div>
          )}

          {/* ── Models Tab ── */}
          {tab === "models" && (
            <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              {t("redirectingModels")}
            </div>
          )}

          {/* ── Preferences Tab ── */}
          {tab === "preferences" && (
            <div className="space-y-6 max-w-md">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{t("themeLabel")}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t("themeDesc")}</p>
                </div>
                <Select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  options={[
                    { value: "system", label: t("themeSystem") },
                    { value: "dark", label: t("themeDark") },
                    { value: "light", label: t("themeLight") },
                  ]}
                  className="w-32"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{t("languageLabel")}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t("languageDesc")}</p>
                </div>
                <Select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  options={[
                    { value: "zh-CN", label: t("languageZhCN") },
                    { value: "en", label: t("languageEn") },
                  ]}
                  className="w-32"
                />
              </div>
            </div>
          )}
        </div>
      </Tabs>
    </PageContainer>
  );
}
