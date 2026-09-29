"use client";

import { LayoutTemplate, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateCard } from "@/components/templates/template-card";
import {
  CreateTemplateDialog,
  TemplateDetailDialog,
  UseTemplateDialog,
} from "@/components/templates/template-dialogs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDashboardState, useDeleteResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { listBuiltinTemplates } from "@/lib/templates/catalog";
import { localizeTemplate } from "@/lib/templates/localize";

export default function TemplatesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { data: state, isLoading } = useDashboardState();
  const remove = useDeleteResource("templates");

  const [detail, setDetail] = useState<StoredWorkflowTemplate | null>(null);
  const [useTarget, setUseTarget] = useState<StoredWorkflowTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<StoredWorkflowTemplate | null>(null);

  const starters = useMemo(
    () => listBuiltinTemplates().map((row) => localizeTemplate(t, row)),
    [t],
  );

  const custom = useMemo(() => state?.templates ?? [], [state?.templates]);

  const cardLabels = {
    starter: t("templates.badge.starter"),
    custom: t("templates.badge.custom"),
    learnMore: t("templates.learnMore"),
    use: t("templates.use.submit"),
    saveCopy: t("templates.saveCopy"),
    agents: t("templates.agents"),
  };

  const openCreate = (from?: StoredWorkflowTemplate) => {
    setCopyFrom(from ?? null);
    setCreateOpen(true);
  };

  const deleteCustom = async (id: string, name: string) => {
    try {
      await remove.mutateAsync(id);
      toast(t("templates.deleted", { name }));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("templates.deleteFailed"), "error");
    }
  };

  return (
    <div>
      <PageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        action={
          <Button onClick={() => openCreate()}>
            <Plus className="h-4 w-4" />
            {t("templates.create.button")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="mb-1 text-sm font-medium">{t("templates.section.starters")}</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              {t("templates.section.startersHint")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {starters.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  labels={cardLabels}
                  onLearnMore={() => setDetail(template)}
                  onUse={() => setUseTarget(template)}
                  onSaveCopy={() => openCreate(template)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-medium">{t("templates.section.yours")}</h2>
            <p className="mb-4 text-xs text-muted-foreground">{t("templates.section.yoursHint")}</p>
            {custom.length === 0 ? (
              <EmptyState
                icon={LayoutTemplate}
                title={t("templates.emptyTitle")}
                description={t("templates.emptyDescription")}
                action={{
                  label: t("templates.create.button"),
                  onClick: () => openCreate(),
                }}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {custom.map((template) => {
                  const localized = localizeTemplate(t, template);
                  return (
                    <div key={template.id} className="relative">
                      <TemplateCard
                        template={localized}
                        labels={cardLabels}
                        onLearnMore={() => setDetail(localized)}
                        onUse={() => setUseTarget(localized)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-2 top-2 h-8 w-8 text-muted-foreground"
                        aria-label={t("templates.delete")}
                        onClick={() => deleteCustom(template.id, template.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      <TemplateDetailDialog
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        template={detail}
      />
      <UseTemplateDialog
        open={useTarget !== null}
        onOpenChange={(open) => !open && setUseTarget(null)}
        template={useTarget}
        onApplied={() => router.push("/workflows")}
      />
      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} initial={copyFrom} />
    </div>
  );
}
