#!/usr/bin/env python3
"""Validate and summarize a JV/EQE Origin plotting bundle using only stdlib."""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

REQUIRED_FILES = {"data.xlsx", "origin-recipe.json"}


def load_recipe(bundle_path: Path) -> dict:
    if not bundle_path.is_file():
        raise ValueError(f"Bundle not found: {bundle_path}")
    if not zipfile.is_zipfile(bundle_path):
        raise ValueError("Bundle is not a valid ZIP file")
    with zipfile.ZipFile(bundle_path) as bundle:
        names = {name.replace("\\", "/") for name in bundle.namelist()}
        missing = REQUIRED_FILES - names
        if missing:
            raise ValueError(f"Bundle is missing: {', '.join(sorted(missing))}")
        if bundle.getinfo("data.xlsx").file_size <= 0:
            raise ValueError("data.xlsx is empty")
        recipe = json.loads(bundle.read("origin-recipe.json").decode("utf-8-sig"))
    validate_recipe(recipe)
    return recipe


def validate_recipe(recipe: dict) -> None:
    if recipe.get("schemaVersion") != "1.0":
        raise ValueError(f"Unsupported schemaVersion: {recipe.get('schemaVersion')!r}")
    if recipe.get("view") not in {"JV", "EQE"}:
        raise ValueError("view must be JV or EQE")
    workbook = recipe.get("workbook") or {}
    if workbook.get("file") != "data.xlsx" or workbook.get("worksheet") != "Origin作图":
        raise ValueError("Recipe does not target data.xlsx / Origin作图")
    curves = recipe.get("curves")
    if not isinstance(curves, list) or not curves:
        raise ValueError("Recipe must contain at least one curve")
    indices = []
    for position, curve in enumerate(curves, start=1):
        index = curve.get("index")
        x_column = curve.get("xColumn")
        y_column = curve.get("yColumn")
        if index != position:
            raise ValueError("Curve indices must be consecutive and one-based")
        if not isinstance(x_column, int) or y_column != x_column + 1:
            raise ValueError(f"Curve {position} must use adjacent numeric X/Y columns")
        indices.append(index)
    if len(indices) != len(set(indices)):
        raise ValueError("Curve indices must be unique")
    y_axis = (recipe.get("axes") or {}).get("y") or {}
    if y_axis.get("scale") not in {"linear", "log"}:
        raise ValueError("Y axis scale must be linear or log")
    if y_axis.get("transform") not in {"identity", "absolute"}:
        raise ValueError("Y axis transform must be identity or absolute")


def summary(recipe: dict) -> dict:
    return {
        "schemaVersion": recipe["schemaVersion"],
        "view": recipe["view"],
        "title": recipe.get("title", ""),
        "curves": len(recipe["curves"]),
        "yScale": recipe["axes"]["y"]["scale"],
        "yTransform": recipe["axes"]["y"]["transform"],
        "worksheet": recipe["workbook"]["worksheet"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--json", action="store_true", help="Print machine-readable summary")
    args = parser.parse_args()
    try:
        recipe = load_recipe(args.bundle.resolve())
    except (ValueError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    result = summary(recipe)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("Origin plotting bundle is valid")
        for key, value in result.items():
            print(f"  {key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
