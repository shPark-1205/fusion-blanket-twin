import { BLANKET_GEOMETRY_ADAPTER } from "./blanket-geometry";
import { MODULE_LAYOUT_V1 } from "./module-layout";
import type { ViewScale } from "./twin-types";

export type PresentationBoundsMm = [number, number, number, number, number, number];

function fallbackBoundsMm(): PresentationBoundsMm {
  return [
    BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[0], BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[0],
    BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[1], BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[1],
    BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[2], BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[2],
  ];
}

function displayBoundsMm(bounds: readonly number[] | null): PresentationBoundsMm {
  const fallback = fallbackBoundsMm();
  if (bounds?.length !== 6) return fallback;
  return [
    Number.isFinite(bounds[0]) ? bounds[0] : fallback[0],
    Number.isFinite(bounds[1]) ? bounds[1] : fallback[1],
    Number.isFinite(bounds[2]) ? bounds[2] : fallback[2],
    Number.isFinite(bounds[3]) ? bounds[3] : fallback[3],
    Number.isFinite(bounds[4]) ? bounds[4] : fallback[4],
    Number.isFinite(bounds[5]) ? bounds[5] : fallback[5],
  ];
}

export function presentationEmitterDefinition(viewScale: ViewScale, geometryBoundsMm: readonly number[] | null) {
  const boundsMm = viewScale === "module" ? MODULE_LAYOUT_V1.boundsMm : displayBoundsMm(geometryBoundsMm);
  const [x0, x1, y0, y1, z0] = boundsMm;
  const footprintMinimum = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const depthMm = Math.max(28, Math.min(80, footprintMinimum * 0.28));
  return {
    boundsMm,
    sourceCenterMm: [(x0 + x1) / 2, (y0 + y1) / 2, z0 - 145] as [number, number, number],
    startZ: z0 - 145,
    endZ: z0 + 42,
    depthMm,
  };
}
