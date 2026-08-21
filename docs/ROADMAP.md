# Fusion Blanket Twin — Roadmap v3

## Current working foundation
- representative CAD/MCNP registration
- MCNP cm→mm conversion
- PyVista/trame viewer
- CAD rotation
- opacity
- Z-normal Total Heating slice
- dynamic legend
- raw voxel probe foundation

## Phase 1 — MCNP CSG parameter parser
Parse the existing MCNP input files.

Initial required surfaces:
- PZ 206
- PZ 207
- PZ 208
- PZ 209
- CZ 301
- CZ 302
- CZ 303
- CZ 304

Return a typed primitive-parameter representation.

Do not encode the current 2-variable DOE into the primitive class.

## Phase 2 — Design-variable mapping
Represent the current DOE as a separate mapping/constraint layer.

Current:
- one PZ-group shift
- one CZ-group radius change

Future:
- independent spacings/thicknesses

## Phase 3 — 100-case registry
Scan all ~100 MCNP input files and create a structured manifest with:
- case ID
- DOE indices
- DOE values
- eight primitive surface values
- scalar results
- optional geometry/result paths

## Phase 4 — Scalar result ingestion
Ingest:
- Total TBR
- Li-6 TBR
- Li-7 TBR
- Multiplying

Join them to the registry.

## Phase 5 — First scalar surrogate
Input:
- current PZ DOE variable
- current CZ DOE variable

Output:
- Total TBR first
- then other scalar metrics

Validate interpolation and flag extrapolation.

## Phase 6 — Geometry-provider architecture
Introduce:
- `ParametricCSGGeometryProvider`
- `StepGeometryProvider`

Viewer consumes a common geometry representation.

## Phase 7 — Field-provider architecture
Introduce:
- `SimulationFieldProvider`
- `SurrogateFieldProvider`

Viewer remains agnostic to source.

## Phase 8 — Canonical FMESH design/reruns
Run in parallel when convenient.

Use one common grid for cross-case field ROM training while keeping original adaptive FMESH results.

## Phase 9 — MCNP field ROM
After common-grid fields exist:
1. verify identical grid/indexing
2. build field matrix
3. POD/PCA/SVD
4. predict modal coefficients from design variables
5. reconstruct unseen field
6. validate on held-out MCNP cases

Start with Total Nuclear Heating.

## Phase 10 — Unseen-case virtual blanket
User selects intermediate design variables.

System generates:
- parametric CSG geometry
- predicted scalar metrics
- predicted field

Viewer clearly labels predicted values.

## Later
- CFX exact-field integration
- CFX surrogate/ROM
- experiment/DAQ
- state estimation
- digital shadow
- digital twin

## Immediate next actions
1. replace MD files with v3
2. provide ~100 MCNP inputs as ZIP
3. ask Codex to parse/inventory them
4. populate scalar-results workbook
5. build registry
6. build scalar surrogate
7. run common-FMESH MCNP jobs in parallel
