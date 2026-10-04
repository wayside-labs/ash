import { describe, expect, it } from "vitest";
import { chatErrorHintKey, reconcileSelectedModel, selectableProviders } from "./model-selection";

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

const platform = {
  id: "openrouter-platform" as const,
  label: "Agent Rails assistant",
  detail: "hosted",
  models: [
    { id: "openrouter:anthropic/claude-sonnet-5.5", label: "Sonnet 5.5" },
    { id: "openrouter:anthropic/claude-haiku-4.5", label: "Haiku 4.5" },
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

  it("promotes demo to the platform default when only the platform key is available", () => {
    expect(reconcileSelectedModel("demo", [platform, demo])).toBe(
      "openrouter:anthropic/claude-haiku-4.5",
    );
  });

  it("prefers a key the user brought over the platform key", () => {
    expect(reconcileSelectedModel("", [api, platform, demo])).toBe("claude-sonnet-5");
  });

  it("prefers the platform key over the CLI, whose login the probe cannot vouch for", () => {
    expect(reconcileSelectedModel("", [cli, platform, demo])).toBe(
      "openrouter:anthropic/claude-haiku-4.5",
    );
  });

  it("keeps a persisted CLI choice even when the platform key is available", () => {
    expect(reconcileSelectedModel("claude-cli:sonnet", [cli, platform, demo])).toBe(
      "claude-cli:sonnet",
    );
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
});

describe("chatErrorHintKey", () => {
  it("asks for balance when the turn was refused for credit, whatever the provider", () => {
    expect(chatErrorHintKey({ creditShort: true, provider: "openrouter-platform" })).toBe(
      "chat.error.addCredit",
    );
  });

  it("points each provider at its own remedy", () => {
    expect(chatErrorHintKey({ creditShort: false, provider: "openrouter-platform" })).toBe(
      "chat.error.checkPlatform",
    );
    expect(chatErrorHintKey({ creditShort: false, provider: "claude-cli" })).toBe(
      "chat.error.checkSubscription",
    );
    expect(chatErrorHintKey({ creditShort: false, provider: "anthropic-api" })).toBe(
      "chat.error.checkApiKey",
    );
  });

  // A 502 from the tunnel mid-restart arrives with no `x-agent-rails-mode` and no provider
  // known to the page yet; it used to be blamed on "your API key in My APIs".
  it("never blames an API key when it does not know which provider failed", () => {
    for (const provider of [null, undefined, "demo", "something-new"]) {
      expect(chatErrorHintKey({ creditShort: false, provider })).toBe("chat.error.tryAgain");
    }
  });
});
