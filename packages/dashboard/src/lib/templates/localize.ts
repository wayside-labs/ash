import type { StoredWorkflowTemplate } from "@/lib/schema";
import { type BuiltinTemplateId, isBuiltinTemplateId } from "@/lib/templates/catalog";

type Translate = (key: string) => string;

const BUILTIN_I18N_KEY: Record<BuiltinTemplateId, string> = {
  "builtin:earn-bounty-hunter": "earnBountyHunter",
  "builtin:dca-sol": "dcaSol",
  "builtin:defi-yield-rebalance": "defiYieldRebalance",
};

function setupStepsFromLocale(t: Translate, prefix: string): string[] {
  const raw = t(`${prefix}.setupSteps`);
  if (!raw || raw === `${prefix}.setupSteps`) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Overlays locale strings onto built-in catalog rows; custom templates pass through. */
export function localizeTemplate(
  t: Translate,
  template: StoredWorkflowTemplate,
): StoredWorkflowTemplate {
  if (!isBuiltinTemplateId(template.id)) return template;
  const slug = BUILTIN_I18N_KEY[template.id];
  const prefix = `templates.builtin.${slug}`;
  const steps = setupStepsFromLocale(t, prefix);
  return {
    ...template,
    name: t(`${prefix}.name`),
    description: t(`${prefix}.description`),
    summary: t(`${prefix}.summary`),
    howItWorks: t(`${prefix}.howItWorks`),
    setupSteps: steps.length > 0 ? steps : template.setupSteps,
  };
}
