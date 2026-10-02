"use client";

import { LayoutTemplate, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateBuilder } from "@/components/templates/template-builder";
import { TemplateCard } from "@/components/templates/template-card";
import {
  CreateTemplateDialog,
  TemplateDetailDialog,
  UseTemplateDialog,
} from "@/components/templates/template-dialogs";
import { TemplateListPanel } from "@/components/templates/template-list-panel";
import { TemplateViewToggle } from "@/components/templates/template-view-toggle";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDashboardState, useDeleteResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { listBuiltinTemplates } from "@/lib/templates/catalog";
import { localizeTemplate } from "@/lib/templates/localize";
import { useAppStore } from "@/stores/app-store";

/**
 * Two ways into the same templates. List (the default) is a workspace: the selected template
 * drawn as a canvas, the menu on the right. Cards is the gallery with the explanations; a card
 * opens its template in the workspace. The selection lives in `?t=` so a template is a link.
 */
function TemplatesPageInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { data: state, isLoading } = useDashboardState();
  const remove = useDeleteResource("templates");
  const view = useAppStore((s) => s.templatesView);
  const setView = useAppStore((s) => s.setTemplatesView);
  const hydrated = useAppStore((s) => s.hasHydrated);

  const [detail, setDetail] = useState<StoredWorkflowTemplate | null>(null);
  const [useTarget, setUseTarget] = useState<StoredWorkflowTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState<StoredWorkflowTemplate | null>(null);

  const starters = useMemo(
    () => listBuiltinTemplates().map((row) => localizeTemplate(t, row)),
    [t],
  );
  const custom = useMemo(
    () => (state?.templates ?? []).map((row) => localizeTemplate(t, row)),
    [state?.templates, t],
  );

  // An unknown or deleted id falls back to the first starter rather than an empty canvas.
  const requested = params.get("t");
  const selected =
    [...starters, ...custom].find((row) => row.id === requested) ?? starters[0] ?? null;

  const cardLabels = {
    starter: t("templates.badge.starter"),
    custom: t("templates.badge.custom"),
    learnMore: t("templates.learnMore"),
    use: t("templates.use.submit"),
    saveCopy: t("templates.saveCopy"),
    agents: t("templates.agents"),
  };

  const templateHref = (template: StoredWorkflowTemplate) =>
    `/templates?t=${encodeURIComponent(template.id)}`;

  const openCreate = (from?: StoredWorkflowTemplate) => {
    setCopyFrom(from ?? null);
    setCreateOpen(true);
  };

  const openInBuilder = (template: StoredWorkflowTemplate) => {
    setView("list");
    router.push(templateHref(template));
  };

  const deleteCustom = async (template: StoredWorkflowTemplate) => {
    try {
      await remove.mutateAsync(template.id);
      toast(t("templates.deleted", { name: template.name }));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("templates.deleteFailed"), "error");
    }
  };

  const dialogs = (
    <>
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
    </>
  );

  // Wait for the persisted view too, or a saved "cards" would flash the workspace first.
  if (isLoading || !hydrated) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (view === "list" && selected) {
    return (
      // Full-bleed, like the workflow canvas: cancels the shell's padding and takes the viewport.
      <div className="-m-4 flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden md:-m-6 md:flex-row">
        <TemplateBuilder
          template={selected}
          onLearnMore={() => setDetail(selected)}
          onUse={() => setUseTarget(selected)}
          onSaveCopy={() => openCreate(selected)}
        />
        <TemplateListPanel
          starters={starters}
          custom={custom}
          selectedId={selected.id}
          onSelect={(row) => router.replace(templateHref(row), { scroll: false })}
          onCreate={() => openCreate()}
          onDelete={deleteCustom}
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        action={
          <>
            <TemplateViewToggle />
            <Button onClick={() => openCreate()}>
              <Plus className="h-4 w-4" />
              {t("templates.create.button")}
            </Button>
          </>
        }
      />

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
                onOpen={() => openInBuilder(template)}
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
              {custom.map((template) => (
                <div key={template.id} className="relative">
                  <TemplateCard
                    template={template}
                    labels={cardLabels}
                    onOpen={() => openInBuilder(template)}
                    onLearnMore={() => setDetail(template)}
                    onUse={() => setUseTarget(template)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 z-10 h-8 w-8 text-muted-foreground"
                    aria-label={t("templates.delete")}
                    onClick={() => deleteCustom(template)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {dialogs}
    </div>
  );
}

export default function TemplatesPage() {
  // `useSearchParams` opts the page out of static rendering unless it sits under a boundary.
  return (
    <Suspense fallback={null}>
      <TemplatesPageInner />
    </Suspense>
  );
}
