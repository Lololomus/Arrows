#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
LEVELS_DIR = ROOT_DIR / "backend" / "app" / "levels"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Find and fix duplicate arrow ids in level files."
    )
    parser.add_argument(
        "--start-level",
        type=int,
        default=37,
        help="Only process levels with number >= this value.",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Write fixes back to disk. Without this flag, the script only reports issues.",
    )
    return parser.parse_args()


def level_number_from_path(path: Path) -> int | None:
    stem = path.stem
    if not stem.startswith("level_"):
        return None
    raw_number = stem.removeprefix("level_")
    try:
        return int(raw_number)
    except ValueError:
        return None


def next_numeric_id(used_ids: set[int]) -> int:
    candidate = max(used_ids, default=0) + 1
    while candidate in used_ids:
        candidate += 1
    return candidate


def normalize_duplicate_ids(arrows: list[dict[str, Any]]) -> tuple[bool, list[tuple[int, Any, Any]]]:
    seen_raw_ids: set[str] = set()
    used_numeric_ids: set[int] = set()
    changes: list[tuple[int, Any, Any]] = []

    for arrow in arrows:
        raw_id = arrow.get("id")
        try:
            numeric_id = int(raw_id)
        except (TypeError, ValueError):
            numeric_id = None
        if numeric_id is not None:
            used_numeric_ids.add(numeric_id)

    for index, arrow in enumerate(arrows):
        raw_id = arrow.get("id")
        key = str(raw_id)
        if raw_id is not None and key not in seen_raw_ids:
            seen_raw_ids.add(key)
            continue

        new_id = next_numeric_id(used_numeric_ids)
        used_numeric_ids.add(new_id)
        seen_raw_ids.add(str(new_id))
        arrow["id"] = new_id
        changes.append((index, raw_id, new_id))

    return (len(changes) > 0, changes)


def process_level(path: Path, apply_fix: bool) -> tuple[bool, list[tuple[int, Any, Any]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    arrows = raw.get("arrows")
    if not isinstance(arrows, list):
        return False, []

    changed, changes = normalize_duplicate_ids(arrows)
    if changed and apply_fix:
        path.write_text(
            json.dumps(raw, ensure_ascii=False, indent="\t") + "\n",
            encoding="utf-8",
        )
    return changed, changes


def main() -> int:
    args = parse_args()

    if not LEVELS_DIR.exists():
        raise SystemExit(f"Levels directory not found: {LEVELS_DIR}")

    processed = 0
    fixed = 0

    for path in sorted(LEVELS_DIR.glob("level_*.json")):
        level_number = level_number_from_path(path)
        if level_number is None or level_number < args.start_level:
            continue

        processed += 1
        changed, changes = process_level(path, args.fix)
        if not changed:
            continue

        fixed += 1
        print(f"{path.name}: duplicate ids fixed")
        for index, old_id, new_id in changes:
            print(f"  arrow[{index}] id {old_id!r} -> {new_id!r}")

    mode = "fixed" if args.fix else "found"
    print(f"Processed {processed} level files, {mode} issues in {fixed} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
