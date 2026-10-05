"""Rewrites examples/connectors/fixtures/import/*.expected.json from the Python loaders.

The TypeScript importer is tested against these files, so a deliberate change to the
import rules is: change both loaders, run this, then `pnpm format` (Biome owns JSON
layout in this repo), and review the diff.
"""

import json
from pathlib import Path

from ash_connector.loaders import import_text

FIXTURES = Path(__file__).resolve().parents[3] / "examples" / "connectors" / "fixtures" / "import"

for source in sorted(FIXTURES.iterdir()):
    if source.name.endswith(".expected.json"):
        continue
    result = import_text(source.read_text(encoding="utf-8"), source.name)
    target = FIXTURES / f"{source.name.split('.')[0]}.expected.json"
    payload = {
        "format": result.format,
        "skipped": result.skipped,
        "bundle": result.bundle.model_dump(mode="json"),
    }
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {target.name}")
