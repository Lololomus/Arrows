import json
import os
from pathlib import Path
from typing import Optional, Dict, Any

# Папка с уровнями (относительно этого файла)
LEVELS_DIR = Path(__file__).parent.parent / "levels"

def calculate_direction(head: Dict[str, int], neck: Dict[str, int]) -> str:
    """
    Вычисляет направление, глядя на вектор от Шеи (1) к Голове (0).
    """
    dx = head["x"] - neck["x"]
    dy = head["y"] - neck["y"]

    if dx == 1: return "right"
    if dx == -1: return "left"
    if dy == 1: return "down"
    if dy == -1: return "up"
    
    return "up" # Fallback

def load_level_from_file(level_num: int) -> Optional[Dict[str, Any]]:
    """
    Загружает уровень и исправляет систему координат Godot -> Web.
    """
    # Создаем папку, если нет
    if not LEVELS_DIR.exists():
        try:
            os.makedirs(LEVELS_DIR)
        except OSError:
            pass

    # Ищем файл
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
            
        # 1. Grid (Меняем местами width/height, так как оси поворачиваются)
        grid_raw = raw_data.get("grid", {})
        # В Godot width=Cols(X), height=Rows(Y). Это совпадает с вебом.
        width = grid_raw.get("width", 4)
        height = grid_raw.get("height", 4)
        
        void_cells = []
        if "voidcells" in grid_raw:
            for coord in grid_raw["voidcells"]:
                if isinstance(coord, list) and len(coord) == 2:
                    # Godot [row, col] -> Web {x: col, y: row}
                    void_cells.append({"x": coord[1], "y": coord[0]})

        # 2. Arrows
        arrows = []
        for a in raw_data.get("arrows", []):
            raw_cells = a.get("cells", [])
            
            if not raw_cells:
                continue

            converted_cells = []
            for c in raw_cells:
                # ВАЖНО: Godot [row, col] (Y, X) -> Web {x: col, y: row}
                # c[0] - это Y (строка), c[1] - это X (колонка)
                converted_cells.append({"x": c[1], "y": c[0]})
            
            # ВАЖНО: Godot хранит от Хвоста к Голове.
            # Нам нужно от Головы к Хвосту.
            converted_cells.reverse()
            
            # Вычисляем направление сами (не верим JSON)
            direction = "up"
            if len(converted_cells) >= 2:
                direction = calculate_direction(converted_cells[0], converted_cells[1])
            
            # ВРЕМЕННО: Всё делаем обычными белыми стрелками
            arrows.append({
                "id": str(a["id"]),
                "color": "#FFFFFF", 
                "direction": direction,
                "type": "normal",
                "cells": converted_cells,
                "frozen": False
            })

        # 3. Meta
        meta_raw = raw_data.get("meta", {})
        # Берем сложность как строку или число
        difficulty = meta_raw.get("difficulty", "Normal")
        
        return {
            "seed": level_num,
            "grid": {
                "width": width,
                "height": height,
                "void_cells": void_cells
            },
            "arrows": arrows,
            "meta": {
                "difficulty": difficulty, 
                "arrow_count": len(arrows),
                "special_arrow_count": 0,
                "dag_depth": 1
            }
        }

    except Exception as e:
        print(f"❌ Error parsing level file {file_path}: {e}")
        return None