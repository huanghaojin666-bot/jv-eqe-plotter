"""Bounded refinement of the existing four-branch parameters and exponents.

This changes numerical search, not the current equation or mechanism claims.
"""
from __future__ import annotations

import copy
from typing import Iterable

import numpy as np
from scipy.optimize import least_squares

from fit.core import FitResult, clone_config, evaluate_params
from fit.model import diode_model, error_statistics, signed_log_residual
from fit.region_stats import region_error_stats
from fit.parameter_schema import BASE_EVALUATOR_KIND, fit_evaluator_kind


def fit_is_adequate(fit: FitResult) -> bool:
    cfg = fit.config.fitting
    return bool(
        fit.stats.get("included_points", 0) >= cfg.core_window_min_points
        and fit.stats.get("mean", np.inf) <= cfg.core_fit_good_mean_error
        and fit.stats.get("max", np.inf) <= cfg.core_fit_good_max_error
    )


def adaptive_bounds(voltage: np.ndarray, current: np.ndarray, meta: dict, config, max_m: float) -> dict:
    """Expand legacy device-specific limits using the observed signal scale.

    These are positive numerical search limits, not literature-derived priors.
    Explicit caller bounds are left alone by the workflow.
    """
    result = copy.deepcopy(meta)
    floor = max(float(config.fitting.current_noise_floor), 1e-18)
    scale_v = max(float(np.max(np.abs(voltage))), 0.01)
    signal = max(float(np.quantile(np.abs(current), 0.9)), floor)
    scale_r = scale_v / signal
    power_scale = max(scale_v**max_m, 1e-12)
    lower = np.array([floor * 1e-3, scale_r * 1e-5, scale_r * 1e-3, floor * 1e-3 / power_scale])
    upper = np.array([signal * 10, scale_r * 100, scale_r * 1e5, signal * 100 / power_scale])
    result["lb"] = np.minimum(np.asarray(meta["lb"]), np.maximum(lower, [1e-18, 1e-6, 1e-3, 1e-20]))
    result["ub"] = np.maximum(np.asarray(meta["ub"]), np.minimum(upper, [1e3, 1e14, 1e18, 1e6]))
    result["bounds_policy"] = "signal_scaled_numerical_limits"
    return result


def _exponent_range(values: Iterable[float] | None, fixed: float) -> tuple[float, float]:
    grid = [float(x) for x in values] if values is not None else [float(fixed)]
    if not grid or any(not np.isfinite(x) or x <= 0 for x in grid):
        raise ValueError("Exponent values must be finite and positive.")
    return min(grid), max(grid)


def refine_baseline_fit(
    voltage: np.ndarray,
    current: np.ndarray,
    reference: FitResult,
    *,
    n_values: Iterable[float] | None = None,
    m_values: Iterable[float] | None = None,
    allow_bound_expansion: bool = True,
) -> FitResult:
    """Refine inadequate fits; retain an adequate or better reference unchanged.

    Exponents stay inside the requested scan range. An adequate candidate takes
    precedence over an inadequate fit; other replacements must improve both
    error metrics. No acceptance gate is relaxed.
    """
    if fit_is_adequate(reference):
        return reference
    v = np.asarray(voltage, dtype=float).reshape(-1)
    j = np.asarray(current, dtype=float).reshape(-1)
    if v.size != j.size or not v.size or not np.all(np.isfinite(v) & np.isfinite(j)):
        raise ValueError("Refinement requires matching finite voltage/current arrays.")
    if reference.params.size != 4 or fit_evaluator_kind(reference) != BASE_EVALUATOR_KIND:
        return reference
    n_range = _exponent_range(n_values, reference.n)
    m_range = _exponent_range(m_values, reference.m)
    meta = copy.deepcopy(reference.params_meta)
    if allow_bound_expansion:
        meta = adaptive_bounds(v, j, meta, reference.config, m_range[1])
    lo = np.log10(meta["lb"])
    hi = np.log10(meta["ub"])
    best = reference
    attempts = []
    # Start with the same exponents; only add continuous exponent refinement
    # if that simpler search remains inadequate.
    for joint in (False, True):
        if joint and (fit_is_adequate(best) or (n_range[0] == n_range[1] and m_range[0] == m_range[1])):
            break
        cfg = clone_config(best.config)
        x0 = np.log10(np.clip(best.params, meta["lb"] * (1 + 1e-8), meta["ub"] / (1 + 1e-8)))
        lower, upper = lo.copy(), hi.copy()
        free_exponents = []
        for name, bounds, value in (("n", n_range, cfg.physics.n), ("m", m_range, cfg.physics.m)):
            if joint and bounds[0] < bounds[1]:
                free_exponents.append(name)
                x0 = np.r_[x0, np.clip(value, bounds[0] + 1e-8, bounds[1] - 1e-8)]
                lower = np.r_[lower, bounds[0]]
                upper = np.r_[upper, bounds[1]]

        def residual(x):
            for idx, name in enumerate(free_exponents, 4):
                setattr(cfg.physics, name, float(x[idx]))
            predicted = diode_model(v, 10**x[:4], cfg)
            errors = signed_log_residual(predicted, j, cfg.fitting.current_noise_floor)
            if cfg.regularization.lambda_ > 0:
                penalty = np.sqrt(cfg.regularization.lambda_) * (10**x[:4] - cfg.regularization.prior)
                errors = np.r_[errors, penalty]
            return errors

        starts = [x0]
        if joint and float(best.stats["mean"]) > 20:
            alternate = x0.copy()
            alternate[4:] = (lower[4:] + upper[4:]) / 2
            starts.append(alternate)
        candidates = []
        for start in starts:
            optimized = least_squares(
                residual, start, bounds=(lower, upper), x_scale="jac",
                max_nfev=1200, ftol=1e-9, xtol=1e-9, gtol=1e-9, diff_step=1e-5,
            )
            residual(optimized.x)
            p = 10**optimized.x[:4]
            predicted = diode_model(v, p, cfg)
            stats = error_statistics(v, j, predicted, current_noise_floor=cfg.fitting.current_noise_floor,
                                     voltage_zero_atol=cfg.fitting.voltage_zero_atol)
            attempts.append({"joint_exponents": joint, "mean": stats["mean"], "max": stats["max"],
                             "n": cfg.physics.n, "m": cfg.physics.m, "nfev": optimized.nfev,
                             "params": p.tolist(),
                             "optimizer_converged": bool(optimized.success)})
            adequate = (
                stats["included_points"] >= cfg.fitting.core_window_min_points
                and stats["mean"] <= cfg.fitting.core_fit_good_mean_error
                and stats["max"] <= cfg.fitting.core_fit_good_max_error
            )
            if (np.isfinite(stats["mean"]) and np.isfinite(stats["max"])
                    and (adequate or (stats["mean"] <= best.stats["mean"] + 1e-6
                                     and stats["max"] <= best.stats["max"] + 1e-6))):
                candidate_meta = copy.deepcopy(meta)
                candidate_meta["x0"] = p
                candidate = evaluate_params(v, j, p, cfg, candidate_meta)
                candidate.diagnostics["strategy"] = reference.diagnostics.get("strategy", "quick_global")
                candidate.diagnostics["region_stats"] = region_error_stats(v, j, predicted, cfg)
                candidate.diagnostics["effective_free_parameter_count"] = 4 + len(free_exponents)
                candidates.append(candidate)
        if candidates:
            best = min(candidates, key=lambda fit: (not fit_is_adequate(fit), fit.stats["mean"], fit.stats["max"]))
    decision = {"attempted": True, "used": best is not reference,
                "reference_mean": float(reference.stats["mean"]), "reference_max": float(reference.stats["max"]),
                "n_bounds": list(n_range), "m_bounds": list(m_range),
                "bounds_expanded": allow_bound_expansion, "attempts": attempts,
                "claim": "effective response refinement, not microscopic mechanism identification"}
    best.diagnostics["baseline_refinement"] = decision
    best.fit_results["diagnostics"] = best.diagnostics
    return best
