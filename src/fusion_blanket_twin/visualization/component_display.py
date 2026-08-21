"""Display configuration and actor management for component geometry."""

from __future__ import annotations

from dataclasses import dataclass, field

import pyvista as pv

from fusion_blanket_twin.geometry.components import (
    COMPONENT_GROUPS,
    ComponentGeometryAssembly,
    union_bounds,
)


DEFAULT_COMPONENT_GROUP_COLORS: dict[str, str] = {
    "Armor": "#7E57C2",
    "Breeder": "#F28E2B",
    "Multiplier": "#59A14F",
    "Structure": "#8A8A8A",
    "Coolant": "#4E79A7",
}


@dataclass
class ComponentDisplayConfig:
    group_colors: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_COMPONENT_GROUP_COLORS))
    group_visibility: dict[str, bool] = field(default_factory=lambda: {group: True for group in COMPONENT_GROUPS})
    opacity: float = 0.56

    def color_for_group(self, group: str) -> str:
        return self.group_colors.get(group, "#A0A0A0")

    def is_group_visible(self, group: str) -> bool:
        return self.group_visibility.get(group, True)


@dataclass
class ClippingConfig:
    enabled: bool = False
    axis: str = "Z"
    position_mm: float = 0.0
    invert: bool = False


class ComponentGeometryView:
    """Manage PyVista actors for component-resolved parametric geometry."""

    def __init__(
        self,
        plotter: pv.Plotter,
        assembly: ComponentGeometryAssembly,
        config: ComponentDisplayConfig | None = None,
    ) -> None:
        self.plotter = plotter
        self.assembly = assembly
        self.config = config or ComponentDisplayConfig()
        self.clipping = ClippingConfig()
        self._actor_names: dict[str, str] = {}
        self._add_assembly()

    @property
    def bounds_mm(self) -> tuple[float, float, float, float, float, float]:
        visible_bounds = [
            component.bounds_mm
            for component in self.assembly.components
            if self.config.is_group_visible(component.component_group)
        ]
        if not visible_bounds:
            return self.assembly.bounds_mm
        return union_bounds(tuple(visible_bounds))

    def update_geometry(self, assembly: ComponentGeometryAssembly) -> None:
        self._remove_actors()
        self.assembly = assembly
        self._add_assembly()

    def set_group_color(self, group: str, color: str) -> None:
        self.config.group_colors[group] = color
        for component in self.assembly.components:
            if component.component_group != group:
                continue
            actor = self._actor_for_component(component.component_id)
            if actor is not None:
                actor.GetProperty().SetColor(_hex_to_rgb(color))

    def set_group_visibility(self, group: str, visible: bool) -> None:
        self.config.group_visibility[group] = visible
        for component in self.assembly.components:
            if component.component_group != group:
                continue
            actor = self._actor_for_component(component.component_id)
            if actor is not None:
                actor.SetVisibility(bool(visible))

    def set_opacity(self, opacity: float) -> None:
        self.config.opacity = float(opacity)
        for actor_name in self._actor_names.values():
            actor = self.plotter.renderer.actors.get(actor_name)
            if actor is not None:
                actor.GetProperty().SetOpacity(self.config.opacity)

    def set_clipping(self, clipping: ClippingConfig) -> None:
        self.clipping = clipping
        self._apply_clipping_to_all_actors()

    def reset_clipping(self) -> None:
        self.set_clipping(ClippingConfig(enabled=False, axis=self.clipping.axis, position_mm=0.0))

    def _add_assembly(self) -> None:
        for component in self.assembly.components:
            actor_name = _actor_name(component.component_id)
            self._actor_names[component.component_id] = actor_name
            actor = self.plotter.add_mesh(
                component.mesh,
                color=self.config.color_for_group(component.component_group),
                opacity=self.config.opacity,
                name=actor_name,
                smooth_shading=True,
            )
            actor.SetVisibility(self.config.is_group_visible(component.component_group))
        self._apply_clipping_to_all_actors()

    def _remove_actors(self) -> None:
        for actor_name in tuple(self._actor_names.values()):
            self.plotter.remove_actor(actor_name)
        self._actor_names.clear()

    def _actor_for_component(self, component_id: str):
        actor_name = self._actor_names.get(component_id)
        if actor_name is None:
            return None
        return self.plotter.renderer.actors.get(actor_name)

    def _apply_clipping_to_all_actors(self) -> None:
        for actor_name in self._actor_names.values():
            actor = self.plotter.renderer.actors.get(actor_name)
            if actor is not None:
                _apply_clipping(actor, self.clipping)


def _actor_name(component_id: str) -> str:
    return f"parametric_csg_{component_id}"


def _hex_to_rgb(color: str) -> tuple[float, float, float]:
    clean = color.strip().lstrip("#")
    if len(clean) != 6:
        return 0.65, 0.65, 0.65
    return (
        int(clean[0:2], 16) / 255.0,
        int(clean[2:4], 16) / 255.0,
        int(clean[4:6], 16) / 255.0,
    )


def _apply_clipping(actor, clipping: ClippingConfig) -> None:
    mapper = actor.GetMapper()
    mapper.RemoveAllClippingPlanes()
    if not clipping.enabled:
        return

    import vtk

    normal = {
        "X": (1.0, 0.0, 0.0),
        "Y": (0.0, 1.0, 0.0),
        "Z": (0.0, 0.0, 1.0),
    }.get(clipping.axis.upper(), (0.0, 0.0, 1.0))
    if clipping.invert:
        normal = tuple(-value for value in normal)
    origin = {
        "X": (clipping.position_mm, 0.0, 0.0),
        "Y": (0.0, clipping.position_mm, 0.0),
        "Z": (0.0, 0.0, clipping.position_mm),
    }.get(clipping.axis.upper(), (0.0, 0.0, clipping.position_mm))
    plane = vtk.vtkPlane()
    plane.SetNormal(*normal)
    plane.SetOrigin(*origin)
    mapper.AddClippingPlane(plane)
