#!/usr/bin/env python3
"""Anonymize competitor names in competition JSON files.

Replaces each unique name at .distances[].races[].competitor.name
with "Competitor X" where X is a stable number assigned per unique name.
"""

import json
import sys
from pathlib import Path


def anonymize(data: dict) -> dict:
    name_map: dict[str, str] = {}
    counter = 0

    for distance in data.get("distances", []):
        for race in distance.get("races", []):
            competitor = race.get("competitor")
            if not competitor:
                continue
            name = competitor.get("name")
            if name is None:
                continue
            if name not in name_map:
                counter += 1
                name_map[name] = f"Competitor {counter}"
            competitor["name"] = name_map[name]

    return data


def process_file(path: Path) -> None:
    with path.open() as f:
        data = json.load(f)

    anonymize(data)

    with path.open("w") as f:
        json.dump(data, f, indent=2)

    print(f"Anonymized: {path}")


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <file.json> [file2.json ...]")
        sys.exit(1)

    for arg in sys.argv[1:]:
        path = Path(arg)
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            continue
        if not path.suffix == ".json":
            print(f"Skipping non-JSON file: {path}", file=sys.stderr)
            continue
        process_file(path)


if __name__ == "__main__":
    main()
