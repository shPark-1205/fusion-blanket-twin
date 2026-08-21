"""Current DOE mapping from high-level controls to primitive CSG parameters."""

from __future__ import annotations

from dataclasses import dataclass

from fusion_blanket_twin.data.case_registry import CaseRegistry
from fusion_blanket_twin.geometry.csg import PrimitiveCSGParameters


@dataclass(frozen=True)
class CurrentDOEGeometryMapping:
    """Current two-axis DOE constraint layer.

    This mapping preserves the present 10 by 10 study behavior where PZ
    surfaces 206-209 shift together and CZ surfaces 301-304 change radius
    together. It is deliberately separate from PrimitiveCSGParameters and the
    parametric geometry provider, so future mappings can vary every primitive
    independently.
    """

    pz_207_offset_from_206: float
    pz_208_offset_from_206: float
    pz_209_offset_from_206: float
    cz_302_offset_from_301: float
    cz_303_offset_from_301: float
    cz_304_offset_from_301: float

    @classmethod
    def current_fixed_spacing(cls) -> "CurrentDOEGeometryMapping":
        """Return the current 10 by 10 DOE spacing constraints.

        These signed offsets belong to this mapping layer only. They must not
        be interpreted as restrictions on PrimitiveCSGParameters.
        """
        return cls(
            pz_207_offset_from_206=0.1,
            pz_208_offset_from_206=0.3,
            pz_209_offset_from_206=0.4,
            cz_302_offset_from_301=-0.1,
            cz_303_offset_from_301=-0.3,
            cz_304_offset_from_301=-0.4,
        )

    @classmethod
    def from_registry(cls, registry: CaseRegistry) -> "CurrentDOEGeometryMapping":
        report = registry.validate_current_doe_constraints()
        if not report.is_consistent:
            raise ValueError(
                "current DOE mapping requires the verified fixed-spacing dataset"
            )
        reference = registry.records[0].primitive_csg
        return cls(
            pz_207_offset_from_206=reference.pz_207 - reference.pz_206,
            pz_208_offset_from_206=reference.pz_208 - reference.pz_206,
            pz_209_offset_from_206=reference.pz_209 - reference.pz_206,
            cz_302_offset_from_301=reference.cz_302_radius - reference.cz_301_radius,
            cz_303_offset_from_301=reference.cz_303_radius - reference.cz_301_radius,
            cz_304_offset_from_301=reference.cz_304_radius - reference.cz_301_radius,
        )

    def from_current_controls(
        self,
        pz_206: float,
        cz_301_radius: float,
    ) -> PrimitiveCSGParameters:
        return PrimitiveCSGParameters(
            pz_206=pz_206,
            pz_207=pz_206 + self.pz_207_offset_from_206,
            pz_208=pz_206 + self.pz_208_offset_from_206,
            pz_209=pz_206 + self.pz_209_offset_from_206,
            cz_301_radius=cz_301_radius,
            cz_302_radius=cz_301_radius + self.cz_302_offset_from_301,
            cz_303_radius=cz_301_radius + self.cz_303_offset_from_301,
            cz_304_radius=cz_301_radius + self.cz_304_offset_from_301,
        )
