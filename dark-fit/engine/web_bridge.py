"""Array adapter for the original fitting engine; no file uploads or new models."""
from __future__ import annotations

import contextlib
import io
import json
from types import SimpleNamespace

import numpy as np

from app.api_utils import analysis_payload, fit_payload, json_compatible
from app_services.product_modes import apply_product_fit_mode
from config import load_config
from fit.core import evaluate_params
from fit.evidence import EvidenceContext
from fit.parameter_schema import params_meta_from_values
from fit.workflow import AnalysisOptions, run_analysis


def _number(request, key, default, low, high):
    value = float(request.get(key, default))
    if not np.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{key} must be between {low} and {high}.")
    return value


def execute(request):
    source = request.get("dataset") or {}
    if source.get("type") != "JV" or source.get("illumination") == "light":
        raise ValueError("请选择暗态 JV 曲线；状态未识别的数据须先确认是暗电流。")
    if source.get("illumination") != "dark" and not request.get("allow_unknown"):
        raise ValueError("请确认未识别状态的曲线属于暗电流。")
    voltage = np.asarray(source.get("x", []), dtype=float)
    measured = np.asarray(source.get("y", []), dtype=float)
    if voltage.ndim != 1 or measured.ndim != 1 or voltage.size != measured.size:
        raise ValueError("电压和电流必须为等长的一维数组。")
    if not np.all(np.isfinite(voltage)) or not np.all(np.isfinite(measured)):
        raise ValueError("拟合数据包含非有限数值，请先检查源数据。")
    mask = np.ones(voltage.size, dtype=bool)
    low, high = request.get("voltage_min"), request.get("voltage_max")
    if low is not None and high is not None and float(low) >= float(high):
        raise ValueError("拟合电压下限须小于上限。")
    if low is not None:
        if not np.isfinite(float(low)):
            raise ValueError("拟合电压下限无效。")
        mask &= voltage >= float(low)
    if high is not None:
        if not np.isfinite(float(high)):
            raise ValueError("拟合电压上限无效。")
        mask &= voltage <= float(high)
    voltage, measured = voltage[mask], measured[mask]
    if voltage.size < 12 or np.unique(voltage).size < 8:
        raise ValueError("拟合窗口至少需要 12 个数据点和 8 个不同电压值。")
    if not np.any(measured != 0):
        raise ValueError("电流全部为零，无法拟合。")
    config = load_config()
    config.physics.T = _number(request, "temperature_k", 300, 1, 1500)
    config.physics.n = _number(request, "n", 1.4, 0.1, 20)
    config.physics.m = _number(request, "m", 2.4, 1, 20)
    # Units are supplied by the workbench parser: V and signed A/cm².
    dataset = SimpleNamespace(data_v=voltage, data_jd=measured, source={
        "label": source.get("label", ""), "device": source.get("device", ""),
        "point": source.get("point", ""), "path": source.get("source", ""),
        "points": int(voltage.size), "input_points": int(mask.size),
        "current_unit": "A/cm²", "voltage_unit": "V", "polarity_transform": "identity",
        "voltage_window": [float(np.min(voltage)), float(np.max(voltage))],
    })
    action = request.get("action", "fit")
    if action == "evaluate":
        if request.get("evaluator_kind") != "base_j0_rs_rsh_k":
            raise ValueError("当前候选模型不支持基础模型手动调参。")
        params = np.asarray(request.get("params", []), dtype=float)
        if params.shape != (4,) or not np.all(np.isfinite(params)) or np.any(params <= 0):
            raise ValueError("J0、Rs、Rsh、k 必须为有限正数。")
        fit = evaluate_params(voltage, measured, params, config, params_meta_from_values(params))
        payload = fit_payload(dataset, fit, notes=["手动参数预览，未执行优化；自动拟合结果单独保留。"])
        payload["product_fit_mode"] = "manual_preview"
    elif action == "fit":
        mode = request.get("product_fit_mode", "fast_fit")
        if mode not in {"fast_fit", "diagnostic_fit"}:
            raise ValueError("未知拟合模式。")
        settings = apply_product_fit_mode({}, mode)
        options = AnalysisOptions(
            fit_strategy=settings["fit_strategy"], sweep_strategies=settings["sweep_strategies"],
            scan_m=settings["scan_m"], scan_n=settings["scan_n"],
            compare_models=settings["compare_models"], post_fit_models=settings["post_fit_models"],
            evidence_context=EvidenceContext(current_is_density=True, temperature_k=config.physics.T),
            fit_verbose=False, analysis_verbose=False,
        )
        analysis = run_analysis(voltage, measured, options, config=config)
        payload = analysis_payload(dataset, analysis)
        payload["product_fit_mode"] = mode
    else:
        raise ValueError("未知拟合操作。")
    payload["input_snapshot"] = {
        "dataset_id": source.get("id"), "temperature_k": config.physics.T,
        "voltage_min": low, "voltage_max": high,
        "n": config.physics.n, "m": config.physics.m,
    }
    fitted = np.asarray(payload.get("series", {}).get("fitted", []), dtype=float)
    if fitted.size != voltage.size or not np.all(np.isfinite(fitted)):
        raise ValueError("拟合未得到有限数值曲线，请调整拟合窗口或检查原始电流。")
    return payload


def _finite_json(value):
    # The original serializer converts arrays to lists; recurse once more so
    # non-finite diagnostic-only values are valid JSON nulls for the browser.
    value = json_compatible(value)
    if isinstance(value, dict):
        return {key: _finite_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite_json(item) for item in value]
    return value


def execute_json(request_json):
    # Some original optimization diagnostics write to stdout. Keep worker output
    # machine-readable without changing that original engine behavior.
    with contextlib.redirect_stdout(io.StringIO()):
        result = execute(json.loads(request_json))
    return json.dumps(_finite_json(result), ensure_ascii=False, allow_nan=False)
