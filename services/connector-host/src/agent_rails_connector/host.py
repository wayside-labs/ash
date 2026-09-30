from __future__ import annotations

import inspect
import json
import os
from collections.abc import Mapping
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from agent_rails_connector.declarative import ConnectorBundle, ToolDefinition, resolve_env
from agent_rails_connector.http_exec import execute_tool

PAYMENT_HINT = (
    "This connector cannot sign, pay, or change limits. Settle through the agent-rails MCP "
    "(execute_payment) and put the vendor_reference_id from the quote into the payment memo."
)

_PY_TYPES: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def build_mcp(bundle: ConnectorBundle, process_env: Mapping[str, str] | None = None) -> FastMCP:
    # Resolved once, from the declared names only: the host never hands a tool the rest of
    # the process env, which on a runner includes the payment server's variables.
    env = resolve_env(bundle, dict(process_env if process_env is not None else os.environ))
    instructions = "\n\n".join(
        part for part in (bundle.description, bundle.instructions, PAYMENT_HINT) if part
    )
    mcp = FastMCP(name=f"agent-rails-connector-{bundle.name}", instructions=instructions)

    @mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    async def connector_catalog() -> str:
        """List the tools this connector mounts, and which env values are still unset."""
        return json.dumps(
            {
                "bundle": bundle.name,
                "apiVersion": bundle.apiVersion,
                "tools": [{"name": t.name, "method": t.method} for t in bundle.tools],
                "unset_env": sorted(k for k, v in env.items() if not v),
                "payment_pattern": PAYMENT_HINT,
            },
            indent=2,
        )

    for tool in bundle.tools:
        register_tool(mcp, bundle, tool, env)
    return mcp


def _signature(tool: ToolDefinition) -> inspect.Signature:
    required = set(tool.parameters.required)
    params = []
    # Required first: Python forbids a defaulted parameter before a bare one.
    ordered = sorted(tool.parameters.properties.items(), key=lambda kv: kv[0] not in required)
    for name, spec in ordered:
        annotation = _PY_TYPES.get(str(spec.get("type", "string")), str)
        if name in required:
            params.append(inspect.Parameter(name, inspect.Parameter.KEYWORD_ONLY, annotation=annotation))
        else:
            params.append(
                inspect.Parameter(
                    name,
                    inspect.Parameter.KEYWORD_ONLY,
                    annotation=annotation | None,
                    default=None,
                )
            )
    return inspect.Signature(params, return_annotation=str)


def register_tool(
    mcp: FastMCP, bundle: ConnectorBundle, tool: ToolDefinition, env: dict[str, str]
) -> None:
    async def handler(**kwargs: Any) -> str:
        return json.dumps(await execute_tool(bundle, tool, kwargs, env), indent=2)

    # FastMCP derives argument validation from the signature; the advertised schema is then
    # replaced with the bundle's own so enums and descriptions reach the agent intact.
    handler.__name__ = tool.name
    handler.__signature__ = _signature(tool)  # type: ignore[attr-defined]
    mounted = mcp._tool_manager.add_tool(
        handler,
        name=tool.name,
        description=tool.description or f"HTTP {tool.method} {tool.url}",
        annotations=ToolAnnotations(
            readOnlyHint=tool.method == "GET",
            destructiveHint=False,
            openWorldHint=True,
        ),
        structured_output=False,
    )
    mounted.parameters = {
        "type": "object",
        "properties": tool.parameters.properties,
        "required": tool.parameters.required,
        "additionalProperties": False,
    }
