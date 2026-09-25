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

PAPER_STYLE = {
    "font": "Arial",
    "axisTitleSize": 18,
    "tickLabelSize": 14,
    "legendSize": 12,
    "axisLineWidth": 1.5,
    "pageWidth": 5000,
    "pageHeight": 4200,
    "layerLeft": 18,
    "layerTop": 8,
    "layerWidth": 74,
    "layerHeight": 78,
    "legendCorner": "bottom-right",
}


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


def _paper_style(recipe: dict) -> dict:
    requested = recipe.get("plot", {}).get("paperStyle") or {}
    style = dict(PAPER_STYLE)
    style["legendCorner"] = "bottom-left" if recipe.get("view") == "EQE" else "bottom-right"
    for key in (
        "axisTitleSize", "tickLabelSize", "legendSize", "axisLineWidth",
        "pageWidth", "pageHeight", "legendCorner",
    ):
        if key in requested:
            style[key] = requested[key]
    return style


def _system_line_template(op) -> str:
    """Prefer Origin's shipped template over a same-named user template.

    Origin resolves ``template="line"`` through the user files folder first. A
    user-saved LINE template can therefore leak text decoration into every axis
    title and legend created by the automation.  The installed template is a
    stable clean starting point and remains editable like any other graph.
    """
    try:
        candidate = Path(op.path("e")) / "LINE.otpu"
        if candidate.is_file():
            return str(candidate)
    except Exception:
        pass
    return "line"


def _axis_value(start: float, end: float, fraction: float, logarithmic: bool = False) -> float:
    if logarithmic and start > 0 and end > 0:
        return 10 ** (math.log10(start) + (math.log10(end) - math.log10(start)) * fraction)
    return start + (end - start) * fraction


def _mask_text_separator(op, graph, layer, label, recipe: dict, warnings: list[str], description: str) -> None:
    """Cover a retained Origin paragraph separator with a white vector line.

    Some user profiles retain the ``\\sep:50`` paragraph command for every new
    text object. Origin does not expose that command through GraphObject.Text or
    the object's theme tree, so it cannot be cleared through the normal Python
    properties. The separator sits exactly on the text object's top edge. A
    page-to-axis conversion lets us cover it without rasterizing the editable
    text object.
    """
    if description in {"X title", "Y title"}:
        try:
            from originpro.base import Line

            page_width = float(graph.get_float("width"))
            page_height = float(graph.get_float("height"))
            layer_left = float(layer.get_float("left")) / 100.0
            layer_top = float(layer.get_float("top")) / 100.0
            layer_width = float(layer.get_float("width")) / 100.0
            layer_height = float(layer.get_float("height")) / 100.0
            raw = layer.obj.GraphObjects.Add(4)
            if not raw:
                raise RuntimeError("unable to create page mask line")
            mask = Line(raw, layer.obj)
            mask.set_int("attach", 1)
            if description == "X title":
                center = layer_left + layer_width / 2.0
                half = float(label.obj.Width) / page_width / 2.0
                y = layer_top + layer_height + 0.055
                mask.set_float("x1", center - half)
                mask.set_float("y1", y)
                mask.set_float("x2", center + half)
                mask.set_float("y2", y)
            else:
                center = layer_top + layer_height / 2.0
                half = float(label.obj.Height) / page_height / 2.0
                title_gap = 0.096 if recipe["axes"]["y"]["scale"] == "log" else 0.078
                x = layer_left - title_gap
                mask.set_float("x1", x)
                mask.set_float("y1", center - half)
                mask.set_float("x2", x)
                mask.set_float("y2", center + half)
            mask.color = "white"
            mask.width = 6
            return
        except Exception as error:
            warnings.append(f"{description} page separator mask: {error}")

    try:
        page_width = float(graph.get_float("width"))
        page_height = float(graph.get_float("height"))
        layer_left = page_width * float(layer.get_float("left")) / 100.0
        layer_top = page_height * float(layer.get_float("top")) / 100.0
        layer_width = page_width * float(layer.get_float("width")) / 100.0
        layer_height = page_height * float(layer.get_float("height")) / 100.0
        if min(page_width, page_height, layer_width, layer_height) <= 0:
            raise ValueError("invalid page or layer dimensions")

        x_start = float(layer.get_float("x.from"))
        x_end = float(layer.get_float("x.to"))
        y_start = float(layer.get_float("y.from"))
        y_end = float(layer.get_float("y.to"))
        logarithmic_x = recipe["axes"]["x"]["scale"] == "log"
        logarithmic_y = recipe["axes"]["y"]["scale"] == "log"

        def page_x(value: float) -> float:
            fraction = (value - layer_left) / layer_width
            return _axis_value(x_start, x_end, fraction, logarithmic_x)

        def page_y(value: float) -> float:
            fraction = 1.0 - (value - layer_top) / layer_height
            return _axis_value(y_start, y_end, fraction, logarithmic_y)

        left = float(label.obj.Left)
        top = float(label.obj.Top)
        width = float(label.obj.Width)
        height = float(label.obj.Height)
        rotation = float(label.get_float("rotate"))
        if not math.isfinite(rotation):
            rotation = float(label.get_float("angle"))

        if 45 <= abs(rotation) % 180 <= 135:
            mask = layer.add_line(page_x(left), page_y(top), page_x(left), page_y(top + height))
        else:
            mask = layer.add_line(page_x(left), page_y(top), page_x(left + width), page_y(top))
        if not mask:
            raise RuntimeError("unable to create mask line")
        mask.color = "white"
        mask.width = 5
    except Exception as error:
        warnings.append(f"{description} separator mask: {error}")


def _add_clean_legend(op, graph, layer, recipe: dict, style: dict, warnings: list[str], font_index: int) -> None:
    """Draw line samples and labels separately for Origin 2024 compatibility."""
    existing = layer.label("legend")
    if existing:
        _try(warnings, "default legend removal", existing.remove)

    try:
        x_start = float(layer.get_float("x.from"))
        x_end = float(layer.get_float("x.to"))
        y_start = float(layer.get_float("y.from"))
        y_end = float(layer.get_float("y.to"))
    except Exception as error:
        warnings.append(f"custom legend ranges: {error}")
        return

    left_corner = style["legendCorner"] == "bottom-left"
    line_start_fraction = 0.10 if left_corner else 0.64
    line_end_fraction = 0.17 if left_corner else 0.71
    text_fraction = 0.19 if left_corner else 0.73
    row_start = 0.30
    row_gap = min(0.055, 0.22 / max(1, len(recipe["curves"]) - 1))
    logarithmic_y = recipe["axes"]["y"]["scale"] == "log"

    for row, curve in enumerate(recipe["curves"]):
        text_row_fraction = max(0.07, row_start - row * row_gap)
        # A scale-attached label uses its Y coordinate at the text's top edge.
        # Move the line sample down slightly so it crosses the visual midline.
        line_row_fraction = max(0.055, text_row_fraction - 0.014)
        text_y = _axis_value(y_start, y_end, text_row_fraction, logarithmic_y)
        line_y = _axis_value(y_start, y_end, line_row_fraction, logarithmic_y)
        line = layer.add_line(
            _axis_value(x_start, x_end, line_start_fraction),
            line_y,
            _axis_value(x_start, x_end, line_end_fraction),
            line_y,
        )
        if line:
            _try(warnings, f"legend line {curve['index']} color", lambda line=line, curve=curve: setattr(line, "color", curve["color"]))
            _try(warnings, f"legend line {curve['index']} width", lambda line=line, curve=curve: setattr(line, "width", max(0.1, float(curve.get("lineWidth") or 2))))
        label = layer.add_label(
            str(curve["name"]),
            _axis_value(x_start, x_end, text_fraction),
            text_y,
        )
        if label:
            _try(warnings, f"legend label {curve['index']} font", lambda label=label: label.set_int("font", font_index))
            _try(warnings, f"legend label {curve['index']} size", lambda label=label: label.set_float("fsize", float(style["legendSize"])))
            _try(warnings, f"legend label {curve['index']} color", lambda label=label: setattr(label, "color", "black"))
            _mask_text_separator(op, graph, layer, label, recipe, warnings, f"legend label {curve['index']}")
        if not label:
            warnings.append(f"legend label {curve['index']}: unable to create text object")


def _apply_paper_graph_style(op, graph, layer, recipe: dict, warnings: list[str], font_index: int) -> None:
    style = _paper_style(recipe)
    _try(warnings, "graph page width", lambda: graph.set_float("width", float(style["pageWidth"])))
    _try(warnings, "graph page height", lambda: graph.set_float("height", float(style["pageHeight"])))
    for prop in ("left", "top", "width", "height"):
        key = f"layer{prop.title()}"
        _try(warnings, f"layer {prop}", lambda prop=prop, key=key: layer.set_float(prop, float(style[key])))

    for axis_name in ("x", "y"):
        axis_label = axis_name.upper()
        _try(warnings, f"{axis_label} axis color", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.color", 1))
        _try(warnings, f"{axis_label} axis frame", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.showAxes", 3))
        _try(warnings, f"{axis_label} tick labels", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.showLabels", 1))
        _try(warnings, f"{axis_label} grid", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.showGrids", 0))
        _try(warnings, f"{axis_label} inward ticks", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.ticks", 5))
        _try(warnings, f"{axis_label} axis width", lambda axis_name=axis_name: layer.set_float(f"{axis_name}.thickness", float(style["axisLineWidth"])))
        _try(warnings, f"{axis_label} major tick width", lambda axis_name=axis_name: layer.set_float(f"{axis_name}.tickthickness", float(style["axisLineWidth"])))
        _try(warnings, f"{axis_label} minor tick width", lambda axis_name=axis_name: layer.set_float(f"{axis_name}.mtickthickness", 1.0))
        _try(warnings, f"{axis_label} major tick length", lambda axis_name=axis_name: layer.set_float(f"{axis_name}.ticklength", 5.0))
        _try(warnings, f"{axis_label} minor tick length", lambda axis_name=axis_name: layer.set_float(f"{axis_name}.mticklength", 3.0))
        _try(warnings, f"{axis_label} tick font", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.label.font", font_index))
        _try(warnings, f"{axis_label} tick size", lambda axis_name=axis_name: layer.set_float(f"{axis_name}.label.pt", float(style["tickLabelSize"])))
        _try(warnings, f"{axis_label} tick weight", lambda axis_name=axis_name: layer.set_int(f"{axis_name}.label.bold", 0))

    for label_name, description, title in (
        ("xb", "X title", recipe["axes"]["x"]["title"]),
        ("yl", "Y title", recipe["axes"]["y"]["title"]),
    ):
        label = layer.label(label_name)
        if label:
            _try(warnings, f"{description} text", lambda label=label, title=title: setattr(label, "text", title))
            _try(warnings, f"{description} font", lambda label=label: label.set_int("font", font_index))
            _try(warnings, f"{description} size", lambda label=label: label.set_float("fsize", float(style["axisTitleSize"])))
            _mask_text_separator(op, graph, layer, label, recipe, warnings, description)

    for label_name in ("xt", "yr"):
        opposite_title = layer.label(label_name)
        if opposite_title:
            _try(warnings, f"{label_name.upper()} title hide", lambda opposite_title=opposite_title: opposite_title.set_int("show", 0))

    show_legend = bool(recipe.get("plot", {}).get("legend", True))
    if show_legend:
        _add_clean_legend(op, graph, layer, recipe, style, warnings, font_index)
    else:
        legend = layer.label("legend")
        if legend:
            _try(warnings, "legend removal", legend.remove)


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
    # Keep new labels in ordinary single-column mode even when a user profile
    # saved multi-column auto-alignment as its default.
    op.lt_exec("SYSTEM.FONT.TEXTCNTRL=0; SYSTEM.LEGEND.TEXTCNTRL=0;")
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

    graph = op.new_graph(template=_system_line_template(op), lname=recipe.get("title") or f"{recipe['view']} curves")
    layer = graph[0]
    plots = []
    for curve, (column_x, column_y) in zip(recipe["curves"], plotted_columns):
        plot = layer.add_plot(worksheet, coly=column_y, colx=column_x, type="l")
        plots.append(plot)
        _apply_plot_style(plot, curve, warnings)
    layer.rescale()
    x_range = recipe["axes"]["x"].get("range")
    y_range = recipe["axes"]["y"].get("range")
    if x_range:
        _try(warnings, "X axis range", lambda: layer.set_xlim(x_range[0], x_range[1], recipe["axes"]["x"].get("majorStep") or 0))
    if y_range:
        _try(warnings, "Y axis range", lambda: layer.set_ylim(y_range[0], y_range[1], recipe["axes"]["y"].get("majorStep") or 0))
    if recipe["axes"]["y"]["scale"] == "log":
        _try(warnings, "Y log scale", lambda: setattr(layer.axis("y"), "scale", "log10"))
    font_index = op.lt_int("font(Arial)") or 1
    _apply_paper_graph_style(op, graph, layer, recipe, warnings, font_index)
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
