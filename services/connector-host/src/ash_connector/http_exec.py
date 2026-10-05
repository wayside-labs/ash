from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
import uuid
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import httpx

from ash_connector.declarative import (
    PATH_PARAM,
    ConnectorBundle,
    ToolDefinition,
    resolve_placeholders,
)

DEFAULT_TIMEOUT_MS = 15_000
MAX_RESPONSE_BYTES = 1_000_000


class BlockedDestination(ValueError):
    pass


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def allowed_host(host: str) -> bool:
    suffixes = os.environ.get("CONNECTOR_ALLOWED_HOST_SUFFIXES", "").strip()
    if not suffixes:
        return True
    allowed = [s.strip().lstrip(".").lower() for s in suffixes.split(",") if s.strip()]
    host = host.lower()
    return any(host == s or host.endswith(f".{s}") for s in allowed)


async def check_destination(url: str) -> None:
    """Refuses plain http, and hosts that resolve into private address space.

    Bundles can come from a chat model, and the host runs next to the payment server on the
    operator's machine: without this a generated tool could reach a local signer, the
    dashboard, or a cloud metadata endpoint. The resolve-then-connect gap (DNS rebinding) is
    not closed here; `CONNECTOR_ALLOWED_HOST_SUFFIXES` is the stronger control.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and _flag("CONNECTOR_ALLOW_HTTP")):
        raise BlockedDestination(f"scheme '{parsed.scheme}' is not allowed (https only)")
    host = parsed.hostname or ""
    if not host:
        raise BlockedDestination("url has no host")
    if not allowed_host(host):
        raise BlockedDestination(f"host '{host}' is not in CONNECTOR_ALLOWED_HOST_SUFFIXES")
    if _flag("CONNECTOR_ALLOW_PRIVATE_HOSTS"):
        return
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, parsed.port or 443)
    except socket.gaierror as exc:
        raise BlockedDestination(f"cannot resolve '{host}': {exc}") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise BlockedDestination(f"host '{host}' resolves to non-public address {address}")


def build_request(
    bundle: ConnectorBundle,
    tool: ToolDefinition,
    arguments: dict[str, Any],
    env: dict[str, str],
) -> dict[str, Any]:
    args = {k: v for k, v in arguments.items() if v is not None}
    unknown = sorted(set(args) - set(tool.parameters.properties))
    if unknown:
        raise ValueError(f"unknown arguments: {', '.join(unknown)}")
    missing = [name for name in tool.parameters.required if name not in args]
    if missing:
        raise ValueError(f"missing required arguments: {', '.join(missing)}")

    def fill_path(match: Any) -> str:
        return quote(str(args.pop(match.group(1))), safe="")

    path_names = set(PATH_PARAM.findall(tool.url))
    missing_path = [n for n in path_names if n not in args]
    if missing_path:
        raise ValueError(f"missing path arguments: {', '.join(missing_path)}")
    raw_url = resolve_placeholders(PATH_PARAM.sub(fill_path, tool.url), env)
    if bundle.baseUrl and not raw_url.startswith(("https://", "http://")):
        url = urljoin(f"{bundle.baseUrl.rstrip('/')}/", raw_url.lstrip("/"))
    else:
        url = raw_url

    query = {k: resolve_placeholders(v, env) for k, v in tool.query.items()}
    body = dict(tool.body) if tool.body is not None else None
    if tool.arguments_target() == "query":
        query.update({k: v if isinstance(v, str) else _scalar(v) for k, v in args.items()})
    elif args or body is not None:
        body = {**(body or {}), **args}

    return {
        "method": tool.method,
        "url": url,
        "params": query or None,
        "headers": {k: resolve_placeholders(v, env) for k, v in tool.headers.items()},
        "json": body,
    }


def _scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(str(v) for v in value)
    return str(value)


async def execute_tool(
    bundle: ConnectorBundle,
    tool: ToolDefinition,
    arguments: dict[str, Any],
    env: dict[str, str],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    # One id per call, whether or not it reached the vendor, so a settled payment can cite
    # the exact quote it acted on.
    ref = str(uuid.uuid4())
    envelope: dict[str, Any] = {"connector_tool": tool.name, "vendor_reference_id": ref}
    try:
        request = build_request(bundle, tool, arguments, env)
        await check_destination(request["url"])
    except (ValueError, KeyError) as exc:
        return {**envelope, "http_status": None, "error": str(exc).strip("'\"")}

    timeout_ms = int(os.environ.get("CONNECTOR_HTTP_TIMEOUT_MS", str(DEFAULT_TIMEOUT_MS)))
    owned = client is None
    client = client or httpx.AsyncClient(timeout=httpx.Timeout(timeout_ms / 1000.0))
    try:
        # Redirects are not followed: the destination check ran on this URL, not the next.
        async with client.stream(**request, follow_redirects=False) as response:
            chunks: list[bytes] = []
            size = 0
            truncated = False
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_RESPONSE_BYTES:
                    truncated = True
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)
            data: Any
            try:
                data = httpx.Response(200, content=raw).json() if not truncated else None
            except ValueError:
                data = None
            if data is None:
                data = raw.decode("utf-8", errors="replace")
            result = {**envelope, "http_status": response.status_code, "data": data}
            if truncated:
                result["truncated"] = True
            return result
    except httpx.HTTPError as exc:
        return {**envelope, "http_status": None, "error": f"{type(exc).__name__}: {exc}"}
    finally:
        if owned:
            await client.aclose()
