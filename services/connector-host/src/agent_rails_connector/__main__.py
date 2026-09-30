from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from pydantic import ValidationError

from agent_rails_connector.declarative import ConnectorBundle
from agent_rails_connector.host import build_mcp
from agent_rails_connector.loaders import ImportResult, UnsupportedFormat, import_text

# The dashboard's runner export carries the bundle inline, so a hosted dashboard and the
# operator's machine never have to agree on a file path.
BUNDLE_ENV = "CONNECTOR_BUNDLE_JSON"


def load(bundle: Path | None) -> ImportResult:
    if bundle is not None:
        if not bundle.is_file():
            raise SystemExit(f"bundle not found: {bundle}")
        return import_text(bundle.read_text(encoding="utf-8"), bundle.name)
    inline = os.environ.get(BUNDLE_ENV, "").strip()
    if not inline:
        raise SystemExit(f"pass --bundle <file> or set {BUNDLE_ENV}")
    return ImportResult(ConnectorBundle.model_validate(json.loads(inline)), "bundle")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="agent-rails-connector",
        description="Agent Rails declarative MCP connector host (stdio)",
    )
    parser.add_argument(
        "--bundle",
        type=Path,
        help="Connector file: bundle .yaml/.json, OpenAPI 3 .yaml/.json, or .md with frontmatter",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate and print the normalized bundle as JSON instead of serving",
    )
    args = parser.parse_args(argv)
    try:
        result = load(args.bundle)
    except (ValidationError, UnsupportedFormat, ValueError) as exc:
        raise SystemExit(f"invalid connector: {exc}") from exc

    if args.check:
        json.dump(
            {
                "format": result.format,
                "skipped": result.skipped,
                "bundle": result.bundle.model_dump(exclude_defaults=True),
            },
            sys.stdout,
            indent=2,
        )
        sys.stdout.write("\n")
        return
    build_mcp(result.bundle).run(transport="stdio")


if __name__ == "__main__":
    main()
