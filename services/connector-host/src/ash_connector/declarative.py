"""Connector bundle v1 — the only thing a connector host will mount.

Mirrored by `packages/contract/src/connector-bundle.ts`. The two are held together by the
fixtures under `examples/connectors/fixtures/`, which both test suites load: a rule that
exists on one side only shows up as a fixture one side accepts and the other rejects.
"""

from __future__ import annotations

import keyword
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

API_VERSION = "ash.connector/v1"

# Checked token by token, so `design_review` passes while `sign_tx` and `create_session`
# do not. The list is what ARCHITECTURE.md keeps off the agent surface, plus key material.
FORBIDDEN_NAME_TOKENS = frozenset(
    {
        "session",
        "sessions",
        "policy",
        "policies",
        "ceiling",
        "ceilings",
        "withdraw",
        "withdrawal",
        "pause",
        "unpause",
        "allowlist",
        "guardian",
        "guardians",
        "sign",
        "signer",
        "keypair",
        "mnemonic",
        "seed",
        "privkey",
    }
)
FORBIDDEN_NAME_PHRASES = ("execute_payment", "private_key", "secret_key", "seed_phrase")

# The env a bundle may read. `ASH_*` and `SOLANA_*` are the signer, RPC and ingest
# token of the payment server sharing the runner; a bundle that could name them could send
# them to its own host in a header.
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
RESERVED_ENV_PREFIXES = ("ASH_", "SOLANA_", "CONNECTOR_")

TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
BUNDLE_NAME = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
PARAM_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
PATH_PARAM = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")
ENV_PLACEHOLDER = re.compile(r"\{\{ENV:([A-Z][A-Z0-9_]*)\}\}")

MAX_TOOLS = 32
JSON_TYPES = {"string", "integer", "number", "boolean", "array", "object"}


def forbidden_name_reason(name: str) -> str | None:
    lowered = name.lower()
    for phrase in FORBIDDEN_NAME_PHRASES:
        if phrase in lowered:
            return phrase
    for token in re.split(r"[_\-]+", lowered):
        if token in FORBIDDEN_NAME_TOKENS:
            return token
    return None


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolParameterSchema(_Strict):
    type: Literal["object"] = "object"
    properties: dict[str, dict[str, Any]] = Field(default_factory=dict)
    required: list[str] = Field(default_factory=list)

    @field_validator("properties")
    @classmethod
    def valid_properties(cls, props: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        for name, spec in props.items():
            # Parameters become Python keyword arguments of the mounted tool.
            if not PARAM_NAME.match(name) or keyword.iskeyword(name):
                raise ValueError(f"parameter name '{name}' must match {PARAM_NAME.pattern}")
            kind = spec.get("type", "string")
            if kind not in JSON_TYPES:
                raise ValueError(f"parameter '{name}' has unsupported type '{kind}'")
        return props

    @model_validator(mode="after")
    def required_are_declared(self) -> ToolParameterSchema:
        missing = [name for name in self.required if name not in self.properties]
        if missing:
            raise ValueError(f"required parameters not declared: {', '.join(missing)}")
        return self


class ToolDefinition(_Strict):
    name: str
    description: str = Field(default="", max_length=1024)
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    # Absolute, or a path joined onto the bundle's `baseUrl`. `{param}` segments are filled
    # from arguments of the same name.
    url: str = Field(min_length=1, max_length=2048)
    query: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)
    body: dict[str, Any] | None = None
    # Where arguments that are not path parameters go. Defaults by method.
    argumentsIn: Literal["query", "body"] | None = None
    parameters: ToolParameterSchema = Field(default_factory=ToolParameterSchema)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if not TOOL_NAME.match(value):
            raise ValueError(f"tool name '{value}' must match {TOOL_NAME.pattern}")
        reason = forbidden_name_reason(value)
        if reason:
            raise ValueError(f"tool name '{value}' is forbidden (governance or key term '{reason}')")
        return value

    @model_validator(mode="after")
    def path_params_are_declared(self) -> ToolDefinition:
        for name in PATH_PARAM.findall(self.url):
            if name not in self.parameters.properties:
                raise ValueError(f"url parameter '{{{name}}}' is not declared in parameters")
        return self

    def arguments_target(self) -> Literal["query", "body"]:
        if self.argumentsIn:
            return self.argumentsIn
        return "query" if self.method in {"GET", "DELETE"} else "body"


class ConnectorBundle(_Strict):
    apiVersion: Literal["ash.connector/v1"] = API_VERSION
    name: str
    description: str = Field(default="", max_length=2048)
    baseUrl: str | None = None
    # Env names the bundle reads, with a non-secret default. "" means the runner must supply
    # it — the dashboard keeps that value on the MCP row, never in the bundle.
    env: dict[str, str] = Field(default_factory=dict)
    # Markdown imports carry their body here; the host serves it as MCP instructions.
    instructions: str = Field(default="", max_length=16384)
    tools: list[ToolDefinition] = Field(min_length=1, max_length=MAX_TOOLS)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if not BUNDLE_NAME.match(value):
            raise ValueError(f"bundle name '{value}' must match {BUNDLE_NAME.pattern}")
        return value

    @field_validator("env")
    @classmethod
    def valid_env(cls, env: dict[str, str]) -> dict[str, str]:
        for key in env:
            if not ENV_NAME.match(key):
                raise ValueError(f"env name '{key}' must match {ENV_NAME.pattern}")
            if key.startswith(RESERVED_ENV_PREFIXES):
                raise ValueError(f"env name '{key}' uses a reserved prefix")
        return env

    @model_validator(mode="after")
    def consistent(self) -> ConnectorBundle:
        names = [tool.name for tool in self.tools]
        duplicates = sorted({n for n in names if names.count(n) > 1})
        if duplicates:
            raise ValueError(f"duplicate tool names: {', '.join(duplicates)}")
        for tool in self.tools:
            if not tool.url.startswith(("https://", "http://")) and not self.baseUrl:
                raise ValueError(f"tool '{tool.name}' has a relative url and the bundle no baseUrl")
            for value in [*tool.headers.values(), *tool.query.values(), tool.url]:
                for ref in ENV_PLACEHOLDER.findall(value):
                    if ref not in self.env:
                        raise ValueError(
                            f"tool '{tool.name}' references {{{{ENV:{ref}}}}}, "
                            "which the bundle does not declare in env"
                        )
        return self


def resolve_placeholders(value: str, env: dict[str, str]) -> str:
    """Fills `{{ENV:NAME}}` anywhere in the string, from the bundle's resolved env only."""

    def substitute(match: re.Match[str]) -> str:
        key = match.group(1)
        resolved = env.get(key, "")
        if not resolved:
            raise KeyError(f"env value for {key} is not set")
        return resolved

    return ENV_PLACEHOLDER.sub(substitute, value)


def resolve_env(bundle: ConnectorBundle, process_env: dict[str, str]) -> dict[str, str]:
    """The bundle's declared names, filled from the process where set. Nothing else leaks in."""
    return {key: process_env.get(key) or default for key, default in bundle.env.items()}
