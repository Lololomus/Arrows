import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Folder with level files (relative to this file)
LEVELS_DIR = Path(__file__).parent.parent / "levels"
VALID_DIRECTIONS = {"up", "down", "left", "right"}
VALID_ARROW_TYPES = {"normal", "ice", "plus_life", "minus_life", "bomb", "electric"}
LEGACY_TYPE_MAP = {
    "life": "plus_life",
    "danger": "minus_life",
}


def calculate_direction(head: Dict[str, int], neck: Dict[str, int]) -> str:
    """Calculate direction from head(0) to neck(1)."""
    dx = head["x"] - neck["x"]
    dy = head["y"] - neck["y"]

    if dx == 1:
        return "right"
    if dx == -1:
        return "left"
    if dy == 1:
        return "down"
    if dy == -1:
        return "up"
    return "up"


def _normalize_direction(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    direction = value.strip().lower()
    if direction in VALID_DIRECTIONS:
        return direction
    return None


def _normalize_type(value: Any) -> str:
    if not isinstance(value, str):
        return "normal"
    normalized = value.strip().lower()
    normalized = LEGACY_TYPE_MAP.get(normalized, normalized)
    if normalized in VALID_ARROW_TYPES:
        return normalized
    return "normal"


def _normalize_color(value: Any) -> str:
    if isinstance(value, str):
        color = value.strip()
        if color:
            return color
    return "#FFFFFF"


def _normalize_frozen(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"1", "true", "yes", "on"}:
            return True
        if v in {"0", "false", "no", "off"}:
            return False
    return False


def _to_int_pair(coord: Any) -> Optional[Tuple[int, int]]:
    if not isinstance(coord, list) or len(coord) != 2:
        return None
    try:
        return int(coord[0]), int(coord[1])
    except (TypeError, ValueError):
        return None


def _convert_pair(pair: Tuple[int, int], mode: str) -> Dict[str, int]:
    # mode=xy: [x, y], mode=rowcol: [row, col] -> [x=col, y=row]
    a, b = pair
    if mode == "xy":
        return {"x": a, "y": b}
    return {"x": b, "y": a}


def _score_cells(
    cells: List[Dict[str, int]],
    width: int,
    height: int,
    expected_head_dir: Optional[str],
) -> int:
    score = 0

    for c in cells:
        in_bounds = 0 <= c["x"] < width and 0 <= c["y"] < height
        score += 2 if in_bounds else -5

    for i in range(len(cells) - 1):
        dx = abs(cells[i + 1]["x"] - cells[i]["x"])
        dy = abs(cells[i + 1]["y"] - cells[i]["y"])
        score += 1 if (dx + dy) == 1 else -4

    if expected_head_dir and len(cells) >= 2:
        actual = calculate_direction(cells[0], cells[1])
        score += 8 if actual == expected_head_dir else -8

    return score


def _pick_order_for_arrow(
    converted_cells: List[Dict[str, int]],
    width: int,
    height: int,
    expected_head_dir: Optional[str],
) -> Tuple[List[Dict[str, int]], int]:
    forward = converted_cells
    backward = list(reversed(converted_cells))

    score_forward = _score_cells(forward, width, height, expected_head_dir)
    score_backward = _score_cells(backward, width, height, expected_head_dir)

    # Tie -> legacy-safe fallback (old loader always reversed).
    if score_backward >= score_forward:
        return backward, score_backward
    return forward, score_forward


def _build_mode_candidate(
    raw_arrows: List[Dict[str, Any]],
    width: int,
    height: int,
    mode: str,
) -> Tuple[List[Dict[str, Any]], int]:
    total_score = 0
    result_arrows: List[Dict[str, Any]] = []

    for idx, raw_arrow in enumerate(raw_arrows):
        raw_cells = raw_arrow.get("cells", [])
        pairs: List[Tuple[int, int]] = []
        for raw_cell in raw_cells:
            pair = _to_int_pair(raw_cell)
            if pair is not None:
                pairs.append(pair)

        if not pairs:
            continue

        converted_cells = [_convert_pair(pair, mode) for pair in pairs]
        expected_head_dir = _normalize_direction(raw_arrow.get("headdirection") or raw_arrow.get("direction"))
        ordered_cells, arrow_score = _pick_order_for_arrow(converted_cells, width, height, expected_head_dir)
        total_score += arrow_score

        direction = expected_head_dir
        if not direction:
            if len(ordered_cells) >= 2:
                direction = calculate_direction(ordered_cells[0], ordered_cells[1])
            else:
                direction = "up"

        result_arrows.append({
            "id": str(raw_arrow.get("id", idx)),
            "color": _normalize_color(raw_arrow.get("color")),
            "direction": direction,
            "type": _normalize_type(raw_arrow.get("type")),
            "cells": ordered_cells,
            "frozen": _normalize_frozen(raw_arrow.get("frozen", False)),
        })

    return result_arrows, total_score


def load_level_from_file(level_num: int) -> Optional[Dict[str, Any]]:
    """Load level and normalize coordinates for Web."""
    if not LEVELS_DIR.exists():
        try:
            os.makedirs(LEVELS_DIR)
        except OSError:
            pass

    possible_names = [f"{level_num}.json", f"level_{level_num}.json"]
    file_path = None
    for name in possible_names:
        temp_path = LEVELS_DIR / name
        if temp_path.exists():
            file_path = temp_path
            break

    if not file_path:
        print(f"⚠️ Level file not found for level {level_num}")
        return None

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)

        grid_raw = raw_data.get("grid", {})
        width = int(grid_raw.get("width", 4))
        height = int(grid_raw.get("height", 4))

        raw_arrows = raw_data.get("arrows", [])
        if not isinstance(raw_arrows, list):
            raw_arrows = []

        arrows_xy, score_xy = _build_mode_candidate(raw_arrows, width, height, "xy")
        arrows_rowcol, score_rowcol = _build_mode_candidate(raw_arrows, width, height, "rowcol")

        # Tie -> legacy-safe fallback (rowcol), equivalent to old loader behavior.
        if score_xy > score_rowcol:
            coord_mode = "xy"
            arrows = arrows_xy
        else:
            coord_mode = "rowcol"
            arrows = arrows_rowcol

        void_cells = []
        raw_void_cells = grid_raw.get("voidcells", [])
        if isinstance(raw_void_cells, list):
            for coord in raw_void_cells:
                pair = _to_int_pair(coord)
                if pair is None:
                    continue
                cell = _convert_pair(pair, coord_mode)
                if 0 <= cell["x"] < width and 0 <= cell["y"] < height:
                    void_cells.append(cell)

        print(
            f"[LevelLoader] Level {level_num}: mode={coord_mode}, "
            f"score_xy={score_xy}, score_rowcol={score_rowcol}, arrows={len(arrows)}"
        )

        meta_raw = raw_data.get("meta", {})
        difficulty = meta_raw.get("difficulty", "Normal")

        return {
            "seed": level_num,
            "grid": {
                "width": width,
                "height": height,
                "void_cells": void_cells,
            },
            "arrows": arrows,
            "meta": {
                "difficulty": difficulty,
                "arrow_count": len(arrows),
                "special_arrow_count": 0,
                "dag_depth": 1,
            },
        }

    except Exception as e:
        print(f"❌ Error parsing level file {file_path}: {e}")
        return None
