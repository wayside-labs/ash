import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ash_connector.declarative import ConnectorBundle, resolve_env, resolve_placeholders
from ash_connector.loaders import UnsupportedFormat, import_text, load_path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONNECTORS = REPO_ROOT / "examples" / "connectors"
FIXTURES = CONNECTORS / "fixtures"


def test_load_sample_bundle() -> None:
    bundle = load_path(CONNECTORS / "sample-weather.yaml")
    assert bundle.name == "sample-weather"
    assert [t.name for t in bundle.tools] == ["tokyo_weather_now"]


@pytest.mark.parametrize("path", sorted((FIXTURES / "valid").iterdir()), ids=lambda p: p.name)
def test_valid_fixtures(path: Path) -> None:
    load_path(path)


@pytest.mark.parametrize("path", sorted((FIXTURES / "invalid").iterdir()), ids=lambda p: p.name)
def test_invalid_fixtures(path: Path) -> None:
    with pytest.raises(ValidationError):
        ConnectorBundle.model_validate(json.loads(path.read_text()))


@pytest.mark.parametrize(
    "source",
    sorted(p for p in (FIXTURES / "import").iterdir() if not p.name.endswith(".expected.json")),
    ids=lambda p: p.name,
)
def test_import_matches_expected(source: Path) -> None:
    result = import_text(source.read_text(), source.name)
    expected = json.loads((source.parent / f"{source.name.split('.')[0]}.expected.json").read_text())
    assert result.format == expected["format"]
    assert result.skipped == expected["skipped"]
    assert result.bundle.model_dump(mode="json") == expected["bundle"]


def test_openapi_skips_governance_operation() -> None:
    result = import_text((FIXTURES / "import" / "petstore.openapi.yaml").read_text(), "p.yaml")
    assert "create_session" not in [t.name for t in result.bundle.tools]
    assert any("create_session" in s for s in result.skipped)


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("schema.graphql", "type Query { a: Int }"),
        ("c.json", json.dumps({"info": {"name": "x"}, "item": []})),
        ("s.yaml", "swagger: '2.0'\ninfo: {title: x}\n"),
    ],
)
def test_phase_two_formats_fail_with_reason(filename: str, content: str) -> None:
    with pytest.raises(UnsupportedFormat):
        import_text(content, filename)


def test_placeholders_resolve_inside_strings() -> None:
    assert resolve_placeholders("Bearer {{ENV:K}}", {"K": "abc"}) == "Bearer abc"
    with pytest.raises(KeyError):
        resolve_placeholders("Bearer {{ENV:K}}", {"K": ""})


def test_env_is_limited_to_declared_names() -> None:
    bundle = load_path(CONNECTORS / "sample-weather.yaml")
    env = resolve_env(
        bundle, {"WEATHER_API_KEY": "k", "ASH_SIGNER": "secret", "HOME": "/root"}
    )
    assert env == {"WEATHER_API_KEY": "k"}
