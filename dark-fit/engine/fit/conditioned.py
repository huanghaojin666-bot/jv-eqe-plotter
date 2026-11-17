from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Iterable

import numpy as np
from scipy.optimize import brentq, least_squares


EPSILON_0_F_PER_CM = 8.8541878128e-14
ELEMENTARY_CHARGE_C = 1.602176634e-19
KB_EV_PER_K = 8.617333262145e-5
SCLC_MAX_THICKNESS_MOBILITY_GSD = 2.0


def _vector(values: Any) -> np.ndarray:
    return np.asarray(values, dtype=float).reshape(-1)


@dataclass(frozen=True)
class SCLCRecord:
    """One current-density sweep from a single-carrier device."""

    voltage_v: np.ndarray
    current_density_a_cm2: np.ndarray
    thickness_nm: float
    temperature_k: float = 300.0
    device_id: str = ""
    bias_polarity: int = 1

    def __post_init__(self) -> None:
        voltage = _vector(self.voltage_v)
        current = _vector(self.current_density_a_cm2)
        if voltage.size != current.size or voltage.size < 3:
            raise ValueError("SCLCRecord voltage and current-density arrays must have the same length >= 3.")
        if not np.isfinite(self.thickness_nm) or self.thickness_nm <= 0.0:
            raise ValueError("SCLCRecord thickness_nm must be positive.")
        if not np.isfinite(self.temperature_k) or self.temperature_k <= 0.0:
            raise ValueError("SCLCRecord temperature_k must be positive.")
        if self.bias_polarity not in {-1, 1}:
            raise ValueError("SCLCRecord bias_polarity must be +1 or -1.")
        object.__setattr__(self, "voltage_v", voltage)
        object.__setattr__(self, "current_density_a_cm2", current)


@dataclass(frozen=True)
class SCLCProtocolEvidence:
    """Independent evidence required by the VAMAS-style SCLC protocol."""

    carrier_type: str
    efficient_injection: bool
    unipolar_device: bool
    relative_permittivity: float
    built_in_voltage_v: float = 0.0
    series_resistance_ohm_cm2: float = 0.0
    hysteresis_checked: bool = False
    stable_sweep: bool = False
    repeat_device_count: int = 1
    thickness_uncertainty_fraction: float = 0.0
    area_uncertainty_fraction: float = 0.0
    permittivity_uncertainty_fraction: float = 0.0
    built_in_voltage_uncertainty_v: float = 0.0

    def __post_init__(self) -> None:
        if self.relative_permittivity <= 0.0:
            raise ValueError("relative_permittivity must be positive.")
        if self.series_resistance_ohm_cm2 < 0.0:
            raise ValueError("series_resistance_ohm_cm2 cannot be negative.")
        for value in (
            self.thickness_uncertainty_fraction,
            self.area_uncertainty_fraction,
            self.permittivity_uncertainty_fraction,
        ):
            if value < 0.0:
                raise ValueError("relative uncertainty values cannot be negative.")


@dataclass(frozen=True)
class FieldTemperatureRecord:
    """One reverse-field current-density sweep at a declared T and thickness."""

    voltage_v: np.ndarray
    current_density_a_cm2: np.ndarray
    temperature_k: float
    thickness_nm: float
    device_id: str = ""
    reverse_polarity: int = -1

    def __post_init__(self) -> None:
        voltage = _vector(self.voltage_v)
        current = _vector(self.current_density_a_cm2)
        if voltage.size != current.size or voltage.size < 3:
            raise ValueError("FieldTemperatureRecord arrays must have the same length >= 3.")
        if self.temperature_k <= 0.0 or self.thickness_nm <= 0.0:
            raise ValueError("temperature_k and thickness_nm must be positive.")
        if self.reverse_polarity not in {-1, 1}:
            raise ValueError("reverse_polarity must be +1 or -1.")
        object.__setattr__(self, "voltage_v", voltage)
        object.__setattr__(self, "current_density_a_cm2", current)


@dataclass(frozen=True)
class PVJVRecord:
    """One dark or illuminated PV J-V record from a declared device."""

    voltage_v: np.ndarray
    current_density_a_cm2: np.ndarray
    condition: str
    temperature_k: float = 300.0
    device_id: str = ""
    illumination_label: str = ""

    def __post_init__(self) -> None:
        voltage = _vector(self.voltage_v)
        current = _vector(self.current_density_a_cm2)
        condition = self.condition.strip().lower()
        if voltage.size != current.size or voltage.size < 5:
            raise ValueError("PVJVRecord arrays must have the same length >= 5.")
        if condition not in {"dark", "light"}:
            raise ValueError("PVJVRecord condition must be 'dark' or 'light'.")
        if self.temperature_k <= 0.0:
            raise ValueError("PVJVRecord temperature_k must be positive.")
        object.__setattr__(self, "voltage_v", voltage)
        object.__setattr__(self, "current_density_a_cm2", current)
        object.__setattr__(self, "condition", condition)


def mott_gurney_current_density(
    effective_voltage_v: np.ndarray | float,
    *,
    mobility_cm2_v_s: float,
    relative_permittivity: float,
    thickness_cm: float,
) -> np.ndarray:
    voltage = np.maximum(_vector(effective_voltage_v), 0.0)
    epsilon = EPSILON_0_F_PER_CM * float(relative_permittivity)
    return (9.0 / 8.0) * epsilon * float(mobility_cm2_v_s) * voltage**2 / float(thickness_cm) ** 3


def murgatroyd_current_density(
    effective_voltage_v: np.ndarray | float,
    *,
    mobility_zero_field_cm2_v_s: float,
    field_activation_sqrt_cm_v: float,
    relative_permittivity: float,
    thickness_cm: float,
) -> np.ndarray:
    voltage = np.maximum(_vector(effective_voltage_v), 0.0)
    field = voltage / float(thickness_cm)
    base = mott_gurney_current_density(
        voltage,
        mobility_cm2_v_s=mobility_zero_field_cm2_v_s,
        relative_permittivity=relative_permittivity,
        thickness_cm=thickness_cm,
    )
    return base * np.exp(np.clip(0.89 * float(field_activation_sqrt_cm_v) * np.sqrt(field), -100.0, 100.0))


def _pv_branch_current(
    internal_voltage_v: np.ndarray,
    *,
    j01_a_cm2: float,
    j02_a_cm2: float,
    rsh_ohm_cm2: float,
    photocurrent_a_cm2: float,
    temperature_k: float,
) -> np.ndarray:
    thermal_voltage = KB_EV_PER_K * float(temperature_k)
    voltage = _vector(internal_voltage_v)
    diffusion = float(j01_a_cm2) * (np.exp(np.clip(voltage / thermal_voltage, -100.0, 100.0)) - 1.0)
    recombination = float(j02_a_cm2) * (
        np.exp(np.clip(voltage / (2.0 * thermal_voltage), -100.0, 100.0)) - 1.0
    )
    return diffusion + recombination + voltage / float(rsh_ohm_cm2) - float(photocurrent_a_cm2)


def joint_pv_double_diode_current(
    voltage_v: np.ndarray,
    *,
    j01_a_cm2: float,
    j02_a_cm2: float,
    rs_ohm_cm2: float,
    rsh_ohm_cm2: float,
    photocurrent_a_cm2: float,
    temperature_k: float,
) -> np.ndarray:
    """Solve the fixed n=1/n=2 double-diode equation for signed J(V)."""

    voltage = _vector(voltage_v)
    rs = float(rs_ohm_cm2)
    if rs <= 0.0 or rsh_ohm_cm2 <= 0.0:
        raise ValueError("PV area-normalized Rs and Rsh must be positive.")

    def branch(u: np.ndarray) -> np.ndarray:
        return _pv_branch_current(
            u,
            j01_a_cm2=j01_a_cm2,
            j02_a_cm2=j02_a_cm2,
            rsh_ohm_cm2=rsh_ohm_cm2,
            photocurrent_a_cm2=photocurrent_a_cm2,
            temperature_k=temperature_k,
        )

    internal = voltage.copy()
    thermal_voltage = KB_EV_PER_K * float(temperature_k)
    for _ in range(80):
        exp1 = np.exp(np.clip(internal / thermal_voltage, -100.0, 100.0))
        exp2 = np.exp(np.clip(internal / (2.0 * thermal_voltage), -100.0, 100.0))
        residual = branch(internal) - (voltage - internal) / rs
        derivative = (
            float(j01_a_cm2) * exp1 / thermal_voltage
            + float(j02_a_cm2) * exp2 / (2.0 * thermal_voltage)
            + 1.0 / float(rsh_ohm_cm2)
            + 1.0 / rs
        )
        step = np.clip(residual / np.maximum(derivative, 1e-300), -0.5, 0.5)
        next_internal = internal - step
        internal = np.where(np.isfinite(next_internal), next_internal, internal)
        if np.all(np.abs(step) <= 1e-12 * (1.0 + np.abs(internal))):
            break
    final_residual = branch(internal) - (voltage - internal) / rs
    failed = ~np.isfinite(final_residual) | (np.abs(final_residual) > 1e-10 * (1.0 + np.abs(voltage / rs)))
    for index in np.where(failed)[0]:
        target_voltage = float(voltage[index])

        def scalar_residual(u: float) -> float:
            return float(branch(np.array([u]))[0] - (target_voltage - u) / rs)

        width = max(1.0, abs(target_voltage), abs(float(photocurrent_a_cm2) * rs))
        for _ in range(80):
            lo, hi = -width, width
            flo, fhi = scalar_residual(lo), scalar_residual(hi)
            if np.isfinite(flo) and np.isfinite(fhi) and flo <= 0.0 <= fhi:
                internal[index] = brentq(scalar_residual, lo, hi, xtol=1e-13, rtol=1e-13)
                break
            width *= 2.0
        else:
            raise RuntimeError(f"Could not bracket joint PV root at V={target_voltage:.6g} V.")
    return (voltage - internal) / rs


def _pv_condition_metrics(voltage: np.ndarray, current: np.ndarray) -> dict[str, float | None]:
    order = np.argsort(voltage)
    v = _vector(voltage)[order]
    j = _vector(current)[order]
    jsc = float(np.interp(0.0, v, j)) if v[0] <= 0.0 <= v[-1] else None
    zero_crossings = np.where(np.signbit(j[:-1]) != np.signbit(j[1:]))[0]
    voc = None
    if zero_crossings.size:
        index = int(zero_crossings[np.argmin(np.abs(v[zero_crossings]))])
        j0, j1 = float(j[index]), float(j[index + 1])
        if j1 != j0:
            voc = float(v[index] - j0 * (v[index + 1] - v[index]) / (j1 - j0))
    output_power = -v * j
    positive = v >= 0.0
    mpp = float(np.max(output_power[positive])) if np.any(positive) else None
    return {"jsc_a_cm2": jsc, "voc_v": voc, "mpp_w_cm2": mpp}


def fit_joint_dark_light_pv(
    records: Iterable[PVJVRecord],
    *,
    held_out_records: Iterable[PVJVRecord] = (),
    random_seed: int = 12345,
    multistart_points: int = 6,
) -> dict[str, Any]:
    """Jointly fit paired dark/light PV curves with shared physical parameters.

    The fixed n=1/n=2 model and shared-parameter strategy are established prior
    art. A held-out illumination condition is required before the result is
    labelled predictive.
    """

    train = tuple(records)
    held_out = tuple(held_out_records)
    if not train:
        raise ValueError("At least one PVJVRecord is required.")
    if not any(item.condition == "dark" for item in train) or not any(item.condition == "light" for item in train):
        raise ValueError("Joint PV fitting requires at least one paired dark and one light record.")
    device_ids = {item.device_id for item in (*train, *held_out) if item.device_id}
    temperatures = {round(float(item.temperature_k), 9) for item in (*train, *held_out)}
    if len(device_ids) > 1:
        raise ValueError("Joint PV records must come from the same declared device.")
    if len(temperatures) != 1:
        raise ValueError("This joint PV implementation requires a common temperature.")
    temperature = float(train[0].temperature_k)
    light_records = [item for item in train if item.condition == "light"]
    labels = [item.illumination_label or f"light_{index + 1}" for index, item in enumerate(light_records)]
    if len(set(labels)) != len(labels):
        raise ValueError("Each fitted light record needs a unique illumination_label.")
    light_index = {id(item): index for index, item in enumerate(light_records)}

    jph_start = []
    for record in light_records:
        near_zero = np.argsort(np.abs(record.voltage_v))[: max(1, min(5, record.voltage_v.size))]
        jph_start.append(max(1e-8, float(abs(np.median(record.current_density_a_cm2[near_zero])))))
    start = np.log(
        np.array([1e-12, 1e-8, 1.0, 1e6, *jph_start], dtype=float)
    )
    lower = np.log(np.array([1e-20, 1e-20, 1e-6, 1e2, *([1e-10] * len(light_records))]))
    upper = np.log(np.array([1e-2, 1e-2, 1e6, 1e12, *([10.0] * len(light_records))]))

    def unpack(x: np.ndarray) -> tuple[float, float, float, float, np.ndarray]:
        values = np.exp(_vector(x))
        return float(values[0]), float(values[1]), float(values[2]), float(values[3]), values[4:]

    def residual(x: np.ndarray) -> np.ndarray:
        j01, j02, rs, rsh, jph_values = unpack(x)
        pieces: list[np.ndarray] = []
        for record in train:
            jph = 0.0 if record.condition == "dark" else float(jph_values[light_index[id(record)]])
            predicted = joint_pv_double_diode_current(
                record.voltage_v,
                j01_a_cm2=j01,
                j02_a_cm2=j02,
                rs_ohm_cm2=rs,
                rsh_ohm_cm2=rsh,
                photocurrent_a_cm2=jph,
                temperature_k=temperature,
            )
            scale = max(float(np.percentile(np.abs(record.current_density_a_cm2), 75)), 1e-12)
            piece = np.arcsinh(predicted / scale) - np.arcsinh(record.current_density_a_cm2 / scale)
            pieces.append(piece / np.sqrt(piece.size))
        return np.concatenate(pieces)

    rng = np.random.default_rng(random_seed)
    starts = [start]
    for _ in range(max(0, int(multistart_points) - 1)):
        starts.append(lower + rng.random(lower.size) * (upper - lower))
    best = None
    for candidate_start in starts:
        try:
            candidate = least_squares(
                residual,
                candidate_start,
                bounds=(lower, upper),
                loss="soft_l1",
                max_nfev=10000,
            )
        except (RuntimeError, ValueError, FloatingPointError):
            continue
        if best is None or float(np.sum(candidate.fun**2)) < float(np.sum(best.fun**2)):
            best = candidate
    if best is None:
        raise RuntimeError("Joint dark/light PV optimization failed for every start.")
    j01, j02, rs, rsh, jph_values = unpack(best.x)

    def evaluate_record(record: PVJVRecord, jph: float) -> dict[str, Any]:
        predicted = joint_pv_double_diode_current(
            record.voltage_v,
            j01_a_cm2=j01,
            j02_a_cm2=j02,
            rs_ohm_cm2=rs,
            rsh_ohm_cm2=rsh,
            photocurrent_a_cm2=jph,
            temperature_k=temperature,
        )
        scale = max(float(np.percentile(np.abs(record.current_density_a_cm2), 75)), 1e-12)
        signed_error = np.arcsinh(predicted / scale) - np.arcsinh(record.current_density_a_cm2 / scale)
        return {
            "condition": record.condition,
            "illumination_label": record.illumination_label,
            "point_count": int(predicted.size),
            "signed_asinh_rmse": float(np.sqrt(np.mean(signed_error**2))),
            "measured_metrics": _pv_condition_metrics(record.voltage_v, record.current_density_a_cm2),
            "predicted_metrics": _pv_condition_metrics(record.voltage_v, predicted),
            "predicted_current_density_a_cm2": predicted,
        }

    fitted_records = []
    for record in train:
        jph = 0.0 if record.condition == "dark" else float(jph_values[light_index[id(record)]])
        fitted_records.append(evaluate_record(record, jph))
    held_out_results = []
    for record in held_out:
        if record.condition == "dark":
            jph = 0.0
        else:
            near_zero = np.argsort(np.abs(record.voltage_v))[: max(1, min(5, record.voltage_v.size))]
            # A held-out light trace may supply only its independently measured
            # short-circuit photocurrent; no other shared parameter is refitted.
            jph = max(0.0, float(abs(np.median(record.current_density_a_cm2[near_zero]))))
        held_out_results.append(evaluate_record(record, jph))
    return {
        "status": "held_out_shape_evaluated_with_measured_jsc" if held_out else "fit_only_no_held_out_validation",
        "shared_parameters": {
            "j01_a_cm2": j01,
            "j02_a_cm2": j02,
            "rs_ohm_cm2": rs,
            "rsh_ohm_cm2": rsh,
            "n_diffusion": 1.0,
            "n_recombination": 2.0,
            "temperature_k": temperature,
        },
        "photocurrent_by_condition_a_cm2": {
            label: float(value) for label, value in zip(labels, jph_values, strict=True)
        },
        "fit_residual_norm": float(np.sum(best.fun**2)),
        "fitted_records": fitted_records,
        "held_out_records": held_out_results,
        "source": ["https://doi.org/10.3390/nano12121955"],
        "claim_boundary": (
            "established joint dark/light double-diode fit; a held-out light trace supplies measured Jsc only, "
            "so the test validates curve shape rather than blind photocurrent prediction"
        ),
    }


def _sclc_points(
    records: Iterable[SCLCRecord],
    evidence: SCLCProtocolEvidence,
    *,
    min_field_v_cm: float | None,
    max_field_v_cm: float | None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    voltages: list[np.ndarray] = []
    currents: list[np.ndarray] = []
    thicknesses: list[np.ndarray] = []
    record_indices: list[np.ndarray] = []
    for index, record in enumerate(records):
        current = np.abs(record.current_density_a_cm2)
        directed_voltage = float(record.bias_polarity) * record.voltage_v
        effective = (
            directed_voltage
            - float(evidence.built_in_voltage_v)
            - current * float(evidence.series_resistance_ohm_cm2)
        )
        thickness_cm = float(record.thickness_nm) * 1e-7
        field = effective / thickness_cm
        mask = np.isfinite(effective) & np.isfinite(current) & (effective > 0.0) & (current > 0.0)
        if min_field_v_cm is not None:
            mask &= field >= float(min_field_v_cm)
        if max_field_v_cm is not None:
            mask &= field <= float(max_field_v_cm)
        if np.any(mask):
            voltages.append(effective[mask])
            currents.append(current[mask])
            thicknesses.append(np.full(np.sum(mask), thickness_cm, dtype=float))
            record_indices.append(np.full(np.sum(mask), index, dtype=int))
    if not voltages:
        raise ValueError("No positive, finite points remain in the declared SCLC field window.")
    return (
        np.concatenate(voltages),
        np.concatenate(currents),
        np.concatenate(thicknesses),
        np.concatenate(record_indices),
    )


def _parsimony_score(residuals: np.ndarray, free_parameter_count: int) -> float:
    residual = _vector(residuals)
    n_points = residual.size
    rss = max(float(np.sum(residual**2)), np.finfo(float).tiny)
    return float(n_points * np.log(rss / n_points) + free_parameter_count * np.log(n_points))


def _fit_sclc_core(
    records: tuple[SCLCRecord, ...],
    evidence: SCLCProtocolEvidence,
    *,
    reference_field_v_cm: float,
    min_field_v_cm: float | None,
    max_field_v_cm: float | None,
    allow_field_dependent_mobility: bool,
) -> dict[str, Any]:
    voltage, current, thickness, record_index = _sclc_points(
        records,
        evidence,
        min_field_v_cm=min_field_v_cm,
        max_field_v_cm=max_field_v_cm,
    )
    epsilon = EPSILON_0_F_PER_CM * float(evidence.relative_permittivity)
    log_current = np.log(current)
    log_geometric = np.log((9.0 / 8.0) * epsilon * voltage**2 / thickness**3)

    def residual_mg(x: np.ndarray) -> np.ndarray:
        return log_geometric + float(x[0]) - log_current

    mg = least_squares(residual_mg, np.array([np.log(1e-6)]), bounds=([-46.0], [2.0]), loss="soft_l1")
    mg_mu = float(np.exp(mg.x[0]))
    mg_residual = residual_mg(mg.x)
    mg_score = _parsimony_score(mg_residual, 1)

    selected_name = "mott_gurney"
    selected_mu0 = mg_mu
    selected_gamma = 0.0
    selected_residual = mg_residual
    selected_score = mg_score
    murgatroyd: dict[str, Any] | None = None
    if allow_field_dependent_mobility:
        field_sqrt = np.sqrt(voltage / thickness)

        def residual_murgatroyd(x: np.ndarray) -> np.ndarray:
            return log_geometric + float(x[0]) + 0.89 * float(x[1]) * field_sqrt - log_current

        field_fit = least_squares(
            residual_murgatroyd,
            np.array([np.log(max(mg_mu, 1e-20)), 1e-3]),
            bounds=([-46.0, 0.0], [2.0, 0.1]),
            loss="soft_l1",
        )
        field_residual = residual_murgatroyd(field_fit.x)
        field_score = _parsimony_score(field_residual, 2)
        murgatroyd = {
            "mobility_zero_field_cm2_v_s": float(np.exp(field_fit.x[0])),
            "field_activation_sqrt_cm_v": float(field_fit.x[1]),
            "parsimony_score": field_score,
            "log_rmse": float(np.sqrt(np.mean(field_residual**2))),
        }
        if mg_score - field_score >= 6.0:
            selected_name = "murgatroyd"
            selected_mu0 = float(np.exp(field_fit.x[0]))
            selected_gamma = float(field_fit.x[1])
            selected_residual = field_residual
            selected_score = field_score

    mobility_reference = selected_mu0 * np.exp(selected_gamma * np.sqrt(float(reference_field_v_cm)))
    apparent_mu = current * thickness**3 / ((9.0 / 8.0) * epsilon * voltage**2)
    per_record: list[dict[str, Any]] = []
    record_reference_mobilities: list[float] = []
    for index, record in enumerate(records):
        mask = record_index == index
        if not np.any(mask):
            continue
        record_field = voltage[mask] / thickness[mask]
        zero_field_estimate = apparent_mu[mask] / np.exp(
            np.clip(0.89 * selected_gamma * np.sqrt(record_field), -100.0, 100.0)
        )
        reference_estimate = zero_field_estimate * np.exp(
            selected_gamma * np.sqrt(float(reference_field_v_cm))
        )
        median = float(np.median(reference_estimate))
        record_reference_mobilities.append(median)
        per_record.append(
            {
                "device_id": record.device_id or f"record_{index + 1}",
                "thickness_nm": float(record.thickness_nm),
                "point_count": int(np.sum(mask)),
                "mobility_at_reference_field_estimate_cm2_v_s": median,
            }
        )
    mobility_gsd = (
        float(
            np.exp(
                np.std(
                    np.log(np.clip(record_reference_mobilities, 1e-300, np.inf)),
                    ddof=1,
                )
            )
        )
        if len(record_reference_mobilities) >= 2
        else None
    )
    return {
        "selected_model": selected_name,
        "mobility_zero_field_cm2_v_s": selected_mu0,
        "field_activation_sqrt_cm_v": selected_gamma,
        "reference_field_v_cm": float(reference_field_v_cm),
        "mobility_at_reference_field_cm2_v_s": float(mobility_reference),
        "parsimony_score": float(selected_score),
        "log_rmse": float(np.sqrt(np.mean(selected_residual**2))),
        "point_count": int(current.size),
        "mott_gurney": {
            "mobility_cm2_v_s": mg_mu,
            "parsimony_score": mg_score,
            "log_rmse": float(np.sqrt(np.mean(mg_residual**2))),
        },
        "murgatroyd": murgatroyd,
        "per_record": per_record,
        "thickness_series_mobility_geometric_sd": mobility_gsd,
        "thickness_invariance_threshold_geometric_sd": SCLC_MAX_THICKNESS_MOBILITY_GSD,
    }


def _sclc_eligibility(
    records: tuple[SCLCRecord, ...],
    evidence: SCLCProtocolEvidence,
    *,
    thickness_mobility_gsd: float | None,
) -> dict[str, Any]:
    missing: list[str] = []
    carrier = evidence.carrier_type.strip().lower().replace("-", "_")
    if carrier not in {"electron", "hole", "electron_only", "hole_only"}:
        missing.append("electron_or_hole_only_carrier_type")
    if not evidence.efficient_injection:
        missing.append("efficient_injection_evidence")
    if not evidence.unipolar_device:
        missing.append("unipolar_device_evidence")
    thickness_count = len({round(float(item.thickness_nm), 9) for item in records})
    if thickness_count < 2:
        missing.append("at_least_two_thicknesses")
    elif thickness_mobility_gsd is None or thickness_mobility_gsd > SCLC_MAX_THICKNESS_MOBILITY_GSD:
        missing.append("mobility_not_thickness_invariant_within_factor_2")
    physical = not missing
    reproducibility_missing: list[str] = []
    if not evidence.hysteresis_checked:
        reproducibility_missing.append("return_sweep_hysteresis_check")
    if not evidence.stable_sweep:
        reproducibility_missing.append("repeatable_sweep")
    if evidence.repeat_device_count < 5:
        reproducibility_missing.append("at_least_five_repeat_devices_for_type_A_uncertainty")
    return {
        "fit_allowed": True,
        "physical_interpretation_allowed": physical,
        "publication_ready_protocol": bool(physical and not reproducibility_missing),
        "missing_physical_evidence": missing,
        "missing_reproducibility_evidence": reproducibility_missing,
        "thickness_condition_count": thickness_count,
        "repeat_device_count": int(evidence.repeat_device_count),
        "thickness_series_mobility_geometric_sd": thickness_mobility_gsd,
        "thickness_invariance_threshold_geometric_sd": SCLC_MAX_THICKNESS_MOBILITY_GSD,
    }


def fit_sclc_thickness_series(
    records: Iterable[SCLCRecord],
    evidence: SCLCProtocolEvidence,
    *,
    reference_field_v_cm: float = 2.5e5,
    min_field_v_cm: float | None = None,
    max_field_v_cm: float | None = None,
    allow_field_dependent_mobility: bool = True,
    monte_carlo_samples: int = 0,
    random_seed: int = 12345,
) -> dict[str, Any]:
    """Fit VAMAS-style Mott-Gurney/Murgatroyd mobility benchmarks.

    The returned mobility is an effective benchmark. Physical promotion is
    controlled by independent injection, unipolarity, thickness and sweep
    evidence rather than fit quality alone.
    """

    record_tuple = tuple(records)
    if not record_tuple:
        raise ValueError("At least one SCLCRecord is required.")
    result = _fit_sclc_core(
        record_tuple,
        evidence,
        reference_field_v_cm=reference_field_v_cm,
        min_field_v_cm=min_field_v_cm,
        max_field_v_cm=max_field_v_cm,
        allow_field_dependent_mobility=allow_field_dependent_mobility,
    )
    result["eligibility"] = _sclc_eligibility(
        record_tuple,
        evidence,
        thickness_mobility_gsd=result["thickness_series_mobility_geometric_sd"],
    )
    result["status"] = (
        "physical_benchmark"
        if result["eligibility"]["physical_interpretation_allowed"]
        else "diagnostic_only_missing_independent_evidence"
    )
    result["source"] = [
        "https://doi.org/10.1016/j.orgel.2014.02.008",
        "https://doi.org/10.1088/0022-3727/3/2/308",
    ]
    if monte_carlo_samples > 0:
        rng = np.random.default_rng(random_seed)
        samples: list[float] = []
        for _ in range(int(monte_carlo_samples)):
            epsilon_scale = max(
                1e-6,
                1.0 + rng.normal(0.0, evidence.permittivity_uncertainty_fraction),
            )
            sampled_evidence = replace(
                evidence,
                relative_permittivity=evidence.relative_permittivity * epsilon_scale,
                built_in_voltage_v=evidence.built_in_voltage_v
                + rng.normal(0.0, evidence.built_in_voltage_uncertainty_v),
            )
            sampled_records: list[SCLCRecord] = []
            for record in record_tuple:
                thickness_scale = max(
                    1e-6,
                    1.0 + rng.normal(0.0, evidence.thickness_uncertainty_fraction),
                )
                area_scale = max(
                    1e-6,
                    1.0 + rng.normal(0.0, evidence.area_uncertainty_fraction),
                )
                sampled_records.append(
                    replace(
                        record,
                        thickness_nm=record.thickness_nm * thickness_scale,
                        current_density_a_cm2=record.current_density_a_cm2 / area_scale,
                    )
                )
            try:
                sampled = _fit_sclc_core(
                    tuple(sampled_records),
                    sampled_evidence,
                    reference_field_v_cm=reference_field_v_cm,
                    min_field_v_cm=min_field_v_cm,
                    max_field_v_cm=max_field_v_cm,
                    allow_field_dependent_mobility=allow_field_dependent_mobility,
                )
            except (ValueError, RuntimeError):
                continue
            samples.append(float(sampled["mobility_at_reference_field_cm2_v_s"]))
        result["uncertainty"] = {
            "method": "measurement-input Monte Carlo",
            "requested_samples": int(monte_carlo_samples),
            "successful_samples": len(samples),
            "mobility_reference_ci95_cm2_v_s": (
                [float(np.percentile(samples, 2.5)), float(np.percentile(samples, 97.5))]
                if samples
                else None
            ),
        }
    return result


def fit_arrhenius_activation(
    temperature_k: np.ndarray,
    observable: np.ndarray,
    *,
    temperature_prefactor_power: float = 0.0,
) -> dict[str, float | int]:
    """Fit observable = C*T^p*exp(-Ea/kBT) with an auditable linearization."""

    temperature = _vector(temperature_k)
    values = _vector(observable)
    mask = np.isfinite(temperature) & np.isfinite(values) & (temperature > 0.0) & (values > 0.0)
    if np.sum(mask) < 3 or np.unique(temperature[mask]).size < 3:
        raise ValueError("Arrhenius fitting requires at least three positive values at distinct temperatures.")
    temperature = temperature[mask]
    values = values[mask]
    x = 1.0 / (KB_EV_PER_K * temperature)
    y = np.log(values / temperature ** float(temperature_prefactor_power))
    design = np.column_stack([np.ones_like(x), x])
    coefficient, *_ = np.linalg.lstsq(design, y, rcond=None)
    predicted = design @ coefficient
    residual = y - predicted
    ss_total = float(np.sum((y - np.mean(y)) ** 2))
    r_squared = 1.0 - float(np.sum(residual**2)) / max(ss_total, np.finfo(float).tiny)
    return {
        "activation_energy_ev": float(-coefficient[1]),
        "prefactor": float(np.exp(coefficient[0])),
        "temperature_prefactor_power": float(temperature_prefactor_power),
        "r_squared": float(r_squared),
        "point_count": int(temperature.size),
    }


def fit_poole_frenkel_temperature_series(
    records: Iterable[FieldTemperatureRecord],
    *,
    relative_permittivity: float | None = None,
    min_field_v_cm: float | None = None,
    max_field_v_cm: float | None = None,
) -> dict[str, Any]:
    """Jointly test ln(|J|/E) ~ c - Ea/kBT + beta*sqrt(E)/kBT.

    This is a cross-condition PF consistency test. It must not be treated as
    unique discrimination from Schottky or other field-assisted mechanisms.
    """

    record_tuple = tuple(records)
    rows: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    temperatures: list[float] = []
    thicknesses: list[float] = []
    for record in record_tuple:
        directed_voltage = float(record.reverse_polarity) * record.voltage_v
        thickness_cm = float(record.thickness_nm) * 1e-7
        field = directed_voltage / thickness_cm
        current = np.abs(record.current_density_a_cm2)
        mask = np.isfinite(field) & np.isfinite(current) & (field > 0.0) & (current > 0.0)
        if min_field_v_cm is not None:
            mask &= field >= float(min_field_v_cm)
        if max_field_v_cm is not None:
            mask &= field <= float(max_field_v_cm)
        if not np.any(mask):
            continue
        inverse_thermal = np.full(np.sum(mask), 1.0 / (KB_EV_PER_K * record.temperature_k))
        selected_field = field[mask]
        rows.append(
            np.column_stack(
                [
                    np.ones(np.sum(mask)),
                    inverse_thermal,
                    np.sqrt(selected_field) * inverse_thermal,
                ]
            )
        )
        targets.append(np.log(current[mask] / selected_field))
        temperatures.append(float(record.temperature_k))
        thicknesses.append(float(record.thickness_nm))
    if not rows or len(set(round(value, 9) for value in temperatures)) < 3:
        raise ValueError("PF temperature testing requires usable reverse-field data at three or more temperatures.")
    design = np.vstack(rows)
    target = np.concatenate(targets)
    coefficient, *_ = np.linalg.lstsq(design, target, rcond=None)
    predicted = design @ coefficient
    residual = target - predicted
    ss_total = float(np.sum((target - np.mean(target)) ** 2))
    r_squared = 1.0 - float(np.sum(residual**2)) / max(ss_total, np.finfo(float).tiny)
    beta = float(coefficient[2])
    inferred_epsilon = (
        float(ELEMENTARY_CHARGE_C / (np.pi * EPSILON_0_F_PER_CM * beta**2))
        if beta > 0.0
        else None
    )
    theoretical_beta = (
        float(np.sqrt(ELEMENTARY_CHARGE_C / (np.pi * EPSILON_0_F_PER_CM * relative_permittivity)))
        if relative_permittivity is not None and relative_permittivity > 0.0
        else None
    )
    return {
        "status": "cross_condition_consistency_test",
        "activation_energy_ev": float(-coefficient[1]),
        "field_lowering_ev_per_sqrt_v_cm": beta,
        "relative_permittivity_inferred_under_pf_assumption": inferred_epsilon,
        "relative_permittivity_independent": relative_permittivity,
        "theoretical_field_lowering_ev_per_sqrt_v_cm": theoretical_beta,
        "field_coefficient_ratio_to_theory": (
            float(beta / theoretical_beta) if theoretical_beta not in (None, 0.0) else None
        ),
        "r_squared": float(r_squared),
        "log_rmse": float(np.sqrt(np.mean(residual**2))),
        "point_count": int(target.size),
        "temperature_condition_count": len(set(round(value, 9) for value in temperatures)),
        "thickness_condition_count": len(set(round(value, 9) for value in thicknesses)),
        "source": ["https://doi.org/10.1103/PhysRev.155.657"],
        "warning": "PF-like consistency is not unique mechanism identification; compare contacts and Schottky scaling.",
    }
