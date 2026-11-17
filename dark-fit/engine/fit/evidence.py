from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class EvidenceModelCard:
    """Literature and eligibility contract for a fitted response family."""

    name: str
    role: str
    sources: tuple[str, ...]
    required_context: tuple[str, ...]
    allowed_claim: str


@dataclass(frozen=True)
class EvidenceContext:
    """Device evidence available before a source-specific model is run.

    The default context is intentionally empty. A single J-V trace must not
    silently manufacture the metadata needed for a physical interpretation.
    """

    device_family: str = "unknown"
    material_stack: tuple[str, ...] = ()
    current_is_density: bool = False
    temperature_k: float | None = None
    active_thickness_nm: float | None = None
    relative_permittivity: float | None = None
    temperature_condition_count: int = 1
    thickness_condition_count: int = 1
    source_benchmarks: bool = False

    @classmethod
    def from_mapping(cls, values: dict[str, Any] | None) -> "EvidenceContext":
        if not values:
            return cls()
        stack_value = values.get("material_stack") or values.get("device_stack") or ()
        if isinstance(stack_value, str):
            stack = tuple(item.strip() for item in stack_value.replace("/", ",").split(",") if item.strip())
        else:
            stack_items: list[str] = []
            for item in stack_value:
                if isinstance(item, dict):
                    text = str(item.get("name") or "").strip()
                else:
                    text = str(item).strip()
                if text:
                    stack_items.append(text)
            stack = tuple(stack_items)
        return cls(
            device_family=str(values.get("device_family") or "unknown"),
            material_stack=stack,
            current_is_density=_coerce_bool(values.get("current_is_density", False)),
            temperature_k=_optional_positive_float(values.get("temperature_k")),
            active_thickness_nm=_optional_positive_float(values.get("active_thickness_nm")),
            relative_permittivity=_optional_positive_float(values.get("relative_permittivity")),
            temperature_condition_count=max(1, int(values.get("temperature_condition_count") or 1)),
            thickness_condition_count=max(1, int(values.get("thickness_condition_count") or 1)),
            source_benchmarks=_coerce_bool(values.get("source_benchmarks", False)),
        )

    @property
    def normalized_stack(self) -> str:
        return " ".join(self.material_stack).lower().replace("-", "").replace("_", "")

    def supports_cqd_heterointerface(self) -> bool:
        stack = self.normalized_stack
        return bool(
            self.source_benchmarks
            and self.current_is_density
            and self.temperature_k is not None
            and self.active_thickness_nm is not None
            and "pbs" in stack
            and ("zno" in stack or "zinc oxide" in stack)
        )

    def supports_physical_field_lowering(self) -> bool:
        return bool(
            self.current_is_density
            and self.temperature_k is not None
            and self.active_thickness_nm is not None
            and self.relative_permittivity is not None
            and self.temperature_condition_count >= 3
        )


def _optional_positive_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    number = float(value)
    return number if number > 0.0 else None


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


EVIDENCE_MODEL_REGISTRY: dict[str, EvidenceModelCard] = {
    "pv_single_diode_reference": EvidenceModelCard(
        name="pv_single_diode_reference",
        role="external_equation_benchmark",
        sources=(
            "https://doi.org/10.1016/j.solener.2023.111930",
            "https://doi.org/10.1016/j.rser.2015.11.051",
            "https://doi.org/10.21105/joss.05994",
        ),
        required_context=("same_equation", "same_parameters", "same_sign_and_units"),
        allowed_claim="numerical evaluator agreement, not novel PV parameter extraction",
    ),
    "clean_double_diode": EvidenceModelCard(
        name="clean_double_diode",
        role="established_baseline",
        sources=(
            "https://doi.org/10.1016/j.rser.2015.11.051",
            "https://doi.org/10.3390/nano12121955",
        ),
        required_context=("forward_semilog_two_slope_evidence",),
        allowed_claim="fixed n=2/n=1 recombination-diffusion response candidate",
    ),
    "reverse_field_assisted": EvidenceModelCard(
        name="reverse_field_assisted",
        role="conditional_challenger",
        sources=("https://doi.org/10.1103/PhysRev.155.657",),
        required_context=(
            "current_density",
            "temperature_series",
            "active_thickness",
            "relative_permittivity",
        ),
        allowed_claim="PF-like field-lowering response; not unique mechanism identification",
    ),
    "cqd_heterointerface_s25": EvidenceModelCard(
        name="cqd_heterointerface_s25",
        role="source_benchmark",
        sources=("https://doi.org/10.1021/acs.nanolett.3c02899",),
        required_context=("PbS_CQD_ZnO_stack", "current_density", "thickness", "temperature"),
        allowed_claim="source-equation reproduction benchmark",
    ),
    "cqd_heterointerface_s20": EvidenceModelCard(
        name="cqd_heterointerface_s20",
        role="source_benchmark",
        sources=("https://doi.org/10.1021/acs.nanolett.3c02899",),
        required_context=("PbS_CQD_ZnO_stack", "current_density", "thickness", "temperature"),
        allowed_claim="source-equation reproduction benchmark",
    ),
    "single_carrier_sclc": EvidenceModelCard(
        name="single_carrier_sclc",
        role="metadata_gated_multicondition_model",
        sources=(
            "https://doi.org/10.1016/j.orgel.2014.02.008",
            "https://doi.org/10.1088/0022-3727/3/2/308",
        ),
        required_context=(
            "electron_or_hole_only_device",
            "efficient_injection",
            "thickness",
            "relative_permittivity",
            "current_density",
        ),
        allowed_claim="effective mobility benchmark at a predeclared electric field",
    ),
    "qled_thickness_transport_evidence": EvidenceModelCard(
        name="qled_thickness_transport_evidence",
        role="orthogonal_experimental_evidence_protocol",
        sources=("https://doi.org/10.1126/sciadv.ads7770",),
        required_context=(
            "matched_thickness_series",
            "single_carrier_or_injection_evidence",
            "current_density",
            "orthogonal_electrical_measurement",
        ),
        allowed_claim="thickness-linked transport evidence; no universal QLED fitting equation",
    ),
    "joint_dark_light_double_diode": EvidenceModelCard(
        name="joint_dark_light_double_diode",
        role="paired_condition_pv_model",
        sources=("https://doi.org/10.3390/nano12121955",),
        required_context=("paired_dark_light_same_device", "temperature", "current_density"),
        allowed_claim="shared-parameter dark/light PV fit with held-out-condition validation",
    ),
}


REMOVED_UNSUPPORTED_CANDIDATES = (
    "constrained_double_diode",
    "free_n2_double_diode",
    "perovskite_double_interface",
    "reverse_trap_saturation",
    "high_forward_power",
)


DEFAULT_POST_FIT_CANDIDATES = (
    "clean_double_diode",
    "reverse_field_assisted",
)


SOURCE_BENCHMARK_CANDIDATES = (
    "cqd_heterointerface_s25",
    "cqd_heterointerface_s20",
)


def eligible_post_fit_candidates(context: EvidenceContext | None = None) -> tuple[str, ...]:
    evidence = context or EvidenceContext()
    candidates = list(DEFAULT_POST_FIT_CANDIDATES)
    if evidence.supports_cqd_heterointerface():
        candidates.extend(SOURCE_BENCHMARK_CANDIDATES)
    return tuple(candidates)


def physical_promotion_allowed(name: str, context: EvidenceContext | None = None) -> bool:
    evidence = context or EvidenceContext()
    if name == "clean_double_diode":
        return True
    if name == "reverse_field_assisted":
        return evidence.supports_physical_field_lowering()
    return False


def evidence_contract_payload() -> dict[str, Any]:
    return {
        "policy": "literature_registry_plus_pre_fit_metadata_gate",
        "default_post_fit_candidates": list(DEFAULT_POST_FIT_CANDIDATES),
        "source_benchmark_candidates": list(SOURCE_BENCHMARK_CANDIDATES),
        "removed_unsupported_candidates": list(REMOVED_UNSUPPORTED_CANDIDATES),
        "model_cards": {
            name: {
                "role": card.role,
                "sources": list(card.sources),
                "required_context": list(card.required_context),
                "allowed_claim": card.allowed_claim,
            }
            for name, card in EVIDENCE_MODEL_REGISTRY.items()
        },
    }
