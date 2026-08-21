# Fusion Blanket Twin — Project Context v3

## Existing 100-case MCNP study
There are approximately 100 MCNP cases arranged as a 10×10 full-factorial DOE.

### Current design variable A
PZ surfaces 206–209 shift together.

For the current 100 cases:
- internal spacings remain fixed;
- the whole four-surface group shifts.

### Current design variable B
CZ surfaces 301–304 change radius together.

For the current 100 cases:
- internal radial spacings remain fixed;
- all four radii grow/shrink together.

These are current DOE constraints only. Future studies may unlock individual spacings.

## General geometry model
Use three levels:

### 1. Design variables
Current:
- PZ-group variable
- CZ-group variable

Future examples:
- individual layer thicknesses
- individual PZ spacings
- individual CZ spacings
- coolant gap
- other engineering dimensions

### 2. Primitive CSG parameters
At minimum:
- pz_206
- pz_207
- pz_208
- pz_209
- cz_301_radius
- cz_302_radius
- cz_303_radius
- cz_304_radius

### 3. MCNP CSG topology
MCNP cell Boolean definitions consume the primitive surfaces.

The same topology can be reused while numerical surface parameters change.

## CSG vs STEP
For the current MCNP family, CSG is the preferred authoritative parametric representation.

STEP should still be supported because future CAD may include geometry that is inconvenient to represent with the current CSG family.

Therefore the project should support both parametric CSG geometry and exact STEP geometry.

## Existing FMESH situation
The existing ~100 cases used geometry-dependent FMESH definitions.

These results remain valid and useful for:
- TBR
- multiplying
- scalar surrogate
- case-level visualization
- validation

For cross-case 3D field surrogate training, a future common canonical FMESH is preferred.

## First surrogate
Do not use breeder ratio as the sole input.

Use the two original DOE variables as primary inputs:
`(PZ variable, CZ variable) → TBR`

Then extend to:
- Li-6 TBR
- Li-7 TBR
- multiplying

The 10×10 DOE is well suited to structured interpolation validation.

## Case registry
The next data architecture should register each of the ~100 MCNP inputs with fields such as:

- case_id
- input filename
- PZ level/index
- CZ level/index
- PZ DOE variable value
- CZ DOE variable value
- pz_206
- pz_207
- pz_208
- pz_209
- cz_301_radius
- cz_302_radius
- cz_303_radius
- cz_304_radius
- breeder volume ratio
- Total TBR
- Li-6 TBR
- Li-7 TBR
- multiplying
- STEP path if available
- adaptive FMESH path if available
- future canonical FMESH path
- notes/status

## Current viewer
The current PyVista/trame scientific viewer already demonstrates:
- CAD rotation
- opacity
- Total Heating slice
- interactive Z movement
- dynamic legend
- raw voxel probe foundation

This viewer should later display either:
- exact simulation fields, or
- surrogate-predicted fields

through a common provider interface.

## Near-term work while common-FMESH reruns are pending
1. parse all 100 MCNP inputs
2. extract primitive PZ/CZ parameters
3. identify filename/case naming and 10×10 ordering
4. build registry
5. ingest scalar results
6. build scalar surrogate
7. generalize geometry and field providers
8. preserve/improve viewer
9. run common-FMESH cases in parallel when convenient
