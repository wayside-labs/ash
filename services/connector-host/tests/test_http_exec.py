import json

import httpx
import pytest
from pytest_httpx import HTTPXMock

from agent_rails_connector.declarative import ConnectorBundle
from agent_rails_connector.host import build_mcp
from agent_rails_connector.http_exec import build_request, check_destination, execute_tool

QUOTE = ConnectorBundle.model_validate(
    {
        "name": "credits",
        "baseUrl": "https://api.vendor.example",
        "env": {"VENDOR_API_KEY": ""},
        "tools": [
            {
                "name": "quote_credits",
                "method": "POST",
                "url": "/v1/regions/{region}/quotes",
                "headers": {"X-Api-Key": "{{ENV:VENDOR_API_KEY}}"},
                "body": {"currency": "USDC"},
                "parameters": {
                    "type": "object",
                    "properties": {
                        "region": {"type": "string"},
                        "credits": {"type": "integer"},
                        "units": {"type": "string", "enum": ["a", "b"]},
                    },
                    "required": ["region", "credits"],
                },
            },
            {"name": "status", "url": "https://api.vendor.example/v1/status"},
        ],
    }
)
ENV = {"VENDOR_API_KEY": "k-123"}


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    # Tests never touch real DNS; the private-address branch is tested explicitly below.
    monkeypatch.setenv("CONNECTOR_ALLOW_PRIVATE_HOSTS", "1")


def test_build_request_places_arguments() -> None:
    tool = QUOTE.tools[0]
    request = build_request(QUOTE, tool, {"region": "eu west", "credits": 5}, ENV)
    assert request["url"] == "https://api.vendor.example/v1/regions/eu%20west/quotes"
    assert request["json"] == {"currency": "USDC", "credits": 5}
    assert request["headers"] == {"X-Api-Key": "k-123"}


def test_build_request_rejects_unknown_and_missing() -> None:
    tool = QUOTE.tools[0]
    with pytest.raises(ValueError, match="unknown"):
        build_request(QUOTE, tool, {"region": "x", "credits": 1, "evil": 1}, ENV)
    with pytest.raises(ValueError, match="missing"):
        build_request(QUOTE, tool, {"region": "x"}, ENV)


async def test_execute_returns_envelope(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url="https://api.vendor.example/v1/regions/us/quotes", json={"quote_id": "q1"}
    )
    result = await execute_tool(QUOTE, QUOTE.tools[0], {"region": "us", "credits": 3}, ENV)
    assert result["http_status"] == 200
    assert result["data"] == {"quote_id": "q1"}
    assert result["connector_tool"] == "quote_credits"
    assert len(result["vendor_reference_id"]) == 36
    sent = httpx_mock.get_request()
    assert sent is not None and sent.headers["X-Api-Key"] == "k-123"


async def test_unset_secret_is_an_error_not_an_empty_header() -> None:
    result = await execute_tool(QUOTE, QUOTE.tools[0], {"region": "us", "credits": 3}, {})
    assert result["http_status"] is None
    assert "VENDOR_API_KEY" in result["error"]


async def test_redirects_are_not_followed(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(status_code=302, headers={"Location": "http://169.254.169.254/"})
    result = await execute_tool(QUOTE, QUOTE.tools[1], {}, ENV)
    assert result["http_status"] == 302
    assert len(httpx_mock.get_requests()) == 1


async def test_http_scheme_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="https only"):
        await check_destination("http://api.vendor.example/x")


async def test_private_address_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CONNECTOR_ALLOW_PRIVATE_HOSTS")
    for url in ("https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest"):
        with pytest.raises(ValueError, match="non-public"):
            await check_destination(url)


async def test_host_suffix_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONNECTOR_ALLOWED_HOST_SUFFIXES", "vendor.example")
    await check_destination("https://api.vendor.example/x")
    with pytest.raises(ValueError, match="ALLOWED_HOST"):
        await check_destination("https://evil.example/x")


async def test_mcp_advertises_bundle_schema_and_calls_through(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(json={"ok": True})
    mcp = build_mcp(QUOTE, {"VENDOR_API_KEY": "k", "AGENT_RAILS_SIGNER": "must-not-leak"})
    tools = {t.name: t for t in await mcp.list_tools()}
    assert set(tools) == {"connector_catalog", "quote_credits", "status"}
    schema = tools["quote_credits"].inputSchema
    assert schema["required"] == ["region", "credits"]
    assert schema["properties"]["units"]["enum"] == ["a", "b"]
    assert tools["status"].annotations is not None and tools["status"].annotations.readOnlyHint

    content = await mcp.call_tool("quote_credits", {"region": "us", "credits": 2})
    blocks = content[0] if isinstance(content, tuple) else content
    payload = json.loads(blocks[0].text)
    assert payload["data"] == {"ok": True}
    sent = httpx_mock.get_request()
    assert sent is not None
    assert b"must-not-leak" not in sent.content
    assert "must-not-leak" not in str(sent.headers)

    catalog = await mcp.call_tool("connector_catalog", {})
    blocks = catalog[0] if isinstance(catalog, tuple) else catalog
    assert "must-not-leak" not in blocks[0].text


async def test_mcp_rejects_bad_argument_types() -> None:
    mcp = build_mcp(QUOTE, {"VENDOR_API_KEY": "k"})
    with pytest.raises(Exception, match="credits"):
        await mcp.call_tool("quote_credits", {"region": "us", "credits": "lots"})


async def test_timeout_is_reported(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_exception(httpx.ReadTimeout("slow"))
    result = await execute_tool(QUOTE, QUOTE.tools[1], {}, ENV)
    assert result["http_status"] is None and "ReadTimeout" in result["error"]
