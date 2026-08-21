# Fusion Blanket Twin — Agent Instructions

## Project identity
Project name: **Fusion Blanket Twin**

Primary goal: develop a **simulation-driven virtual breeding blanket platform** that can later evolve into a physical digital twin when an experimental blanket rig and live sensors become available.

## Current scope
- single solid-breeder blanket unit cell
- MCNP neutronics
- ANSYS CFX thermal-hydraulics
- Python + VTK/PyVista/trame scientific visualization
- later optional high-end 3D frontend

## Architecture principle
Keep physics, data, digital-model, and presentation layers separated.

### Data layer
Must support:
- per-case metadata
- primitive CSG geometry parameters
- optional STEP geometry
- exact simulation fields
- future surrogate fields
- future experiment/sensor data

### Digital-model layer
Must support:
- design-variable mapping
- geometry providers
- field providers
- common-grid/regridding logic
- surrogate / ROM
- state estimation
- prediction / optimization

## Geometry representation — IMPORTANT
The current ~100-case MCNP study is a structured 10×10 DOE with two current design variables.

Current DOE behavior:
- PZ 206–209 shift together while preserving their internal spacings.
- CZ 301–304 radii change together while preserving their internal radial spacings.

These two variables are only the **current DOE parameterization** and must not become permanent geometry restrictions.

Preserve primitive CSG parameters independently:
- `pz_206`
- `pz_207`
- `pz_208`
- `pz_209`
- `cz_301_radius`
- `cz_302_radius`
- `cz_303_radius`
- `cz_304_radius`

Future studies may vary the spacings independently.

Use the layered architecture:

`DesignVariables`
→ `GeometryParameterMapping / Constraints`
→ `PrimitiveCSGParameters`
→ `CSG Geometry`

Do NOT hard-code the permanent geometry API as only:
`geometry(axial_group_shift, radial_group_shift)`.

## Design variables vs derived metrics
The current two original DOE variables should remain the primary independent variables for the first surrogate.

Derived metrics may include:
- breeder volume
- multiplier volume
- breeder/(breeder+multiplier) ratio
- layer thicknesses

Do not reduce the current DOE to breeder ratio alone.

## CSG + STEP strategy
For the current MCNP family:
- CSG parameters/topology are the authoritative parametric representation.
- STEP remains a supported representation for arbitrary future CAD geometries.
- Do not require one manually generated STEP for every unseen/intermediate design.

Preferred geometry providers:
- `ParametricCSGGeometryProvider`
- `StepGeometryProvider`
- future CAD providers if needed

All geometry providers must return a common viewer-facing component representation.

## Coordinate convention — DO NOT CHANGE
- `+Z` = tokamak `+R`
- `-Z` = toward plasma
- `Z = 0` = plasma-facing armor surface
- CAD/viewer = mm
- MCNP = cm
- MCNP spatial coordinates ×10 for viewer

## MCNP FMESH rule
MCNP FMESH is independent of CSG/material cell boundaries.

Therefore:
- preserve original voxels;
- do not force voxel boundaries to CAD/CSG boundaries;
- raw probe returns containing-voxel tally;
- interpolation/regridding must be explicitly labeled.

## Existing ~100 MCNP cases
Approximately 100 MCNP cases already exist:
- 2 design variables
- 10 levels each
- 10×10 full factorial
- geometry changes between cases
- original FMESH definitions were adjusted per case

Do not discard these results.

They are useful for:
- scalar surrogate training
- exact case visualization
- validation
- comparison with future common-FMESH reruns

## Common FMESH for future field ROM
For authoritative cross-case field POD/PCA/ROM/surrogate training, prefer a common canonical FMESH.

Geometry remains case-specific; only the tally grid is common.

Canonical training grid should have identical:
- origin
- axes
- boundaries/coordinates
- extent
- resolution
- indexing

Do not block current software development while common-grid MCNP reruns are running.

## Geometry-provider architecture
Known cases:
`SimulationGeometryProvider(case_id)`

Current parametric family:
`ParametricCSGGeometryProvider(design_parameters)`
→ mapping
→ primitive CSG parameters
→ geometry

Arbitrary CAD:
`StepGeometryProvider(path)`

Viewer must not assume one global STEP file.

## Field-provider architecture
Use:
- `SimulationFieldProvider`
- `SurrogateFieldProvider`

Viewer must not depend directly on VTKHDF as its only field source.

## Current representative case
- breeder/(breeder+multiplier) ratio = 0.326
- water coolant
- pressure = 15.5 MPa
- inlet temperature = 295 °C
- expected outlet temperature = 325 °C
- NWL = 134 W/cm² = 1.34 MW/m²
- TBR ≈ 1.233

## Current viewer status
The current PyVista/trame viewer supports:
- CAD rotation
- CAD opacity
- MCNP Total Heating
- cm→mm transform
- Z-normal slice
- interactive slice position
- dynamic scalar legend
- raw voxel probe foundation

The trame `/paraview/` POST 405 is known to be harmless in the current local setup; `/ws` works.

## Near-term priorities
1. parse primitive MCNP CSG parameters
2. represent current 2-variable mapping without making it permanent
3. build a 100-case registry
4. preserve STEP viewer support
5. introduce geometry/field provider interfaces
6. ingest scalar results
7. build first scalar surrogate
8. design/run canonical FMESH in parallel
9. build field ROM after common-grid data are available

## Windows shell restriction
Do not use PowerShell.

Prefer:
1. direct executable
2. `cmd.exe`
3. Git Bash
4. Python scripts

Example:
`set PYTHONPATH=src && .venv\Scripts\python.exe -m unittest discover -s tests -v`

## Git workflow
- `main` = stable
- feature branches = development
- tags = milestones

Do not commit large raw simulation datasets or local environments.

## Coding expectations
- inspect repository first
- separate design variables from primitive CSG parameters
- preserve units explicitly
- avoid workstation-specific paths
- use `pathlib`
- write tests for parser, mapping, provider contracts, transforms, registry integrity
- document interpolation/regridding explicitly

Before changing physics/data behavior, read:
- `docs/PROJECT_CONTEXT.md`
- `docs/ROADMAP.md`
