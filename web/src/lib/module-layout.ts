import { BLANKET_GEOMETRY_ADAPTER } from "./blanket-geometry";

export type BoundsMm = [number, number, number, number, number, number];

export interface ModuleCellInstance {
  cellId: string;
  row: number;
  column: number;
  q: number;
  r: number;
  positionMm: { x: number; y: number; z: number };
  enabled: boolean;
}

export interface ModulePitchDefinition {
  orientation: "flat-top";
  source: "unit-cell-outer-rafm";
  units: "mm";
  outerWidthMm: number;
  outerHeightMm: number;
  circumradiusMm: number;
  apothemMm: number;
  pitchXmm: number;
  pitchYmm: number;
  derivation: string;
}

export interface ModuleLayout {
  layoutId: string;
  cells: ModuleCellInstance[];
  boundsMm: BoundsMm;
  cellCount: number;
  sourceCellGeometry: {
    representation: "canonical-single-cell-bounds";
    boundsMm: BoundsMm;
  };
  pitchDefinition: ModulePitchDefinition;
}

/** Seven transverse lanes; the three former fifth-column cells are intentionally absent. */
export const MODULE_LAYOUT_V1_OCCUPANCY = [
  [1, 2, 3, 4],
  [1, 2, 3, 4],
  [1, 2, 3, 4],
  [1, 2, 3, 4],
  [1, 2, 3, 4],
  [1, 2, 3, 4],
  [1, 2, 3, 4],
] as const;

const DEFAULT_LAYOUT_ID = "module-layout-v1";

export const CANONICAL_CELL_BOUNDS_MM: BoundsMm = [
  BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[0],
  BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[0],
  BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[1],
  BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[1],
  BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[2],
  BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[2],
];

function normalizeBounds(bounds: readonly number[]): BoundsMm {
  if (bounds.length !== 6 || bounds.some((value) => !Number.isFinite(value))) {
    throw new Error("Module layout requires six finite single-cell bounds in millimetres.");
  }
  return [
    Math.min(bounds[0], bounds[1]), Math.max(bounds[0], bounds[1]),
    Math.min(bounds[2], bounds[3]), Math.max(bounds[2], bounds[3]),
    Math.min(bounds[4], bounds[5]), Math.max(bounds[4], bounds[5]),
  ];
}

export function deriveFixedHexPitch(
  sourceBoundsMm: readonly number[] = CANONICAL_CELL_BOUNDS_MM,
): ModulePitchDefinition {
  const bounds = normalizeBounds(sourceBoundsMm);
  const outerWidthMm = bounds[1] - bounds[0];
  const outerHeightMm = bounds[3] - bounds[2];
  const circumradiusMm = outerWidthMm / 2;
  const apothemMm = outerHeightMm / 2;
  if (!(outerWidthMm > 0 && outerHeightMm > 0)) throw new Error("Single-cell transverse bounds must have positive dimensions.");

  // The source CSG uses a flat-top hexagon: x is the vertex-to-vertex axis,
  // y is the side-to-side axis. Adjacent columns are 1.5R apart and adjacent
  // rows are one full hex height apart, so no free gap or pitch input exists.
  const pitchXmm = circumradiusMm * 1.5;
  const pitchYmm = outerHeightMm;
  return {
    orientation: "flat-top",
    source: "unit-cell-outer-rafm",
    units: "mm",
    outerWidthMm,
    outerHeightMm,
    circumradiusMm,
    apothemMm,
    pitchXmm,
    pitchYmm,
    derivation: "Flat-top outer RAFM hex: pitch X = 1.5 × circumradius; pitch Y = 2 × apothem.",
  };
}

function moduleBounds(cells: readonly ModuleCellInstance[], sourceBounds: BoundsMm): BoundsMm {
  const xValues = cells.map((cell) => cell.positionMm.x);
  const yValues = cells.map((cell) => cell.positionMm.y);
  return [
    Math.min(...xValues) + sourceBounds[0],
    Math.max(...xValues) + sourceBounds[1],
    Math.min(...yValues) + sourceBounds[2],
    Math.max(...yValues) + sourceBounds[3],
    sourceBounds[4],
    sourceBounds[5],
  ];
}

export function createModuleLayout(
  occupancy: readonly (readonly number[])[] = MODULE_LAYOUT_V1_OCCUPANCY,
  sourceBoundsMm: readonly number[] = CANONICAL_CELL_BOUNDS_MM,
  layoutId = DEFAULT_LAYOUT_ID,
): ModuleLayout {
  if (occupancy.length === 0 || occupancy.some((columns) => (
    columns.length === 0
      || columns.some((column) => !Number.isInteger(column) || column < 1)
      || new Set(columns).size !== columns.length
  ))) {
    throw new Error("Module layout occupancy must contain unique positive integer columns per lane.");
  }
  const bounds = normalizeBounds(sourceBoundsMm);
  const pitch = deriveFixedHexPitch(bounds);
  const rawCells: Array<ModuleCellInstance & { rawX: number; rawY: number }> = [];
  occupancy.forEach((columns, laneIndex) => {
    const q = laneIndex - (occupancy.length - 1) / 2;
    const oddColumnOffset = laneIndex % 2 === 1 ? 0.5 : 0;
    columns.forEach((column) => {
      const r = column - 1;
      rawCells.push({
        cellId: `R${String(laneIndex + 1).padStart(2, "0")}-C${String(column).padStart(2, "0")}`,
        row: laneIndex + 1,
        column,
        q,
        r,
        rawX: laneIndex * pitch.pitchXmm,
        rawY: (r + oddColumnOffset) * pitch.pitchYmm,
        positionMm: { x: 0, y: 0, z: (bounds[4] + bounds[5]) / 2 },
        enabled: true,
      });
    });
  });
  const rawMinX = Math.min(...rawCells.map((cell) => cell.rawX));
  const rawMaxX = Math.max(...rawCells.map((cell) => cell.rawX));
  const rawMinY = Math.min(...rawCells.map((cell) => cell.rawY));
  const rawMaxY = Math.max(...rawCells.map((cell) => cell.rawY));
  const centerX = (rawMinX + rawMaxX) / 2;
  const centerY = (rawMinY + rawMaxY) / 2;
  const cells = rawCells.map(({ rawX, rawY, ...cell }) => ({
    ...cell,
    positionMm: { x: rawX - centerX, y: rawY - centerY, z: cell.positionMm.z },
  }));
  return {
    layoutId,
    cells,
    boundsMm: moduleBounds(cells, bounds),
    cellCount: cells.length,
    sourceCellGeometry: { representation: "canonical-single-cell-bounds", boundsMm: bounds },
    pitchDefinition: pitch,
  };
}

export const MODULE_LAYOUT_V1 = createModuleLayout();
