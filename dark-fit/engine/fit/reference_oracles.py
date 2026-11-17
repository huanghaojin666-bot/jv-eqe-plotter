from __future__ import annotations

from importlib import import_module
from typing import Any

import numpy as np
from scipy.special import lambertw

from config import Config
from fit.core import clone_config
from fit.model import diode_model


KB_EV_PER_K = 8.617333262145e-5


def lambert_w_single_diode_current_density(
    voltage_v: np.ndarray,
    *,
    saturation_current_density_a_cm2: float,
    rs_ohm_cm2: float,
    rsh_ohm_cm2: float,
    ideality_factor: float,
    temperature_k: float,
) -> np.ndarray:
    """Closed-form evaluator for the dark single-diode equation.

    This independently evaluates the same area-normalized equation used by the
    implicit root solver when the empirical non-ohmic coefficient is zero.
    """

    voltage = np.asarray(voltage_v, dtype=float).reshape(-1)
    j0 = float(saturation_current_density_a_cm2)
    rs = float(rs_ohm_cm2)
    rsh = float(rsh_ohm_cm2)
    n_vth = float(ideality_factor) * KB_EV_PER_K * float(temperature_k)
    if j0 <= 0.0 or rs <= 0.0 or rsh <= 0.0 or n_vth <= 0.0:
        raise ValueError("J0, Rs, Rsh, ideality factor, and temperature must be positive.")
    exponent = rsh * (rs * j0 + voltage) / (n_vth * (rs + rsh))
    factor = rs * rsh * j0 / (n_vth * (rs + rsh))
    argument = factor * np.exp(np.clip(exponent, -700.0, 700.0))
    value = lambertw(argument)
    if np.any(np.abs(value.imag) > 1e-12):
        raise RuntimeError("Lambert-W evaluator left the real physical branch.")
    return (n_vth / rs) * value.real - (rsh * j0 - voltage) / (rs + rsh)


def pvlib_single_diode_current_density(
    voltage_v: np.ndarray,
    *,
    saturation_current_density_a_cm2: float,
    rs_ohm_cm2: float,
    rsh_ohm_cm2: float,
    ideality_factor: float,
    temperature_k: float,
) -> tuple[np.ndarray, str]:
    """Evaluate the same dark SDM with pvlib when that optional oracle exists."""

    try:
        pvlib = import_module("pvlib")
    except ModuleNotFoundError as exc:
        raise RuntimeError("pvlib is not installed; the internal Lambert-W oracle remains available.") from exc
    current_out_of_device = pvlib.pvsystem.i_from_v(
        voltage=np.asarray(voltage_v, dtype=float),
        photocurrent=0.0,
        saturation_current=float(saturation_current_density_a_cm2),
        resistance_series=float(rs_ohm_cm2),
        resistance_shunt=float(rsh_ohm_cm2),
        nNsVth=float(ideality_factor) * KB_EV_PER_K * float(temperature_k),
        method="lambertw",
    )
    # pvlib uses PV output-current sign; this project uses forward diode current
    # as positive, so dark current has the opposite sign.
    return -np.asarray(current_out_of_device, dtype=float).reshape(-1), str(pvlib.__version__)


def single_diode_evaluator_agreement(
    voltage_v: np.ndarray,
    *,
    saturation_current_density_a_cm2: float,
    rs_ohm_cm2: float,
    rsh_ohm_cm2: float,
    ideality_factor: float,
    temperature_k: float,
    include_pvlib_if_available: bool = True,
) -> dict[str, Any]:
    """Compare the production implicit root against independent evaluators."""

    voltage = np.asarray(voltage_v, dtype=float).reshape(-1)
    config: Config = clone_config()
    config.physics.n = float(ideality_factor)
    config.physics.T = float(temperature_k)
    params = np.array(
        [
            saturation_current_density_a_cm2,
            rs_ohm_cm2,
            rsh_ohm_cm2,
            0.0,
        ],
        dtype=float,
    )
    implicit = diode_model(voltage, params, config)
    lambert = lambert_w_single_diode_current_density(
        voltage,
        saturation_current_density_a_cm2=saturation_current_density_a_cm2,
        rs_ohm_cm2=rs_ohm_cm2,
        rsh_ohm_cm2=rsh_ohm_cm2,
        ideality_factor=ideality_factor,
        temperature_k=temperature_k,
    )

    def comparison(reference: np.ndarray) -> dict[str, float]:
        delta = implicit - reference
        scale = max(float(np.max(np.abs(reference))), np.finfo(float).tiny)
        return {
            "max_absolute_current_density_error_a_cm2": float(np.max(np.abs(delta))),
            "max_error_relative_to_curve_scale": float(np.max(np.abs(delta)) / scale),
            "rms_error_relative_to_curve_scale": float(np.sqrt(np.mean(delta**2)) / scale),
        }

    result: dict[str, Any] = {
        "status": "lambert_w_reference_checked",
        "implicit_vs_lambert_w": comparison(lambert),
        "pvlib": {
            "available": False,
            "source": "https://doi.org/10.21105/joss.05994",
            "license": "BSD-3-Clause",
            "role": "optional external equation oracle, never a mechanism selector",
        },
    }
    if include_pvlib_if_available:
        try:
            pvlib_current, version = pvlib_single_diode_current_density(
                voltage,
                saturation_current_density_a_cm2=saturation_current_density_a_cm2,
                rs_ohm_cm2=rs_ohm_cm2,
                rsh_ohm_cm2=rsh_ohm_cm2,
                ideality_factor=ideality_factor,
                temperature_k=temperature_k,
            )
        except RuntimeError as exc:
            result["pvlib"]["reason"] = str(exc)
        else:
            result["status"] = "lambert_w_and_pvlib_references_checked"
            result["pvlib"].update(
                {
                    "available": True,
                    "version": version,
                    "implicit_vs_pvlib": comparison(pvlib_current),
                }
            )
    return result
