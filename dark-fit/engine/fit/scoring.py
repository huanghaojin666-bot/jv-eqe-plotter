"""Candidate-independent scores for comparing fitted current-voltage models.

The optimizer is free to use a task-specific residual.  Model comparison is
recomputed here on one mask defined only by the measured data so every model
is scored on exactly the same voltage points.
"""

from __future__ import annotations

from typing import Any

import numpy as np


DEFAULT_CURRENT_SCALE = 1e-11
DEFAULT_VOLTAGE_ZERO_ATOL = 1e-12
DEFAULT_INTERLEAVED_PHASE_COUNT = 5
COMPARISON_SCORE_NAME = "signed_asinh_parsimony"
INTERLEAVING_RULE = (
    "eligible measured-only points sorted by voltage (stable original-index "
    "tie-break), then phase k takes ordered positions k::phase_count"
)


def _as_vector(values: Any) -> np.ndarray:
    return np.asarray(values, dtype=float).reshape(-1)


def _validate_current_scale(current_scale: float) -> float:
    scale = float(current_scale)
    if not np.isfinite(scale) or scale <= 0.0:
        raise ValueError("current_scale must be finite and greater than zero.")
    return scale


def _validate_voltage_zero_atol(voltage_zero_atol: float) -> float:
    atol = float(voltage_zero_atol)
    if not np.isfinite(atol) or atol < 0.0:
        raise ValueError("voltage_zero_atol must be finite and non-negative.")
    return atol


def comparison_mask(
    voltage: np.ndarray,
    measured: np.ndarray,
    *,
    voltage_zero_atol: float = DEFAULT_VOLTAGE_ZERO_ATOL,
    current_scale: float = DEFAULT_CURRENT_SCALE,
) -> np.ndarray:
    """Return the common measured-only mask used for model comparison.

    A point is included when ``V`` and measured ``J`` are finite,
    ``|V| > voltage_zero_atol``, and ``|J_meas| >= current_scale``.  Predicted
    current is intentionally absent from the mask definition.
    """

    v = _as_vector(voltage)
    j = _as_vector(measured)
    if v.size != j.size:
        raise ValueError("voltage and measured must have the same length.")
    atol = _validate_voltage_zero_atol(voltage_zero_atol)
    scale = _validate_current_scale(current_scale)
    return (
        np.isfinite(v)
        & np.isfinite(j)
        & (np.abs(v) > atol)
        & (np.abs(j) >= scale)
    )


def signed_asinh_residuals(
    voltage: np.ndarray,
    measured: np.ndarray,
    predicted: np.ndarray,
    *,
    voltage_zero_atol: float = DEFAULT_VOLTAGE_ZERO_ATOL,
    current_scale: float = DEFAULT_CURRENT_SCALE,
) -> np.ndarray:
    r"""Return signed comparison residuals on the common measured-only mask.

    The residual is

    ``[asinh(J_pred / J_c) - asinh(J_meas / J_c)] / ln(10)``.

    It is finite and sign preserving near zero and approaches a base-10 log
    magnitude residual for large same-sign currents.  A non-finite prediction
    is not silently removed; it propagates to a non-finite score.
    """

    v = _as_vector(voltage)
    j_meas = _as_vector(measured)
    j_pred = _as_vector(predicted)
    if not (v.size == j_meas.size == j_pred.size):
        raise ValueError("voltage, measured, and predicted must have the same length.")
    scale = _validate_current_scale(current_scale)
    mask = comparison_mask(
        v,
        j_meas,
        voltage_zero_atol=voltage_zero_atol,
        current_scale=scale,
    )
    with np.errstate(over="ignore", invalid="ignore"):
        return (
            np.arcsinh(j_pred[mask] / scale)
            - np.arcsinh(j_meas[mask] / scale)
        ) / np.log(10.0)


def parsimony_score(residuals: np.ndarray, parameter_count: int) -> float:
    r"""Return the BIC-form penalized parsimony score ``S_P``.

    ``S_P = N ln(RSS/N) + p ln(N)``.  This is an internal comparison score,
    not a calibrated likelihood BIC or a model probability.  Empty or
    non-finite residual sets return infinity so they cannot win selection.
    """

    values = _as_vector(residuals)
    p = int(parameter_count)
    if p < 0:
        raise ValueError("parameter_count must be non-negative.")
    n = int(values.size)
    if n == 0 or not np.all(np.isfinite(values)):
        return float(np.inf)
    rss = max(float(np.sum(values**2)), np.finfo(float).tiny)
    return float(n * np.log(rss / n) + p * np.log(n))


def _score_residuals(residuals: np.ndarray, parameter_count: int) -> dict[str, float | int]:
    values = _as_vector(residuals)
    p = int(parameter_count)
    if p < 0:
        raise ValueError("parameter_count must be non-negative.")
    n = int(values.size)
    if n > 0 and np.all(np.isfinite(values)):
        rss = max(float(np.sum(values**2)), np.finfo(float).tiny)
        base = float(n * np.log(rss / n))
        aic_form = float(base + 2.0 * p)
    else:
        rss = float(np.inf)
        aic_form = float(np.inf)
    score = parsimony_score(values, p)
    return {
        "point_count": n,
        "parameter_count": p,
        "rss": rss,
        "aic_form_score": aic_form,
        "parsimony_score": score,
        # Compatibility aliases.  Do not describe these as calibrated ICs.
        "aic": aic_form,
        "bic": score,
    }


def interleaved_phase_scores(
    voltage: np.ndarray,
    measured: np.ndarray,
    predicted: np.ndarray,
    parameter_count: int,
    *,
    phase_count: int = DEFAULT_INTERLEAVED_PHASE_COUNT,
    voltage_zero_atol: float = DEFAULT_VOLTAGE_ZERO_ATOL,
    current_scale: float = DEFAULT_CURRENT_SCALE,
) -> dict[str, Any]:
    """Score ordered interleaved subsets of one common measured-only mask.

    For a nominal 0.01-V sweep, five phases correspond to five 0.05-V
    interleaves.  No grid regularity is assumed: irregular data use the same
    deterministic ordered-eligible-index rule recorded in the return value.
    """

    v = _as_vector(voltage)
    j = _as_vector(measured)
    pred = _as_vector(predicted)
    if not (v.size == j.size == pred.size):
        raise ValueError("voltage, measured, and predicted must have the same length.")
    phases = int(phase_count)
    if phases <= 0:
        raise ValueError("phase_count must be greater than zero.")
    p = int(parameter_count)
    if p < 0:
        raise ValueError("parameter_count must be non-negative.")
    scale = _validate_current_scale(current_scale)
    atol = _validate_voltage_zero_atol(voltage_zero_atol)
    eligible_mask = comparison_mask(v, j, voltage_zero_atol=atol, current_scale=scale)
    eligible_indices = np.flatnonzero(eligible_mask)
    order = np.argsort(v[eligible_indices], kind="stable")
    ordered_indices = eligible_indices[order]
    rows: list[dict[str, float | int | None]] = []
    for phase_index in range(phases):
        indices = ordered_indices[phase_index::phases]
        with np.errstate(over="ignore", invalid="ignore"):
            residuals = (
                np.arcsinh(pred[indices] / scale)
                - np.arcsinh(j[indices] / scale)
            ) / np.log(10.0)
        row = _score_residuals(residuals, p)
        row.update(
            {
                "phase_index": phase_index,
                "eligible_order_start": phase_index,
                "eligible_order_stride": phases,
                "min_voltage": float(np.min(v[indices])) if indices.size else None,
                "max_voltage": float(np.max(v[indices])) if indices.size else None,
            }
        )
        rows.append(row)
    return {
        "phase_count": phases,
        "rule": INTERLEAVING_RULE,
        "ordering": "ascending_voltage_stable_original_index",
        "mask": "measured_only",
        "eligible_point_count": int(ordered_indices.size),
        "phases": rows,
    }


def phase_score_deltas(
    reference_summary: dict[str, Any],
    candidate_summary: dict[str, Any],
) -> dict[str, Any]:
    """Return paired ``reference S_P - candidate S_P`` phase differences.

    Positive values favor the candidate.  This helper reports robustness
    evidence only; it does not apply a model-selection threshold.
    """

    reference = reference_summary.get("interleaved") or {}
    candidate = candidate_summary.get("interleaved") or {}
    if reference.get("rule") != candidate.get("rule"):
        raise ValueError("reference and candidate use different interleaving rules.")
    ref_rows = reference.get("phases") or []
    cand_rows = candidate.get("phases") or []
    if len(ref_rows) != len(cand_rows):
        raise ValueError("reference and candidate have different phase counts.")
    deltas: list[dict[str, float | int | None]] = []
    finite_values: list[float] = []
    for ref, cand in zip(ref_rows, cand_rows):
        ref_index = int(ref.get("phase_index", -1))
        cand_index = int(cand.get("phase_index", -1))
        if ref_index != cand_index:
            raise ValueError("reference and candidate phase indices do not align.")
        ref_score = float(ref.get("parsimony_score", np.inf))
        cand_score = float(cand.get("parsimony_score", np.inf))
        delta = float(ref_score - cand_score) if np.isfinite(ref_score) and np.isfinite(cand_score) else None
        if delta is not None:
            finite_values.append(delta)
        deltas.append(
            {
                "phase_index": ref_index,
                "reference_parsimony_score": ref_score,
                "candidate_parsimony_score": cand_score,
                "delta_parsimony_score": delta,
            }
        )
    return {
        "definition": "reference_parsimony_score - candidate_parsimony_score",
        "positive_favors": "candidate",
        "rule": reference.get("rule"),
        "phase_count": len(deltas),
        "evaluated_phase_count": len(finite_values),
        "positive_phase_count": int(np.sum(np.asarray(finite_values) > 0.0)),
        "median_delta_parsimony_score": (
            float(np.median(finite_values)) if finite_values else None
        ),
        "phases": deltas,
    }


def comparison_score_summary(
    voltage: np.ndarray,
    measured: np.ndarray,
    predicted: np.ndarray,
    parameter_count: int,
    *,
    phase_count: int = DEFAULT_INTERLEAVED_PHASE_COUNT,
    voltage_zero_atol: float = DEFAULT_VOLTAGE_ZERO_ATOL,
    current_scale: float = DEFAULT_CURRENT_SCALE,
) -> dict[str, Any]:
    """Return JSON-ready metadata and AIC/BIC-form compatibility scores.

    ``parsimony_score`` is the manuscript-facing ``S_P`` value.  The
    ``aic_form_score`` and legacy ``aic``/``bic`` fields are retained only for
    backwards compatibility with saved records and existing selection code.
    """

    v = _as_vector(voltage)
    j = _as_vector(measured)
    pred = _as_vector(predicted)
    if not (v.size == j.size == pred.size):
        raise ValueError("voltage, measured, and predicted must have the same length.")
    p = int(parameter_count)
    if p < 0:
        raise ValueError("parameter_count must be non-negative.")
    scale = _validate_current_scale(current_scale)
    atol = _validate_voltage_zero_atol(voltage_zero_atol)
    mask = comparison_mask(v, j, voltage_zero_atol=atol, current_scale=scale)
    residuals = signed_asinh_residuals(
        v,
        j,
        pred,
        voltage_zero_atol=atol,
        current_scale=scale,
    )
    full_score = _score_residuals(residuals, p)
    phases = interleaved_phase_scores(
        v,
        j,
        pred,
        p,
        phase_count=phase_count,
        voltage_zero_atol=atol,
        current_scale=scale,
    )
    summary: dict[str, Any] = {
        "name": COMPARISON_SCORE_NAME,
        "symbol": "S_P",
        "residual": "signed_asinh_log10_equivalent",
        "mask": "measured_only",
        "full_grid_role": "descriptive",
        "interpretation": "internal_parsimony_score_not_calibrated_likelihood_bic",
        "compatibility_aliases": {
            "bic": "parsimony_score",
            "aic": "aic_form_score",
        },
        "current_scale": scale,
        "voltage_zero_atol": atol,
        "excluded_point_count": int(v.size - np.sum(mask)),
        "interleaved": phases,
    }
    summary.update(full_score)
    return summary
