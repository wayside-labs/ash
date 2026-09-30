"""Import formats → `ConnectorBundle`.

Mirrored by `packages/contract/src/connector-import.ts`; `examples/connectors/fixtures/import/`
pins both to the same output. Postman and GraphQL are recognised so they fail with a
reason rather than as malformed bundles — they are phase 2 in the runbook.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from agent_rails_connector.declarative import (
    API_VERSION,
    MAX_TOOLS,
    PARAM_NAME,
    ConnectorBundle,
    forbidden_name_reason,
)

HTTP_METHODS = ("get", "post", "put", "patch", "delete")


@dataclass
class ImportResult:
    bundle: ConnectorBundle
    format: str
    # Operations left out, with why. Surfaced to the operator instead of failing the import.
    skipped: list[str] = field(default_factory=list)


class UnsupportedFormat(ValueError):
    pass


def slug(text: str, sep: str = "_") -> str:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
    out = re.sub(r"[^a-z0-9]+", sep, spaced.lower()).strip(sep)
    if not out or not out[0].isalpha():
        out = f"x{sep}{out}" if out else "x"
    return out[:64].rstrip(sep)


def parse_document(text: str, filename: str) -> Any:
    suffix = Path(filename).suffix.lower()
    if suffix == ".json":
        return json.loads(text)
    return yaml.safe_load(text)


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", text, re.DOTALL)
    if not match:
        raise ValueError("markdown connector needs YAML frontmatter between --- lines")
    meta = yaml.safe_load(match.group(1)) or {}
    if not isinstance(meta, dict):
        raise ValueError("markdown frontmatter must be a mapping")
    return meta, match.group(2).strip()


def import_text(text: str, filename: str) -> ImportResult:
    suffix = Path(filename).suffix.lower()
    if suffix in {".graphql", ".gql"}:
        raise UnsupportedFormat("GraphQL import is not supported yet (phase 2)")
    if suffix in {".md", ".mdx", ".markdown"}:
        meta, body = split_frontmatter(text)
        data = {"apiVersion": API_VERSION, **meta}
        if body:
            data["instructions"] = body
        return ImportResult(ConnectorBundle.model_validate(data), "markdown")

    data = parse_document(text, filename)
    if not isinstance(data, dict):
        raise ValueError("connector file root must be a mapping")
    if "openapi" in data:
        return from_openapi(data)
    if "swagger" in data:
        raise UnsupportedFormat("Swagger 2.0 is not supported; convert to OpenAPI 3 first")
    if isinstance(data.get("info"), dict) and "item" in data:
        raise UnsupportedFormat("Postman collections are not supported yet (phase 2)")
    return ImportResult(ConnectorBundle.model_validate(data), "bundle")


def load_path(path: Path) -> ConnectorBundle:
    return import_text(path.read_text(encoding="utf-8"), path.name).bundle


def _deref(node: Any, doc: dict[str, Any]) -> Any:
    # Local refs only, one hop at a time; a remote ref would mean fetching during import.
    seen = 0
    while isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/"):
            raise ValueError(f"only local $ref is supported, got {ref!r}")
        target: Any = doc
        for part in ref[2:].split("/"):
            target = target.get(part) if isinstance(target, dict) else None
        if target is None:
            raise ValueError(f"unresolved $ref {ref}")
        node = target
        seen += 1
        if seen > 16:
            raise ValueError("$ref chain too deep")
    return node


def _param_schema(schema: Any, description: str | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if isinstance(schema, dict):
        kind = schema.get("type")
        out["type"] = kind if kind in {"string", "integer", "number", "boolean", "array", "object"} else "string"
        if isinstance(schema.get("enum"), list):
            out["enum"] = schema["enum"]
    else:
        out["type"] = "string"
    if description:
        out["description"] = description
    return out


def _security_headers(doc: dict[str, Any], env: dict[str, str]) -> dict[str, str]:
    """Maps the first apiKey-in-header or bearer scheme onto an env placeholder."""
    schemes = (doc.get("components") or {}).get("securitySchemes") or {}
    for scheme_name, raw in schemes.items():
        scheme = _deref(raw, doc)
        if not isinstance(scheme, dict):
            continue
        var = f"{slug(scheme_name).upper()}_TOKEN"
        if scheme.get("type") == "apiKey" and scheme.get("in") == "header" and scheme.get("name"):
            env[var] = ""
            return {str(scheme["name"]): f"{{{{ENV:{var}}}}}"}
        if scheme.get("type") == "http" and str(scheme.get("scheme", "")).lower() == "bearer":
            env[var] = ""
            return {"Authorization": f"Bearer {{{{ENV:{var}}}}}"}
    return {}


def from_openapi(doc: dict[str, Any]) -> ImportResult:
    if not str(doc.get("openapi", "")).startswith("3."):
        raise UnsupportedFormat("only OpenAPI 3.x is supported")
    info = doc.get("info") or {}
    servers = doc.get("servers") or []
    base_url = servers[0].get("url") if servers and isinstance(servers[0], dict) else None
    if not base_url or not str(base_url).startswith(("https://", "http://")):
        raise ValueError("OpenAPI document needs an absolute servers[0].url")

    env: dict[str, str] = {}
    headers = _security_headers(doc, env)
    tools: list[dict[str, Any]] = []
    skipped: list[str] = []

    for path, item in (doc.get("paths") or {}).items():
        item = _deref(item, doc)
        if not isinstance(item, dict):
            continue
        shared_params = item.get("parameters") or []
        for method in HTTP_METHODS:
            op = item.get(method)
            if not isinstance(op, dict):
                continue
            op_id = op.get("operationId") or f"{method}_{path}"
            name = slug(str(op_id))
            reason = forbidden_name_reason(name)
            if reason:
                skipped.append(f"{name}: forbidden term '{reason}'")
                continue
            if len(tools) >= MAX_TOOLS:
                skipped.append(f"{name}: bundle is limited to {MAX_TOOLS} tools")
                continue

            properties: dict[str, dict[str, Any]] = {}
            required: list[str] = []
            has_query = False
            bad = None
            for raw in [*shared_params, *(op.get("parameters") or [])]:
                param = _deref(raw, doc)
                where = param.get("in")
                pname = str(param.get("name", ""))
                if where not in {"path", "query"}:
                    continue
                if not PARAM_NAME.match(pname):
                    bad = f"parameter '{pname}' is not a valid identifier"
                    break
                has_query = has_query or where == "query"
                properties[pname] = _param_schema(_deref(param.get("schema"), doc), param.get("description"))
                if param.get("required") or where == "path":
                    required.append(pname)
            if bad:
                skipped.append(f"{name}: {bad}")
                continue

            arguments_in = None
            body = _deref(op.get("requestBody"), doc) if op.get("requestBody") else None
            json_body = ((body or {}).get("content") or {}).get("application/json")
            if json_body:
                if has_query:
                    skipped.append(f"{name}: mixes query parameters with a JSON body")
                    continue
                schema = _deref(json_body.get("schema") or {}, doc)
                for pname, pschema in (schema.get("properties") or {}).items():
                    if not PARAM_NAME.match(pname):
                        bad = f"body field '{pname}' is not a valid identifier"
                        break
                    resolved = _deref(pschema, doc)
                    properties[pname] = _param_schema(resolved, resolved.get("description"))
                if bad:
                    skipped.append(f"{name}: {bad}")
                    continue
                required.extend(r for r in schema.get("required") or [] if r in properties)
                arguments_in = "body"

            tool: dict[str, Any] = {
                "name": name,
                "description": str(op.get("summary") or op.get("description") or "")[:1024],
                "method": method.upper(),
                "url": path,
                "parameters": {"type": "object", "properties": properties, "required": required},
            }
            if headers:
                tool["headers"] = dict(headers)
            if arguments_in:
                tool["argumentsIn"] = arguments_in
            tools.append(tool)

    if not tools:
        raise ValueError("OpenAPI document yielded no importable operations")
    bundle = ConnectorBundle.model_validate(
        {
            "apiVersion": API_VERSION,
            "name": slug(str(info.get("title") or "openapi"), "-"),
            "description": str(info.get("description") or info.get("title") or "")[:2048],
            "baseUrl": str(base_url).rstrip("/"),
            "env": env,
            "tools": tools,
        }
    )
    return ImportResult(bundle, "openapi", skipped)
