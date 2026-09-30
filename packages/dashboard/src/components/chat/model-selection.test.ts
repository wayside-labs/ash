import { describe, expect, it } from "vitest";
import { reconcileSelectedModel, selectableProviders } from "./model-selection";

const cli = {
  id: "claude-cli" as const,
  label: "Claude Code",
  detail: "subscription",
  models: [
    { id: "claude-cli:opus", label: "Opus" },
    { id: "claude-cli:sonnet", label: "Sonnet" },
    { id: "claude-cli:haiku", label: "Haiku" },
  ],
};

const api = {
  id: "anthropic-api" as const,
  label: "Anthropic API",
  detail: "key",
  models: [
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5" },
  ],
};

const demo = {
  id: "demo" as const,
  label: "Demo",
  detail: "fixed replies",
  models: [{ id: "demo", label: "Demo" }],
};

describe("selectableProviders", () => {
  it("drops demo when a real provider is available", () => {
    expect(selectableProviders([cli, api, demo]).map((p) => p.id)).toEqual([
      "claude-cli",
      "anthropic-api",
    ]);
  });

  it("keeps demo when it is the only option", () => {
    expect(selectableProviders([demo]).map((p) => p.id)).toEqual(["demo"]);
  });
});

describe("reconcileSelectedModel", () => {
  it("promotes a persisted demo choice to claude-cli:sonnet", () => {
    expect(reconcileSelectedModel("demo", [cli, demo])).toBe("claude-cli:sonnet");
  });

  it("promotes demo to the API default when CLI is absent", () => {
    expect(reconcileSelectedModel("demo", [api, demo])).toBe("claude-sonnet-5");
  });

  it("keeps demo when no real provider exists", () => {
    expect(reconcileSelectedModel("demo", [demo])).toBe("demo");
  });

  it("defaults empty selection to claude-cli:sonnet", () => {
    expect(reconcileSelectedModel("", [cli, demo])).toBe("claude-cli:sonnet");
  });

  it("keeps an explicit non-default model", () => {
    expect(reconcileSelectedModel("claude-cli:opus", [cli, demo])).toBe("claude-cli:opus");
  });

  it("moves a stale CLI choice to the OpenAI key's models when the CLI is gone", () => {
    const openai = {
      id: "openai-api" as const,
      label: "OpenAI API",
      detail: "",
      models: [
        { id: "openai:gpt-4.1", label: "gpt-4.1" },
        { id: "openai:gpt-5", label: "gpt-5" },
      ],
    };
    expect(reconcileSelectedModel("claude-cli:sonnet", [openai, demo])).toBe("openai:gpt-5");
  });
});
