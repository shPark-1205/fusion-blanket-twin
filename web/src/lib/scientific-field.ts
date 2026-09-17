import type { SliceAxis } from "./twin-types";

export const SCIENTIFIC_FIELD_MANIFEST_URL = "/scientific/generated/reference-mcnp/manifest.json";

export const SCIENTIFIC_FIELD_IDS = [
  "neutron_flux",
  "photon_flux",
  "neutron_heating",
  "photon_heating",
  "nuclear_heating",
] as const;

export type ScientificFieldId = (typeof SCIENTIFIC_FIELD_IDS)[number];

export type ScientificFieldStatus =
  | "idle"
  | "loading-metadata"
  | "loading-geometry"
  | "loading-scalars"
  | "ready"
  | "error";

export type ScientificProbeStatus = "idle" | "loading" | "ready" | "error";
export type ScaleMode = "linear" | "log";

export interface ScientificFieldRecord {
  key: ScientificFieldId;
  source_name: string;
  display_name: string;
  quantity_type: "Flux" | "Heating";
  units: string;
  display_units: string;
  association: "cell";
  source_precision: string;
  web_precision: "Float32";
  source_range: [number, number];
  web_range: [number, number];
  finite_count: number;
  zero_count: number;
  positive_minimum: number | null;
  log_scale_supported: boolean;
  log_scale_recommended: boolean;
  values: {
    url: string;
    dtype: "float32-le";
    byte_length: number;
    scalar_count: number;
  };
  precision: {
    role: string;
    maximum_absolute_deviation: number;
    maximum_relative_deviation_nonzero: number;
    mean_absolute_deviation: number;
  };
  slice_ranges: Record<SliceAxis, Array<[number, number]>>;
  source_slice_ranges: Record<SliceAxis, Array<[number, number]>>;
  provenance: {
    kind: "MCNP Simulation";
    role: string;
  };
}

export interface AxisLayer {
  index: number;
  bounds_mm: [number, number];
  center_mm: number;
}

export interface ScientificFieldManifest {
  schema: "fusion-blanket-web-cell-fields/v2";
  dataset_id: string;
  default_field_key: ScientificFieldId;
  field_order: ScientificFieldId[];
  provenance: {
    kind: "MCNP Simulation";
    role: string;
    source_path: string;
    source_sha256: string;
    source_format: string;
    source_block: string;
    source_reference: string;
    case_id: string | null;
  };
  fields: Record<ScientificFieldId, ScientificFieldRecord>;
  mesh: {
    representation: "exact_rectilinear_voxel_cell_grid";
    point_count: number;
    cell_count: number;
    point_shape_xyz: [number, number, number];
    cell_shape_zyx: [number, number, number];
    array_order: string;
    cell_index_order: string;
    axis_boundaries_mm: { x: number[]; y: number[]; z: number[] };
    axis_metadata: Record<"x" | "y" | "z", { cell_count: number; minimum_spacing_mm: number; maximum_spacing_mm: number; uniform: boolean }>;
    bounds_cm: [number, number, number, number, number, number];
    bounds_mm: [number, number, number, number, number, number];
  };
  transform: {
    description: string;
    scale: [number, number, number];
    rotation_degrees: [number, number, number];
    translation_mm: [number, number, number];
    matrix_row_major: number[];
  };
  slicing: {
    available_axes: SliceAxis[];
    default_axis: SliceAxis;
    semantics: string;
    boundary_convention: string;
    axes: Record<SliceAxis, { position_range_mm: [number, number]; default_position_mm: number; layers: AxisLayer[] }>;
  };
  probe: {
    semantics: string;
    returns: ScientificFieldId[];
    boundary_convention: string;
  };
  consistency_checks: {
    nuclear_heating_equals_neutron_plus_photon: {
      passed: boolean;
      maximum_absolute_error: number;
      mean_absolute_error: number;
    };
  };
}

export interface ScientificFieldData {
  manifest: ScientificFieldManifest;
  valuesByField: Partial<Record<ScientificFieldId, Float32Array>>;
}

export interface ScientificVoxelProbe {
  sliceId: string;
  sliceAxis: SliceAxis;
  sliceLabel: string;
  indices: { i: number; j: number; k: number };
  boundsMm: { x: [number, number]; y: [number, number]; z: [number, number] };
  centerMm: [number, number, number];
  moduleCell?: {
    cellId: string;
    row: number;
    column: number;
    q: number;
    r: number;
  };
  moduleCenterMm?: [number, number, number];
  values: Record<ScientificFieldId, number>;
  nuclearHeatingConsistency: {
    neutronPlusPhoton: number;
    difference: number;
  };
}

export interface ScientificLoadMetrics {
  metadataMs: number | null;
  geometryValidationMs: number | null;
  scalarDownloadMs: number | null;
  scalarParseMs: number | null;
  totalMs: number | null;
  firstRenderMs: number | null;
  sliceUpdateMs: number | null;
  fieldSwitchMs: number | null;
  probeMs: number | null;
  renderedSliceCount?: number;
  renderedVertexCount?: number;
  renderedPatchCount?: number;
}

const loadedFields = new Map<ScientificFieldId, Promise<{ values: Float32Array; metrics: { downloadMs: number; parseMs: number } }>>();

export async function loadScientificManifest(
  onStatus: (status: ScientificFieldStatus) => void,
): Promise<{ manifest: ScientificFieldManifest; metrics: ScientificLoadMetrics }> {
  const totalStarted = performance.now();
  onStatus("loading-metadata");
  const metadataStarted = performance.now();
  const response = await fetch(SCIENTIFIC_FIELD_MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Scientific metadata request failed (${response.status}).`);
  const manifest = (await response.json()) as ScientificFieldManifest;
  const metadataMs = performance.now() - metadataStarted;

  onStatus("loading-geometry");
  const geometryStarted = performance.now();
  validateManifest(manifest);
  const geometryValidationMs = performance.now() - geometryStarted;
  return {
    manifest,
    metrics: {
      metadataMs,
      geometryValidationMs,
      scalarDownloadMs: null,
      scalarParseMs: null,
      totalMs: performance.now() - totalStarted,
      firstRenderMs: null,
      sliceUpdateMs: null,
      fieldSwitchMs: null,
      probeMs: null,
    },
  };
}

export async function loadScientificFieldValues(
  manifest: ScientificFieldManifest,
  fieldId: ScientificFieldId,
  onStatus?: (status: ScientificFieldStatus) => void,
): Promise<{ values: Float32Array; metrics: { downloadMs: number; parseMs: number }; cached: boolean }> {
  const cached = loadedFields.get(fieldId);
  if (cached) return { ...(await cached), cached: true };
  onStatus?.("loading-scalars");
  const loading = fetchFieldValues(manifest, fieldId);
  loadedFields.set(fieldId, loading);
  try {
    return { ...(await loading), cached: false };
  } catch (error) {
    loadedFields.delete(fieldId);
    throw error;
  }
}

export async function loadAllScientificFieldValues(
  manifest: ScientificFieldManifest,
  existing: Partial<Record<ScientificFieldId, Float32Array>>,
  onStatus?: (status: ScientificFieldStatus) => void,
) {
  const started = performance.now();
  const valuesByField: Partial<Record<ScientificFieldId, Float32Array>> = { ...existing };
  let downloadMs = 0;
  let parseMs = 0;
  for (const fieldId of manifest.field_order) {
    if (valuesByField[fieldId]) continue;
    const result = await loadScientificFieldValues(manifest, fieldId, onStatus);
    valuesByField[fieldId] = result.values;
    downloadMs += result.cached ? 0 : result.metrics.downloadMs;
    parseMs += result.cached ? 0 : result.metrics.parseMs;
  }
  return { valuesByField, metrics: { downloadMs, parseMs, totalMs: performance.now() - started } };
}

async function fetchFieldValues(manifest: ScientificFieldManifest, fieldId: ScientificFieldId) {
  const field = manifest.fields[fieldId];
  if (!field) throw new Error(`Scientific field '${fieldId}' is not declared in the manifest.`);
  const scalarStarted = performance.now();
  const valuesUrl = new URL(field.values.url, new URL(SCIENTIFIC_FIELD_MANIFEST_URL, window.location.href));
  const valuesResponse = await fetch(valuesUrl, { cache: "no-store" });
  if (!valuesResponse.ok) {
    throw new Error(`${field.display_name} scalar request failed (${valuesResponse.status}).`);
  }
  const buffer = await valuesResponse.arrayBuffer();
  const downloadMs = performance.now() - scalarStarted;
  const parseStarted = performance.now();
  if (buffer.byteLength !== field.values.byte_length) {
    throw new Error(
      `${field.display_name} byte length ${buffer.byteLength} does not match metadata ${field.values.byte_length}.`,
    );
  }
  const values = float32LittleEndian(buffer);
  if (values.length !== field.values.scalar_count) {
    throw new Error(`${field.display_name} scalar count ${values.length} does not match metadata ${field.values.scalar_count}.`);
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) throw new Error(`${field.display_name} scalar ${index} is not finite.`);
  }
  return { values, metrics: { downloadMs, parseMs: performance.now() - parseStarted } };
}

function validateManifest(manifest: ScientificFieldManifest) {
  if (manifest.schema !== "fusion-blanket-web-cell-fields/v2") throw new Error("Unsupported scientific metadata schema.");
  if (manifest.mesh.representation !== "exact_rectilinear_voxel_cell_grid") {
    throw new Error("Expected an exact rectilinear voxel cell grid.");
  }
  const { x, y, z } = manifest.mesh.axis_boundaries_mm;
  const [nz, ny, nx] = manifest.mesh.cell_shape_zyx;
  if (x.length !== nx + 1 || y.length !== ny + 1 || z.length !== nz + 1) {
    throw new Error("Scientific axis boundaries do not match the cell shape.");
  }
  if (nx * ny * nz !== manifest.mesh.cell_count) {
    throw new Error("Scientific cell counts are inconsistent.");
  }
  for (const fieldId of SCIENTIFIC_FIELD_IDS) {
    const field = manifest.fields[fieldId];
    if (!field) throw new Error(`Scientific field '${fieldId}' is missing.`);
    if (field.key !== fieldId || field.association !== "cell") throw new Error(`Invalid field metadata for ${fieldId}.`);
    if (field.values.dtype !== "float32-le") throw new Error(`Expected little-endian Float32 values for ${field.display_name}.`);
    if (field.values.scalar_count !== manifest.mesh.cell_count) throw new Error(`${field.display_name} scalar count is inconsistent.`);
    for (const axis of ["X", "Y", "Z"] as SliceAxis[]) {
      if (field.slice_ranges[axis].length !== cellCountForAxis(manifest, axis)) {
        throw new Error(`${field.display_name} ${axis} slice metadata is incomplete.`);
      }
      if (field.source_slice_ranges[axis].length !== cellCountForAxis(manifest, axis)) {
        throw new Error(`${field.display_name} source ${axis} slice metadata is incomplete.`);
      }
    }
  }
  for (const axis of [x, y, z]) {
    if (!axis.every((value, index) => Number.isFinite(value) && (index === 0 || value > axis[index - 1]))) {
      throw new Error("Scientific axis boundaries must be finite and strictly increasing.");
    }
  }
}

function float32LittleEndian(buffer: ArrayBuffer) {
  const endianProbe = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0];
  if (endianProbe === 0x04) return new Float32Array(buffer);
  const view = new DataView(buffer);
  const values = new Float32Array(buffer.byteLength / 4);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getFloat32(index * 4, true);
  return values;
}

export function axisKey(axis: SliceAxis): "x" | "y" | "z" {
  return axis.toLowerCase() as "x" | "y" | "z";
}

export function axisBoundaries(manifest: ScientificFieldManifest, axis: SliceAxis) {
  return manifest.mesh.axis_boundaries_mm[axisKey(axis)];
}

export function cellIndex(boundaries: number[], positionMm: number) {
  if (positionMm <= boundaries[0]) return 0;
  if (positionMm >= boundaries.at(-1)!) return boundaries.length - 2;
  let low = 0;
  let high = boundaries.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle] <= positionMm) low = middle;
    else high = middle;
  }
  return low;
}

export function containingCellIndex(boundaries: number[], positionMm: number) {
  if (positionMm < boundaries[0] || positionMm > boundaries.at(-1)!) return null;
  if (positionMm === boundaries.at(-1)!) return boundaries.length - 2;
  let low = 0;
  let high = boundaries.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle] <= positionMm) low = middle;
    else high = middle;
  }
  return low;
}

export function selectedLayer(manifest: ScientificFieldManifest, axis: SliceAxis, positionMm: number): AxisLayer {
  const index = cellIndex(axisBoundaries(manifest, axis), positionMm);
  return manifest.slicing.axes[axis].layers[index];
}

export function cellCountForAxis(manifest: ScientificFieldManifest, axis: SliceAxis) {
  const [nz, ny, nx] = manifest.mesh.cell_shape_zyx;
  if (axis === "X") return nx;
  if (axis === "Y") return ny;
  return nz;
}

export function linearCellIndex(manifest: ScientificFieldManifest, indices: { i: number; j: number; k: number }) {
  const [, ny, nx] = manifest.mesh.cell_shape_zyx;
  return indices.k * ny * nx + indices.j * nx + indices.i;
}

export function voxelFromPoint(
  manifest: ScientificFieldManifest,
  axis: SliceAxis,
  selectedPositionMm: number,
  pointMm: [number, number, number],
) {
  const selected = selectedLayer(manifest, axis, selectedPositionMm);
  const i = axis === "X" ? selected.index : containingCellIndex(axisBoundaries(manifest, "X"), pointMm[0]);
  const j = axis === "Y" ? selected.index : containingCellIndex(axisBoundaries(manifest, "Y"), pointMm[1]);
  const k = axis === "Z" ? selected.index : containingCellIndex(axisBoundaries(manifest, "Z"), pointMm[2]);
  if (i === null || j === null || k === null) return null;
  const [nz, ny, nx] = manifest.mesh.cell_shape_zyx;
  if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) return null;
  return { i, j, k };
}

export function buildVoxelProbe(
  manifest: ScientificFieldManifest,
  valuesByField: Partial<Record<ScientificFieldId, Float32Array>>,
  indices: { i: number; j: number; k: number },
  sliceId = "slice-1",
  sliceAxis: SliceAxis = "Z",
  sliceLabel = sliceId,
  moduleContext?: {
    cellId: string;
    row: number;
    column: number;
    q: number;
    r: number;
    translationMm: [number, number, number];
  },
): ScientificVoxelProbe {
  const x = manifest.mesh.axis_boundaries_mm.x;
  const y = manifest.mesh.axis_boundaries_mm.y;
  const z = manifest.mesh.axis_boundaries_mm.z;
  const linear = linearCellIndex(manifest, indices);
  const values = Object.fromEntries(manifest.field_order.map((fieldId) => {
    const fieldValues = valuesByField[fieldId];
    if (!fieldValues) throw new Error(`${manifest.fields[fieldId].display_name} is not loaded for raw voxel probing.`);
    return [fieldId, fieldValues[linear]];
  })) as Record<ScientificFieldId, number>;
  const neutronPlusPhoton = values.neutron_heating + values.photon_heating;
  const centerMm: [number, number, number] = [
    (x[indices.i] + x[indices.i + 1]) / 2,
    (y[indices.j] + y[indices.j + 1]) / 2,
    (z[indices.k] + z[indices.k + 1]) / 2,
  ];
  return {
    sliceId,
    sliceAxis,
    sliceLabel,
    indices,
    boundsMm: {
      x: [x[indices.i], x[indices.i + 1]],
      y: [y[indices.j], y[indices.j + 1]],
      z: [z[indices.k], z[indices.k + 1]],
    },
    centerMm,
    ...(moduleContext ? {
      moduleCell: {
        cellId: moduleContext.cellId,
        row: moduleContext.row,
        column: moduleContext.column,
        q: moduleContext.q,
        r: moduleContext.r,
      },
      moduleCenterMm: [
        centerMm[0] + moduleContext.translationMm[0],
        centerMm[1] + moduleContext.translationMm[1],
        centerMm[2] + moduleContext.translationMm[2],
      ] as [number, number, number],
    } : {}),
    values,
    nuclearHeatingConsistency: {
      neutronPlusPhoton,
      difference: values.nuclear_heating - neutronPlusPhoton,
    },
  };
}

export function scalarDomain(field: ScientificFieldRecord, scale: ScaleMode): [number, number] {
  if (scale === "log" && field.positive_minimum !== null && field.web_range[1] > field.positive_minimum) {
    return [Math.log10(field.positive_minimum), Math.log10(field.web_range[1])];
  }
  return field.web_range;
}

export function colorScalarValue(value: number, field: ScientificFieldRecord, scale: ScaleMode): [number, number, number] {
  if (value <= 0) return ZERO_CELL_COLOR;
  if (scale === "log") {
    if (!field.log_scale_supported || field.positive_minimum === null) return ZERO_CELL_COLOR;
    const domain = scalarDomain(field, "log");
    return sequentialColor(normalize(Math.log10(value), domain));
  }
  return sequentialColor(normalize(value, field.web_range));
}

export const SCIENTIFIC_COLOR_GRADIENT =
  "linear-gradient(to top, rgb(68 1 84), rgb(65 68 135), rgb(42 120 142), rgb(34 168 132), rgb(122 209 81), rgb(253 231 37))";

const ZERO_CELL_COLOR: [number, number, number] = [38 / 255, 50 / 255, 58 / 255];

const COLOR_STOPS = [
  [0, 68, 1, 84],
  [0.2, 65, 68, 135],
  [0.4, 42, 120, 142],
  [0.6, 34, 168, 132],
  [0.8, 122, 209, 81],
  [1, 253, 231, 37],
] as const;

function normalize(value: number, range: [number, number]) {
  return range[1] === range[0] ? 0 : Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
}

function sequentialColor(normalized: number): [number, number, number] {
  let upper = 1;
  while (upper < COLOR_STOPS.length && normalized > COLOR_STOPS[upper][0]) upper += 1;
  const right = COLOR_STOPS[Math.min(upper, COLOR_STOPS.length - 1)];
  const left = COLOR_STOPS[Math.max(0, upper - 1)];
  const fraction = right[0] === left[0] ? 0 : (normalized - left[0]) / (right[0] - left[0]);
  return [1, 2, 3].map((component) => (left[component] + (right[component] - left[component]) * fraction) / 255) as [number, number, number];
}
