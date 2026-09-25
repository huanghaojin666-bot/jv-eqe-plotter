#!/usr/bin/env python3
"""Create an editable Origin project from a JV/EQE Origin plotting bundle."""

from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from inspect_bundle import load_recipe, summary

SKILL_ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = SKILL_ROOT / "vendor"
if VENDOR_DIR.is_dir() and str(VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(VENDOR_DIR))

SHEET_XML = "xl/worksheets/sheet1.xml"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _column_index(reference: str) -> int:
    match = re.match(r"([A-Z]+)", reference.upper())
    if not match:
        raise ValueError(f"Invalid cell reference: {reference}")
    value = 0
    for char in match.group(1):
        value = value * 26 + ord(char) - 64
    return value - 1


def read_origin_sheet(bundle_path: Path) -> tuple[list[str], list[list[float | None]]]:
    with zipfile.ZipFile(bundle_path) as outer:
        workbook_bytes = outer.read("data.xlsx")
    with zipfile.ZipFile(io.BytesIO(workbook_bytes)) as workbook:
        root = ET.fromstring(workbook.read(SHEET_XML))
    rows = root.findall(".//m:sheetData/m:row", NS)
    if not rows:
        raise ValueError("Origin作图 worksheet is empty")
    width = max((_column_index(cell.attrib["r"]) for row in rows for cell in row.findall("m:c", NS)), default=-1) + 1
    headers = [""] * width
    columns: list[list[float | None]] = [[] for _ in range(width)]
    for row_number, row in enumerate(rows):
        values: dict[int, str | float | None] = {}
        for cell in row.findall("m:c", NS):
            column = _column_index(cell.attrib["r"])
            if cell.attrib.get("t") == "inlineStr":
                values[column] = "".join(node.text or "" for node in cell.findall(".//m:t", NS))
            else:
                raw = cell.findtext("m:v", default="", namespaces=NS)
                values[column] = float(raw) if raw else None
        if row_number == 0:
            for column, value in values.items():
                headers[column] = str(value or "")
            continue
        for column in range(width):
            value = values.get(column)
            columns[column].append(float(value) if isinstance(value, (int, float)) else None)
    while columns and all(value is None for value in columns[-1]):
        columns.pop()
        headers.pop()
    return headers, columns


def finite_pairs(xs: list[float | None], ys: list[float | None], absolute_y: bool) -> tuple[list[float], list[float]]:
    x_values: list[float] = []
    y_values: list[float] = []
    for x_value, y_value in zip(xs, ys):
        if x_value is None or y_value is None or not math.isfinite(x_value) or not math.isfinite(y_value):
            continue
        plotted_y = abs(y_value) if absolute_y else y_value
        if absolute_y and plotted_y == 0:
            continue
        x_values.append(x_value)
        y_values.append(plotted_y)
    return x_values, y_values


def _try(warnings: list[str], label: str, operation) -> None:
    try:
        operation()
    except Exception as error:  # Origin versions expose slightly different style properties.
        warnings.append(f"{label}: {error}")


def _apply_plot_style(plot, curve: dict, warnings: list[str]) -> None:
    _try(warnings, f"curve {curve['index']} color", lambda: setattr(plot, "color", curve["color"]))
    width = max(0.1, float(curve.get("lineWidth") or 2))
    dash_codes = {"solid": 0, "dot": 2, "dash": 1, "dashdot": 3}
    dash_code = dash_codes.get(str(curve.get("lineStyle") or "solid").lower(), 0)
    # OriginLab Set command: -l 9 is Spline and -l 1 is Straight.
    connect = 9 if str(curve.get("interpolation") or "").lower() == "spline" else 1
    _try(
        warnings,
        f"curve {curve['index']} line",
        lambda: plot.set_cmd(f"-w {width:g}", f"-d {dash_code}", f"-l {connect}"),
    )


def create_project(bundle_path: Path, output_path: Path, show: bool) -> list[str]:
    recipe = load_recipe(bundle_path)
    headers, columns = read_origin_sheet(bundle_path)
    try:
        import originpro as op  # type: ignore
    except ImportError as error:
        raise RuntimeError(
            "The official originpro package is unavailable; use 64-bit CPython 3.12 "
            "or reinstall this skill with its vendor directory"
        ) from error

    warnings: list[str] = []
    external = bool(getattr(op, "oext", False))
    if external:
        op.set_show(show)
    workbook = op.new_book("w", lname=f"{recipe['view']} data")
    worksheet = workbook[0]
    worksheet.lname = recipe["workbook"]["worksheet"]
    plotted_columns: list[tuple[int, int]] = []
    absolute_y = recipe["axes"]["y"]["transform"] == "absolute"
    for curve_index, curve in enumerate(recipe["curves"]):
        source_x = curve["xColumn"] - 1
        source_y = curve["yColumn"] - 1
        if source_y >= len(columns):
            raise ValueError(f"Curve {curve['index']} points outside the worksheet")
        x_values, y_values = finite_pairs(columns[source_x], columns[source_y], absolute_y)
        target_x = curve_index * 2
        target_y = target_x + 1
        worksheet.from_list(target_x, x_values, headers[source_x] or f"X{curve_index + 1}", axis="X")
        worksheet.from_list(target_y, y_values, curve["name"], axis="Y")
        plotted_columns.append((target_x, target_y))

    graph = op.new_graph(template="line", lname=recipe.get("title") or f"{recipe['view']} curves")
    layer = graph[0]
    plots = []
    for curve, (column_x, column_y) in zip(recipe["curves"], plotted_columns):
        plot = layer.add_plot(worksheet, coly=column_y, colx=column_x, type="l")
        plots.append(plot)
        _apply_plot_style(plot, curve, warnings)
    _try(warnings, "X axis title", lambda: setattr(layer.label("xb"), "text", recipe["axes"]["x"]["title"]))
    _try(warnings, "Y axis title", lambda: setattr(layer.label("yl"), "text", recipe["axes"]["y"]["title"]))
    layer.rescale()
    x_range = recipe["axes"]["x"].get("range")
    y_range = recipe["axes"]["y"].get("range")
    if x_range:
        _try(warnings, "X axis range", lambda: layer.set_xlim(x_range[0], x_range[1], recipe["axes"]["x"].get("majorStep") or 0))
    if y_range:
        _try(warnings, "Y axis range", lambda: layer.set_ylim(y_range[0], y_range[1], recipe["axes"]["y"].get("majorStep") or 0))
    if recipe["axes"]["y"]["scale"] == "log":
        _try(warnings, "Y log scale", lambda: setattr(layer.axis("y"), "scale", "log10"))
    op.save(str(output_path))
    if external and not show:
        op.exit()
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--show", action="store_true", help="Show Origin during automation")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output project")
    parser.add_argument("--dry-run", action="store_true", help="Validate data and print the planned project without launching Origin")
    args = parser.parse_args()
    bundle_path = args.bundle.resolve()
    output_path = (args.output or bundle_path.with_suffix(".opju")).resolve()
    try:
        recipe = load_recipe(bundle_path)
        headers, columns = read_origin_sheet(bundle_path)
        required_columns = len(recipe["curves"]) * 2
        if len(columns) < required_columns or len(headers) < required_columns:
            raise ValueError(f"Workbook has {len(columns)} columns; recipe requires {required_columns}")
        if args.dry_run:
            plan = summary(recipe) | {"output": str(output_path), "workbookColumns": len(columns)}
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        if output_path.exists() and not args.force:
            raise ValueError(f"Output already exists: {output_path} (use --force only with user approval)")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        warnings = create_project(bundle_path, output_path, args.show)
    except (ValueError, RuntimeError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Created Origin project: {output_path}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
