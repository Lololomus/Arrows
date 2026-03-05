#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
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
        default=1,
        help="Only process levels with number >= this value.",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Write fixes back to disk without prompting.",
    )
    parser.add_argument(
        "--sync-missing",
        action="store_true",
        help="Sync only missing level files to the VPS using rsync.",
    )
    parser.add_argument(
        "--ssh-user",
        default=None,
        help="SSH user for the VPS (or env ARROWS_SSH_USER).",
    )
    parser.add_argument(
        "--ssh-host",
        default=None,
        help="SSH host or IP for the VPS (or env ARROWS_SSH_HOST).",
    )
    parser.add_argument(
        "--ssh-port",
        type=int,
        default=None,
        help="SSH port for the VPS (or env ARROWS_SSH_PORT, default 22).",
    )
    parser.add_argument(
        "--remote-dir",
        default=None,
        help="Remote directory on the VPS (or env ARROWS_REMOTE_DIR).",
    )
    parser.add_argument(
        "--rsync-path",
        default=None,
        help="Optional path to rsync executable (or env ARROWS_RSYNC_PATH).",
    )
    parser.add_argument(
        "--bash-path",
        default=None,
        help="Optional path to MSYS2 bash.exe for running rsync in MSYS2 (or env ARROWS_BASH_PATH).",
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


def should_apply_fix(path: Path, changes: list[tuple[int, Any, Any]]) -> bool:
    print(f"{path.name}: duplicate ids found")
    for index, old_id, new_id in changes:
        print(f"  arrow[{index}] id {old_id!r} -> {new_id!r}")

    while True:
        answer = input("Apply fix? [y/n]: ").strip().lower()
        if answer in {"y", "yes"}:
            return True
        if answer in {"n", "no"}:
            return False
        print("Please answer y or n.")


def windows_path_to_msys(path: Path) -> str:
    drive = path.drive.rstrip(":").lower()
    rest = path.as_posix().split(":", maxsplit=1)[-1]
    rest = rest.lstrip("/")
    return f"/{drive}/{rest}"


def find_rsync(explicit_path: str | None) -> str | None:
    if explicit_path:
        if Path(explicit_path).exists():
            return explicit_path
        return None

    found = shutil.which("rsync")
    if found:
        return found

    candidates = [
        r"C:\msys64\usr\bin\rsync.exe",
        r"C:\msys64\bin\rsync.exe",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def run_rsync_missing(
    *,
    local_dir: Path,
    ssh_user: str,
    ssh_host: str,
    ssh_port: int,
    remote_dir: str,
    rsync_path: str | None,
    bash_path: str | None,
) -> None:
    if os.name == "nt":
        default_bash = r"C:\msys64\usr\bin\bash.exe"
        bash = bash_path or (default_bash if Path(default_bash).exists() else None)
        if bash:
            local_msys = windows_path_to_msys(local_dir)
            remote = f"{ssh_user}@{ssh_host}:{remote_dir}/"
            ssh_arg = f"ssh -p {ssh_port}"
            rsync_cmd = (
                "rsync -av --ignore-existing "
                f"-e {shlex.quote(ssh_arg)} "
                f"{shlex.quote(local_msys + '/')} "
                f"{shlex.quote(remote)}"
            )
            subprocess.run([bash, "-lc", rsync_cmd], check=True)
            return

    rsync = find_rsync(rsync_path)

    if rsync:
        local_arg = f"{local_dir}{os.sep}"
        if os.name == "nt" and local_dir.drive:
            local_arg = windows_path_to_msys(local_dir) + "/"

        cmd = [
            rsync,
            "-av",
            "--ignore-existing",
            "-e",
            f"ssh -p {ssh_port}",
            local_arg,
            f"{ssh_user}@{ssh_host}:{remote_dir}/",
        ]
        env = os.environ.copy()
        if os.name == "nt":
            env.setdefault("MSYS2_ARG_CONV_EXCL", "*")
        subprocess.run(cmd, check=True, env=env)
        return

    raise SystemExit(
        "rsync not found. Install MSYS2 rsync or provide --rsync-path/--bash-path."
    )


def main() -> int:
    args = parse_args()

    if not LEVELS_DIR.exists():
        raise SystemExit(f"Levels directory not found: {LEVELS_DIR}")

    processed = 0
    found = 0
    fixed = 0

    for path in sorted(LEVELS_DIR.glob("level_*.json")):
        level_number = level_number_from_path(path)
        if level_number is None or level_number < args.start_level:
            continue

        processed += 1
        changed, changes = process_level(path, apply_fix=False)
        if not changed:
            continue

        found += 1
        apply_fix = args.fix or should_apply_fix(path, changes)
        if apply_fix:
            process_level(path, apply_fix=True)
            fixed += 1
            print(f"{path.name}: duplicate ids fixed")
        else:
            print(f"{path.name}: skipped")

    print(
        f"Processed {processed} level files, found issues in {found} file(s), fixed {fixed} file(s)."
    )

    if args.sync_missing:
        ssh_user = args.ssh_user or os.getenv("ARROWS_SSH_USER") or "root"
        ssh_host = args.ssh_host or os.getenv("ARROWS_SSH_HOST")
        remote_dir = args.remote_dir or os.getenv("ARROWS_REMOTE_DIR")
        ssh_port = args.ssh_port or int(os.getenv("ARROWS_SSH_PORT", "22"))
        rsync_path = args.rsync_path or os.getenv("ARROWS_RSYNC_PATH")
        bash_path = args.bash_path or os.getenv("ARROWS_BASH_PATH")

        missing = []
        if not ssh_host:
            missing.append("ARROWS_SSH_HOST or --ssh-host")
        if not remote_dir:
            missing.append("ARROWS_REMOTE_DIR or --remote-dir")
        if missing:
            raise SystemExit(
                "Missing sync configuration: " + ", ".join(missing)
            )

        run_rsync_missing(
            local_dir=LEVELS_DIR,
            ssh_user=ssh_user,
            ssh_host=ssh_host,
            ssh_port=ssh_port,
            remote_dir=remote_dir,
            rsync_path=rsync_path,
            bash_path=bash_path,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
