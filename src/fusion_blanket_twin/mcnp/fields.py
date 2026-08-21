"""Canonical MCNP scientific field catalog."""

from __future__ import annotations

from dataclasses import dataclass


FLUX = "Flux"
HEATING = "Heating"


@dataclass(frozen=True)
class McnpFieldDefinition:
    key: str
    internal_name: str
    display_name: str
    category: str
    units: str
    scalar_bar_title: str
    log_scale_recommended: bool = False


CANONICAL_MCNP_FIELDS: tuple[McnpFieldDefinition, ...] = (
    McnpFieldDefinition(
        key="neutron_flux",
        internal_name="Neutron flux (n_cm^2_s)",
        display_name="Neutron Flux",
        category=FLUX,
        units="n/cm^2/s",
        scalar_bar_title="Neutron Flux (n/cm^2/s)",
        log_scale_recommended=True,
    ),
    McnpFieldDefinition(
        key="photon_flux",
        internal_name="Photon flux (n_cm^2_s)",
        display_name="Photon Flux",
        category=FLUX,
        units="n/cm^2/s",
        scalar_bar_title="Photon Flux (n/cm^2/s)",
        log_scale_recommended=True,
    ),
    McnpFieldDefinition(
        key="neutron_heating",
        internal_name="Neutron heating (W_cm3)",
        display_name="Neutron Heating",
        category=HEATING,
        units="W/cm3",
        scalar_bar_title="Neutron Heating (W/cm3)",
    ),
    McnpFieldDefinition(
        key="photon_heating",
        internal_name="Photon heating (W_cm3)",
        display_name="Photon Heating",
        category=HEATING,
        units="W/cm3",
        scalar_bar_title="Photon Heating (W/cm3)",
    ),
    McnpFieldDefinition(
        key="nuclear_heating",
        internal_name="Nuclear heating (W_cm3)",
        display_name="Total Nuclear Heating",
        category=HEATING,
        units="W/cm3",
        scalar_bar_title="Total Nuclear Heating (W/cm3)",
    ),
)

DEFAULT_MCNP_FIELD_KEY = "nuclear_heating"

MCNP_FIELDS_BY_KEY: dict[str, McnpFieldDefinition] = {
    field.key: field for field in CANONICAL_MCNP_FIELDS
}
MCNP_FIELDS_BY_INTERNAL_NAME: dict[str, McnpFieldDefinition] = {
    field.internal_name: field for field in CANONICAL_MCNP_FIELDS
}
CANONICAL_MCNP_FIELD_ARRAYS: tuple[str, ...] = tuple(
    field.internal_name for field in CANONICAL_MCNP_FIELDS
)


def field_definition_by_key(key: str) -> McnpFieldDefinition:
    try:
        return MCNP_FIELDS_BY_KEY[key]
    except KeyError as exc:
        raise ValueError(f"Unknown MCNP field key: {key}") from exc


def field_definition_by_internal_name(name: str) -> McnpFieldDefinition:
    try:
        return MCNP_FIELDS_BY_INTERNAL_NAME[name]
    except KeyError as exc:
        raise ValueError(f"Unknown canonical MCNP field array: {name}") from exc


def validate_required_mcnp_fields(cell_arrays: tuple[str, ...] | list[str]) -> None:
    available = set(cell_arrays)
    missing = [name for name in CANONICAL_MCNP_FIELD_ARRAYS if name not in available]
    if missing:
        raise ValueError(
            "Required canonical MCNP fields are missing: "
            + ", ".join(missing)
            + ". Available cell arrays: "
            + ", ".join(cell_arrays)
        )


def selectable_field_items() -> list[dict[str, str]]:
    """Return UI-safe field selector entries, excluding raw tally/RSD arrays."""
    return [
        {
            "title": f"{field.category} - {field.display_name}",
            "value": field.key,
        }
        for field in CANONICAL_MCNP_FIELDS
    ]
