"""Pydantic request and response schemas for the twin HTTP API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(StrictApiModel):
    status: Literal["ok", "degraded"]
    api_version: str
    scalar_prediction: Literal["ready", "unavailable"]
    case_count: int
    startup_seconds: float


class DesignVariableDomain(StrictApiModel):
    minimum: float
    maximum: float
    levels: list[float]
    unit: Literal["cm"] = "cm"


class DesignDomainResponse(StrictApiModel):
    pz_206: DesignVariableDomain
    cz_301_radius: DesignVariableDomain


class ScalarPredictionRequest(StrictApiModel):
    pz_206: float = Field(
        allow_inf_nan=False,
        description="PZ 206 plane coordinate in MCNP geometry units (cm).",
    )
    cz_301_radius: float = Field(
        allow_inf_nan=False,
        gt=0.0,
        description="CZ 301 cylinder radius in MCNP geometry units (cm).",
    )


class PredictionDesign(StrictApiModel):
    pz_206: float
    cz_301_radius: float
    units: dict[str, Literal["cm"]]


class ScalarKpisResponse(StrictApiModel):
    total_tbr: float
    li6_tbr: float
    li7_tbr: float
    multiplying: float


class ScalarPredictionMetadataResponse(StrictApiModel):
    source: Literal["simulation", "surrogate"]
    status: Literal["exact", "predicted"]
    domain_status: Literal["exact", "boundary", "interpolation", "extrapolation"]
    warning: str | None
    nearest_case: str
    nearest_design: PredictionDesign
    nearest_distance: float
    model_name: str
    model_metadata: dict[str, object]


class ScalarPredictionResponse(StrictApiModel):
    design: PredictionDesign
    kpis: ScalarKpisResponse
    metadata: ScalarPredictionMetadataResponse


class GeometryDesignRequest(StrictApiModel):
    pz_206: float = Field(allow_inf_nan=False, description="PZ 206 plane coordinate in cm.")
    cz_301_radius: float = Field(
        allow_inf_nan=False,
        gt=0.0,
        description="CZ 301 radius in cm.",
    )


class GeometryDesign(StrictApiModel):
    pz_206: float
    cz_301_radius: float
    units: dict[str, Literal["cm"]]


class GeometryComponentMesh(StrictApiModel):
    id: str
    group: Literal["Armor", "Breeder", "Multiplier", "Structure", "Coolant"]
    display_name: str
    positions: list[float]
    indices: list[int]
    bounds_mm: list[float]
    vertex_count: int
    triangle_count: int


class GeometryProvenance(StrictApiModel):
    source: str
    provider: str
    representation: str
    coordinate_transform: str


class GeometryDesignResponse(StrictApiModel):
    design: GeometryDesign
    units: Literal["mm"]
    provenance: GeometryProvenance
    bounds_mm: list[float]
    components: list[GeometryComponentMesh]
    component_count: int
    vertex_count: int
    triangle_count: int
    generation_ms: float
    cache_hit: bool
