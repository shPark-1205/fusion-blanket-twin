"""Parametric CSG geometry provider for the current MCNP blanket family."""

from __future__ import annotations

from math import cos, pi

import numpy as np
import pyvista as pv

from fusion_blanket_twin.config.settings import MCNP_TO_PROJECT_LENGTH_SCALE
from fusion_blanket_twin.geometry.components import (
    ComponentGeometryAssembly,
    ComponentSurfaceGeometry,
    union_bounds,
)
from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters


PERIODIC_HEX_APOTHEM_CM = 6.25
HEX_APOTHEMS_CM: dict[int, float] = {
    401: 6.0,
    402: 5.8,
    403: 5.7,
    404: 5.5,
    405: 5.4,
}

PZ_201_CM = 0.0
PZ_202_CM = 0.2
PZ_203_CM = 1.3
PZ_204_CM = 1.5
PZ_205_CM = 1.6
PZ_210_CM = 52.7
PZ_211_CM = 53.1
PZ_212_CM = 58.1
PZ_213_CM = 81.1
PZ_214_CM = 88.6
PZ_215_CM = 90.6
PZ_216_CM = 92.1

CZ_307_RADIUS_CM = 0.9
CZ_308_RADIUS_CM = 0.6

DEFAULT_PRIMITIVE_CSG_PARAMETERS = PrimitiveCSGParameters(
    pz_206=5.6,
    pz_207=5.7,
    pz_208=5.9,
    pz_209=6.0,
    cz_301_radius=4.8,
    cz_302_radius=4.7,
    cz_303_radius=4.5,
    cz_304_radius=4.4,
)


class ParametricCSGGeometryProvider:
    """Generate component-resolved display geometry from primitive CSG values.

    This is a scoped provider for the current MCNP blanket family. It preserves
    component identity and current cell topology, but it is not a general MCNP
    Boolean CSG engine.
    """

    def __init__(
        self,
        parameters: PrimitiveCSGParameters,
        radial_resolution: int = 64,
    ) -> None:
        self.parameters = parameters
        self.radial_resolution = radial_resolution

    def build(self) -> ComponentGeometryAssembly:
        params = self.parameters
        components = tuple(
            [
                self._component(
                    "Armor",
                    "Armor",
                    "Armor",
                    _hex_prism(PZ_201_CM, PZ_202_CM, PERIODIC_HEX_APOTHEM_CM),
                    "301",
                    "201 -202 periodic_hex",
                ),
                self._component(
                    "First_Wall",
                    "Structure",
                    "First Wall",
                    _hex_prism(PZ_202_CM, PZ_203_CM, PERIODIC_HEX_APOTHEM_CM),
                    "101",
                    "202 -203 periodic_hex",
                ),
                self._component(
                    "Pressure_Tube",
                    "Structure",
                    "Pressure Tube",
                    _hex_shell(
                        PZ_203_CM,
                        PZ_211_CM,
                        PERIODIC_HEX_APOTHEM_CM,
                        HEX_APOTHEMS_CM[401],
                    ),
                    "102",
                    "203 -211 outside HEX401 inside periodic_hex",
                ),
                *self._pin_components(params),
                self._component(
                    "Breeder",
                    "Breeder",
                    "Breeder",
                    _hex_with_cylinder_hole(
                        params.pz_209,
                        PZ_211_CM,
                        HEX_APOTHEMS_CM[405],
                        params.cz_301_radius,
                        self.radial_resolution,
                    ),
                    "401",
                    "209 -211 outside CZ301 inside HEX405",
                ),
                self._component(
                    "Multiplier",
                    "Multiplier",
                    "Multiplier",
                    _append_polydata(
                        (
                            _hex_with_cylinder_hole(
                                PZ_205_CM,
                                params.pz_206,
                                HEX_APOTHEMS_CM[403],
                                CZ_307_RADIUS_CM,
                                self.radial_resolution,
                            ),
                            _annular_cylinder(
                                CZ_307_RADIUS_CM,
                                params.cz_304_radius,
                                params.pz_206,
                                PZ_211_CM,
                                self.radial_resolution,
                            ),
                        )
                    ),
                    "501",
                    "(205 -206 307 -403) : (206 -211 307 -304)",
                ),
                *self._coolant_components(params),
                self._component(
                    "BSS_01",
                    "Structure",
                    "BSS 1",
                    _hex_with_cylinder_hole(
                        PZ_213_CM,
                        PZ_214_CM,
                        PERIODIC_HEX_APOTHEM_CM,
                        CZ_308_RADIUS_CM,
                        self.radial_resolution,
                    ),
                    "6011",
                    "213 -214 outside CZ308 inside periodic_hex",
                ),
                self._component(
                    "BSS_02",
                    "Structure",
                    "BSS 2",
                    _hex_prism(PZ_215_CM, PZ_216_CM, PERIODIC_HEX_APOTHEM_CM),
                    "6012",
                    "215 -216 periodic_hex",
                ),
            ]
        )
        bounds = union_bounds(tuple(component.bounds_mm for component in components))
        return ComponentGeometryAssembly(
            components=components,
            bounds_mm=bounds,
            source_metadata={
                "provider": "ParametricCSGGeometryProvider",
                "length_units": "mm",
                "primitive_units": "cm",
                "topology_scope": "current MCNP blanket family display geometry",
                "primitive_csg": params.as_dict(),
            },
        )

    def _pin_components(
        self,
        params: PrimitiveCSGParameters,
    ) -> tuple[ComponentSurfaceGeometry, ...]:
        return (
            self._component(
                "Pin_01",
                "Structure",
                "Pin 1",
                _hex_with_cylinder_hole(
                    PZ_204_CM,
                    PZ_205_CM,
                    HEX_APOTHEMS_CM[402],
                    CZ_308_RADIUS_CM,
                    self.radial_resolution,
                ),
                "1031",
                "204 -205 outside CZ308 inside HEX402",
            ),
            self._component(
                "Pin_02",
                "Structure",
                "Pin 2",
                _hex_shell(PZ_205_CM, PZ_210_CM, HEX_APOTHEMS_CM[402], HEX_APOTHEMS_CM[403]),
                "1032",
                "205 -210 outside HEX403 inside HEX402",
            ),
            self._component(
                "Pin_03",
                "Structure",
                "Pin 3",
                _hex_shell(params.pz_209, PZ_211_CM, HEX_APOTHEMS_CM[404], HEX_APOTHEMS_CM[405]),
                "1033",
                "209 -211 outside HEX405 inside HEX404",
            ),
            self._component(
                "Pin_04",
                "Structure",
                "Pin 4",
                _hex_with_cylinder_hole(
                    params.pz_208,
                    params.pz_209,
                    HEX_APOTHEMS_CM[404],
                    params.cz_302_radius,
                    self.radial_resolution,
                ),
                "1034",
                "208 -209 outside CZ302 inside HEX404",
            ),
            self._component(
                "Pin_05",
                "Structure",
                "Pin 5",
                _annular_cylinder(
                    params.cz_302_radius,
                    params.cz_301_radius,
                    params.pz_209,
                    PZ_211_CM,
                    self.radial_resolution,
                ),
                "1035",
                "209 -211 between CZ302 and CZ301",
            ),
            self._component(
                "Pin_06",
                "Structure",
                "Pin 6",
                _annular_cylinder(
                    params.cz_304_radius,
                    params.cz_303_radius,
                    params.pz_207,
                    PZ_211_CM,
                    self.radial_resolution,
                ),
                "1036",
                "207 -211 between CZ304 and CZ303",
            ),
            self._component(
                "Pin_07",
                "Structure",
                "Pin 7",
                _annular_cylinder(
                    CZ_308_RADIUS_CM,
                    CZ_307_RADIUS_CM,
                    PZ_205_CM,
                    PZ_211_CM,
                    self.radial_resolution,
                ),
                "1037",
                "205 -211 between CZ308 and CZ307",
            ),
            self._component(
                "Pin_08",
                "Structure",
                "Pin 8",
                _hex_with_cylinder_hole(
                    params.pz_206,
                    params.pz_207,
                    HEX_APOTHEMS_CM[403],
                    params.cz_304_radius,
                    self.radial_resolution,
                ),
                "1038",
                "206 -207 outside CZ304 inside HEX403",
            ),
            self._component(
                "Pin_09",
                "Structure",
                "Pin 9",
                _annular_cylinder(
                    CZ_308_RADIUS_CM,
                    params.cz_303_radius,
                    PZ_211_CM,
                    PZ_213_CM,
                    self.radial_resolution,
                ),
                "1039",
                "211 -213 between CZ308 and CZ303",
            ),
            self._component(
                "Pin_10",
                "Structure",
                "Pin 10",
                _cylinder(params.cz_302_radius, PZ_211_CM, PZ_212_CM, self.radial_resolution),
                "10310",
                "211 -212 inside CZ302 within periodic_hex",
            ),
        )

    def _coolant_components(
        self,
        params: PrimitiveCSGParameters,
    ) -> tuple[ComponentSurfaceGeometry, ...]:
        return (
            self._component(
                "Coolant_01",
                "Coolant",
                "Coolant 1",
                _hex_prism(PZ_203_CM, PZ_204_CM, HEX_APOTHEMS_CM[401]),
                "2011",
                "203 -204 inside HEX401",
            ),
            self._component(
                "Coolant_02",
                "Coolant",
                "Coolant 2",
                _hex_shell(PZ_204_CM, PZ_210_CM, HEX_APOTHEMS_CM[401], HEX_APOTHEMS_CM[402]),
                "2012",
                "204 -210 outside HEX402 inside HEX401",
            ),
            self._component(
                "Coolant_03",
                "Coolant",
                "Coolant 3",
                _hex_shell(PZ_210_CM, PZ_211_CM, HEX_APOTHEMS_CM[401], HEX_APOTHEMS_CM[404]),
                "2013",
                "210 -211 outside HEX404 inside HEX401",
            ),
            self._component(
                "Coolant_04",
                "Coolant",
                "Coolant 4",
                _hex_shell(params.pz_208, PZ_210_CM, HEX_APOTHEMS_CM[403], HEX_APOTHEMS_CM[404]),
                "2014",
                "208 -210 outside HEX404 inside HEX403",
            ),
            self._component(
                "Coolant_05",
                "Coolant",
                "Coolant 5",
                _hex_with_cylinder_hole(
                    params.pz_207,
                    params.pz_208,
                    HEX_APOTHEMS_CM[403],
                    params.cz_303_radius,
                    self.radial_resolution,
                ),
                "2015",
                "207 -208 outside CZ303 inside HEX403",
            ),
            self._component(
                "Coolant_06",
                "Coolant",
                "Coolant 6",
                _annular_cylinder(
                    params.cz_303_radius,
                    params.cz_302_radius,
                    params.pz_208,
                    PZ_212_CM,
                    self.radial_resolution,
                ),
                "2016",
                "208 -212 between CZ303 and CZ302",
            ),
            self._component(
                "Coolant_07",
                "Coolant",
                "Coolant 7",
                _cylinder(CZ_308_RADIUS_CM, PZ_204_CM, PZ_214_CM, self.radial_resolution),
                "2017",
                "204 -214 inside CZ308",
            ),
            self._component(
                "Coolant_08",
                "Coolant",
                "Coolant 8",
                _cylinder(params.cz_303_radius, PZ_212_CM, PZ_213_CM, self.radial_resolution),
                "2018",
                "212 -213 inside CZ303 within periodic_hex",
            ),
            self._component(
                "Coolant_09",
                "Coolant",
                "Coolant 9",
                _hex_prism(PZ_214_CM, PZ_215_CM, PERIODIC_HEX_APOTHEM_CM),
                "2019",
                "214 -215 periodic_hex",
            ),
        )

    def _component(
        self,
        component_id: str,
        group: str,
        display_name: str,
        mesh: pv.PolyData,
        mcnp_cell: str,
        csg_hint: str,
    ) -> ComponentSurfaceGeometry:
        return ComponentSurfaceGeometry(
            component_id=component_id,
            component_group=group,
            display_name=display_name,
            mesh=mesh,
            bounds_mm=tuple(float(value) for value in mesh.bounds),
            source_metadata={
                "provider": "ParametricCSGGeometryProvider",
                "mcnp_cell": mcnp_cell,
                "csg_hint": csg_hint,
            },
        )


def _cm_to_mm(value_cm: float) -> float:
    return value_cm * MCNP_TO_PROJECT_LENGTH_SCALE


def _hex_vertices(apothem_cm: float, z_cm: float) -> list[tuple[float, float, float]]:
    radius = _cm_to_mm(apothem_cm / cos(pi / 6.0))
    z = _cm_to_mm(z_cm)
    angles = np.linspace(0.0, 2.0 * pi, 6, endpoint=False)
    return [(radius * np.cos(angle), radius * np.sin(angle), z) for angle in angles]


def _hex_prism(z_min_cm: float, z_max_cm: float, apothem_cm: float) -> pv.PolyData:
    bottom = _hex_vertices(apothem_cm, z_min_cm)
    top = _hex_vertices(apothem_cm, z_max_cm)
    points = np.asarray(bottom + top, dtype=float)
    faces: list[int] = [6, 5, 4, 3, 2, 1, 0, 6, 6, 7, 8, 9, 10, 11]
    for index in range(6):
        next_index = (index + 1) % 6
        faces.extend([4, index, next_index, next_index + 6, index + 6])
    return _clean_polydata(points, faces)


def _hex_shell(
    z_min_cm: float,
    z_max_cm: float,
    outer_apothem_cm: float,
    inner_apothem_cm: float,
) -> pv.PolyData:
    if inner_apothem_cm >= outer_apothem_cm:
        raise ValueError("inner hex apothem must be smaller than outer hex apothem")
    bottom_outer = _hex_vertices(outer_apothem_cm, z_min_cm)
    bottom_inner = _hex_vertices(inner_apothem_cm, z_min_cm)
    top_outer = _hex_vertices(outer_apothem_cm, z_max_cm)
    top_inner = _hex_vertices(inner_apothem_cm, z_max_cm)
    points = np.asarray(bottom_outer + bottom_inner + top_outer + top_inner, dtype=float)

    bo, bi, to, ti = 0, 6, 12, 18
    faces: list[int] = []
    for index in range(6):
        next_index = (index + 1) % 6
        faces.extend([4, bo + index, bo + next_index, to + next_index, to + index])
        faces.extend([4, bi + next_index, bi + index, ti + index, ti + next_index])
        faces.extend([4, to + index, to + next_index, ti + next_index, ti + index])
        faces.extend([4, bo + next_index, bo + index, bi + index, bi + next_index])
    return _clean_polydata(points, faces)


def _cylinder(
    radius_cm: float,
    z_min_cm: float,
    z_max_cm: float,
    resolution: int,
) -> pv.PolyData:
    radius = _cm_to_mm(radius_cm)
    z_min = _cm_to_mm(z_min_cm)
    z_max = _cm_to_mm(z_max_cm)
    return pv.Cylinder(
        center=(0.0, 0.0, (z_min + z_max) * 0.5),
        direction=(0.0, 0.0, 1.0),
        radius=radius,
        height=z_max - z_min,
        resolution=resolution,
        capping=True,
    ).triangulate()


def _annular_cylinder(
    inner_radius_cm: float,
    outer_radius_cm: float,
    z_min_cm: float,
    z_max_cm: float,
    resolution: int,
) -> pv.PolyData:
    inner = _cm_to_mm(min(inner_radius_cm, outer_radius_cm))
    outer = _cm_to_mm(max(inner_radius_cm, outer_radius_cm))
    if outer <= inner:
        outer = inner + 1.0e-6
    z_min = _cm_to_mm(z_min_cm)
    z_max = _cm_to_mm(z_max_cm)
    angles = np.linspace(0.0, 2.0 * pi, resolution, endpoint=False)
    points = []
    for z in (z_min, z_max):
        points.extend((outer * np.cos(a), outer * np.sin(a), z) for a in angles)
        points.extend((inner * np.cos(a), inner * np.sin(a), z) for a in angles)
    faces: list[int] = []
    bottom_outer = 0
    bottom_inner = resolution
    top_outer = resolution * 2
    top_inner = resolution * 3
    for index in range(resolution):
        next_index = (index + 1) % resolution
        faces.extend([4, bottom_outer + index, bottom_outer + next_index, top_outer + next_index, top_outer + index])
        faces.extend([4, bottom_inner + next_index, bottom_inner + index, top_inner + index, top_inner + next_index])
        faces.extend([4, top_outer + index, top_outer + next_index, top_inner + next_index, top_inner + index])
        faces.extend([4, bottom_outer + next_index, bottom_outer + index, bottom_inner + index, bottom_inner + next_index])
    return _clean_polydata(np.asarray(points, dtype=float), faces)


def _hex_with_cylinder_hole(
    z_min_cm: float,
    z_max_cm: float,
    outer_apothem_cm: float,
    inner_radius_cm: float,
    resolution: int,
) -> pv.PolyData:
    return _append_polydata(
        (
            _hex_prism(z_min_cm, z_max_cm, outer_apothem_cm),
            _cylinder(inner_radius_cm, z_min_cm, z_max_cm, resolution),
        )
    )


def _append_polydata(meshes: tuple[pv.PolyData, ...]) -> pv.PolyData:
    merged = (
        pv.MultiBlock(meshes)
        .combine()
        .extract_surface(algorithm="dataset_surface")
        .triangulate()
    )
    merged.clean(inplace=True)
    return merged


def _clean_polydata(points: np.ndarray, faces: list[int]) -> pv.PolyData:
    mesh = pv.PolyData(points, np.asarray(faces, dtype=np.int64))
    mesh.clean(inplace=True)
    return mesh
