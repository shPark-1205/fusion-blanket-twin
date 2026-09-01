export const SCIENTIFIC_FIELD_MANIFEST_URL =
  "/scientific/generated/reference-mcnp/nuclear-heating/manifest.json";

export type ScientificFieldStatus =
  | "idle"
  | "loading-metadata"
  | "loading-geometry"
  | "loading-scalars"
  | "ready"
  | "error";

export interface ScientificFieldManifest {
  schema: "fusion-blanket-web-cell-field/v1";
  dataset_id: string;
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
  field: {
    key: "nuclear_heating";
    source_name: string;
    display_name: "Total Nuclear Heating";
    units: "W/cm3";
    display_units: "W/cm³";
    association: "cell";
    source_precision: string;
    source_range: [number, number];
    web_range: [number, number];
  };
  mesh: {
    representation: "exact_rectilinear_voxel_cell_grid";
    point_count: number;
    cell_count: number;
    point_shape_xyz: [number, number, number];
    cell_shape_zyx: [number, number, number];
    array_order: string;
    axis_boundaries_mm: { x: number[]; y: number[]; z: number[] };
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
  values: {
    url: string;
    dtype: "float32-le";
    exported_precision: "Float32";
    precision_role: string;
    byte_length: number;
    scalar_count: number;
    maximum_absolute_deviation: number;
    maximum_relative_deviation_nonzero: number;
    mean_absolute_deviation: number;
  };
  slicing: {
    axis: "Z";
    position_range_mm: [number, number];
    default_position_mm: number;
    semantics: string;
    layer_ranges: Array<[number, number]>;
    layers: Array<{
      index: number;
      bounds_mm: [number, number];
      center_mm: number;
      range: [number, number];
      source_range: [number, number];
      web_range: [number, number];
      maximum_absolute_deviation: number;
      maximum_relative_deviation_nonzero: number;
    }>;
  };
}

export interface ScientificFieldData {
  manifest: ScientificFieldManifest;
  values: Float32Array;
}

export interface ScientificLoadMetrics {
  metadataMs: number | null;
  geometryValidationMs: number | null;
  scalarDownloadMs: number | null;
  scalarParseMs: number | null;
  totalMs: number | null;
  firstRenderMs: number | null;
  sliceUpdateMs: number | null;
}

export async function loadScientificField(
  onStatus: (status: ScientificFieldStatus) => void,
): Promise<{ data: ScientificFieldData; metrics: ScientificLoadMetrics }> {
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

  onStatus("loading-scalars");
  const scalarStarted = performance.now();
  const valuesUrl = new URL(manifest.values.url, response.url);
  const valuesResponse = await fetch(valuesUrl, { cache: "no-store" });
  if (!valuesResponse.ok) throw new Error(`Scientific scalar request failed (${valuesResponse.status}).`);
  const buffer = await valuesResponse.arrayBuffer();
  const scalarDownloadMs = performance.now() - scalarStarted;
  const parseStarted = performance.now();
  if (buffer.byteLength !== manifest.values.byte_length) {
    throw new Error(
      `Scientific scalar byte length ${buffer.byteLength} does not match metadata ${manifest.values.byte_length}.`,
    );
  }
  const values = float32LittleEndian(buffer);
  if (values.length !== manifest.values.scalar_count) {
    throw new Error(`Scientific scalar count ${values.length} does not match metadata ${manifest.values.scalar_count}.`);
  }
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) throw new Error(`Scientific scalar ${index} is not finite.`);
  }
  const scalarParseMs = performance.now() - parseStarted;
  return {
    data: { manifest, values },
    metrics: {
      metadataMs,
      geometryValidationMs,
      scalarDownloadMs,
      scalarParseMs,
      totalMs: performance.now() - totalStarted,
      firstRenderMs: null,
      sliceUpdateMs: null,
    },
  };
}

function validateManifest(manifest: ScientificFieldManifest) {
  if (manifest.schema !== "fusion-blanket-web-cell-field/v1") throw new Error("Unsupported scientific metadata schema.");
  if (manifest.field.key !== "nuclear_heating" || manifest.field.association !== "cell") {
    throw new Error("Expected the Nuclear Heating cell-data field.");
  }
  if (manifest.mesh.representation !== "exact_rectilinear_voxel_cell_grid") {
    throw new Error("Expected an exact rectilinear voxel cell grid.");
  }
  if (manifest.values.dtype !== "float32-le") throw new Error("Expected little-endian Float32 scientific values.");
  const { x, y, z } = manifest.mesh.axis_boundaries_mm;
  const [nz, ny, nx] = manifest.mesh.cell_shape_zyx;
  if (x.length !== nx + 1 || y.length !== ny + 1 || z.length !== nz + 1) {
    throw new Error("Scientific axis boundaries do not match the cell shape.");
  }
  if (nx * ny * nz !== manifest.mesh.cell_count || manifest.mesh.cell_count !== manifest.values.scalar_count) {
    throw new Error("Scientific cell counts are inconsistent.");
  }
  if (manifest.slicing.layers.length !== nz) throw new Error("Scientific Z-layer metadata is incomplete.");
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

export function zCellIndex(boundaries: number[], positionMm: number) {
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

const COLOR_STOPS = [
  [0, 5, 16, 38],
  [0.2, 55, 18, 82],
  [0.4, 126, 36, 95],
  [0.6, 198, 69, 67],
  [0.8, 246, 145, 55],
  [1, 252, 244, 181],
] as const;

export const SCIENTIFIC_COLOR_GRADIENT =
  "linear-gradient(to top, rgb(5 16 38), rgb(55 18 82), rgb(126 36 95), rgb(198 69 67), rgb(246 145 55), rgb(252 244 181))";

export function scientificColor(value: number, range: [number, number]): [number, number, number] {
  const normalized = range[1] === range[0] ? 0 : Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
  let upper = 1;
  while (upper < COLOR_STOPS.length && normalized > COLOR_STOPS[upper][0]) upper += 1;
  const right = COLOR_STOPS[Math.min(upper, COLOR_STOPS.length - 1)];
  const left = COLOR_STOPS[Math.max(0, upper - 1)];
  const fraction = right[0] === left[0] ? 0 : (normalized - left[0]) / (right[0] - left[0]);
  return [1, 2, 3].map((component) => (left[component] + (right[component] - left[component]) * fraction) / 255) as [number, number, number];
}
