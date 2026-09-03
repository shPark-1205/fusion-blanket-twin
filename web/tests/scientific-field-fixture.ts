import type { Page } from "@playwright/test";

import type {
  ScientificFieldId,
  ScientificFieldManifest,
  ScientificFieldRecord,
} from "../src/lib/scientific-field";

const FIELD_ORDER: ScientificFieldId[] = [
  "neutron_flux",
  "photon_flux",
  "neutron_heating",
  "photon_heating",
  "nuclear_heating",
];

const FIELD_META: Record<ScientificFieldId, {
  displayName: string;
  quantityType: "Flux" | "Heating";
  units: string;
}> = {
  neutron_flux: { displayName: "Neutron Flux", quantityType: "Flux", units: "n/cm²/s" },
  photon_flux: { displayName: "Photon Flux", quantityType: "Flux", units: "n/cm²/s" },
  neutron_heating: { displayName: "Neutron Heating", quantityType: "Heating", units: "W/cm³" },
  photon_heating: { displayName: "Photon Heating", quantityType: "Heating", units: "W/cm³" },
  nuclear_heating: { displayName: "Total Nuclear Heating", quantityType: "Heating", units: "W/cm³" },
};

const AXIS_BOUNDARIES = {
  x: [-500, -150, 150, 500],
  y: [-500, -150, 150, 500],
  z: [0, 300, 600, 900],
};

const CELL_COUNT = 27;
const BASE_VALUES = Array.from({ length: CELL_COUNT }, (_, index) => index);
const VALUES: Record<ScientificFieldId, Float32Array> = {
  neutron_flux: new Float32Array(BASE_VALUES.map((value) => value * 100)),
  photon_flux: new Float32Array(BASE_VALUES.map((value) => value * 40)),
  neutron_heating: new Float32Array(BASE_VALUES.map((value) => value * 2)),
  photon_heating: new Float32Array(BASE_VALUES),
  nuclear_heating: new Float32Array(BASE_VALUES.map((value) => value * 3)),
};

function layers(boundaries: number[]) {
  return boundaries.slice(0, -1).map((lower, index) => ({
    index,
    bounds_mm: [lower, boundaries[index + 1]] as [number, number],
    center_mm: (lower + boundaries[index + 1]) / 2,
  }));
}

function sliceRanges(maximum: number) {
  return {
    X: Array.from({ length: 3 }, () => [0, maximum] as [number, number]),
    Y: Array.from({ length: 3 }, () => [0, maximum] as [number, number]),
    Z: Array.from({ length: 3 }, () => [0, maximum] as [number, number]),
  };
}

function fieldRecord(id: ScientificFieldId): ScientificFieldRecord {
  const meta = FIELD_META[id];
  const values = VALUES[id];
  const maximum = values.at(-1) ?? 0;
  const ranges = sliceRanges(maximum);
  return {
    key: id,
    source_name: meta.displayName,
    display_name: meta.displayName,
    quantity_type: meta.quantityType,
    units: meta.units,
    display_units: meta.units,
    association: "cell",
    source_precision: "Float64",
    web_precision: "Float32",
    source_range: [0, maximum],
    web_range: [0, maximum],
    finite_count: CELL_COUNT,
    zero_count: 1,
    positive_minimum: values[1],
    log_scale_supported: true,
    log_scale_recommended: meta.quantityType === "Flux",
    values: {
      url: `${id}.f32`,
      dtype: "float32-le",
      byte_length: values.byteLength,
      scalar_count: values.length,
    },
    precision: {
      role: "Deterministic Playwright visualization fixture",
      maximum_absolute_deviation: 0,
      maximum_relative_deviation_nonzero: 0,
      mean_absolute_deviation: 0,
    },
    slice_ranges: ranges,
    source_slice_ranges: ranges,
    provenance: { kind: "MCNP Simulation", role: "Test-only reference fixture" },
  };
}

const FIELDS = Object.fromEntries(FIELD_ORDER.map((id) => [id, fieldRecord(id)])) as Record<ScientificFieldId, ScientificFieldRecord>;

const MANIFEST: ScientificFieldManifest = {
  schema: "fusion-blanket-web-cell-fields/v2",
  dataset_id: "playwright-reference-mcnp",
  default_field_key: "nuclear_heating",
  field_order: FIELD_ORDER,
  provenance: {
    kind: "MCNP Simulation",
    role: "Deterministic test-only reference field",
    source_path: "tests/scientific-field-fixture.ts",
    source_sha256: "playwright-fixture",
    source_format: "Synthetic raw-cell fixture",
    source_block: "none",
    source_reference: "Playwright",
    case_id: "TEST-REFERENCE",
  },
  fields: FIELDS,
  mesh: {
    representation: "exact_rectilinear_voxel_cell_grid",
    point_count: 64,
    cell_count: CELL_COUNT,
    point_shape_xyz: [4, 4, 4],
    cell_shape_zyx: [3, 3, 3],
    array_order: "C",
    cell_index_order: "k-major, then j, then i",
    axis_boundaries_mm: AXIS_BOUNDARIES,
    axis_metadata: {
      x: { cell_count: 3, minimum_spacing_mm: 300, maximum_spacing_mm: 350, uniform: false },
      y: { cell_count: 3, minimum_spacing_mm: 300, maximum_spacing_mm: 350, uniform: false },
      z: { cell_count: 3, minimum_spacing_mm: 300, maximum_spacing_mm: 300, uniform: true },
    },
    bounds_cm: [-50, 50, -50, 50, 0, 90],
    bounds_mm: [-500, 500, -500, 500, 0, 900],
  },
  transform: {
    description: "MCNP cm to viewer mm",
    scale: [10, 10, 10],
    rotation_degrees: [0, 0, 0],
    translation_mm: [0, 0, 0],
    matrix_row_major: [10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 1],
  },
  slicing: {
    available_axes: ["X", "Y", "Z"],
    default_axis: "Z",
    semantics: "Containing raw voxel layer; no interpolation",
    boundary_convention: "Half-open intervals; final upper boundary included",
    axes: {
      X: { position_range_mm: [-500, 500], default_position_mm: 0, layers: layers(AXIS_BOUNDARIES.x) },
      Y: { position_range_mm: [-500, 500], default_position_mm: 0, layers: layers(AXIS_BOUNDARIES.y) },
      Z: { position_range_mm: [0, 900], default_position_mm: 450, layers: layers(AXIS_BOUNDARIES.z) },
    },
  },
  probe: {
    semantics: "Return all five raw cell values for the containing voxel",
    returns: FIELD_ORDER,
    boundary_convention: "Half-open intervals; final upper boundary included",
  },
  consistency_checks: {
    nuclear_heating_equals_neutron_plus_photon: {
      passed: true,
      maximum_absolute_error: 0,
      mean_absolute_error: 0,
    },
  },
};

export async function installScientificFieldFixture(page: Page) {
  await page.route("**/scientific/generated/reference-mcnp/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/scientific/generated/reference-mcnp/*.f32", (route) => {
    const filename = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const fieldId = filename.replace(/\.f32$/, "") as ScientificFieldId;
    const values = VALUES[fieldId];
    if (!values) return route.fulfill({ status: 404 });
    return route.fulfill({
      body: Buffer.from(values.buffer, values.byteOffset, values.byteLength),
      contentType: "application/octet-stream",
    });
  });
}
