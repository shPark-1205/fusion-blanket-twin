# Fusion Blanket Twin — Project Context

## 1. Purpose

The long-term goal is to build a digital twin of a fusion breeding blanket.

A true digital twin will eventually require a physical experimental blanket rig, sensors, live data acquisition, state estimation, prediction, and bidirectional digital/physical integration.

That physical rig does not exist yet.

The current goal is therefore to build a **simulation-driven virtual blanket environment** using high-fidelity numerical results as the data source. This environment should already resemble the future digital twin architecture so that real experimental/sensor inputs can later be added without rebuilding the platform.

The immediate aim is also visual and demonstrative: create an environment that is technically meaningful and visually compelling to researchers, reviewers, and decision-makers.

## 2. Current physical scope

Current modeling scope is intentionally limited to one unit cell of a solid breeding blanket.

The user can vary:

- breeder / multiplier ratio;
- internal structure;
- material assignment;
- coolant conditions;
- potentially geometry and operating conditions in later phases.

The whole-tokamak blanket, whole sector, and full reactor integration are outside the current implementation scope.

## 3. Physics capabilities

### 3.1 MCNP neutronics

Available MCNP outputs include:

- average neutron flux vs energy for each material;
- average photon flux vs energy for each material;
- Total TBR;
- Li-6 contribution to TBR;
- Li-7 contribution to TBR;
- multiplying reaction / MT16;
- neutron heating for each material;
- photon heating for each material;
- total heating for each material;
- heating vs distance from First Wall;
- mesh neutron flux;
- mesh photon flux;
- mesh neutron heating;
- mesh photon heating;
- mesh total heating;
- mesh tritium production;
- mesh multiplying tally.

The MCNP mesh tally is defined independently by the user input card and does not follow MCNP cell boundaries.

This is expected and correct.

At material boundaries, one mesh voxel may intersect multiple MCNP cells/materials. The mesh tally should still be retained as its own spatial field.

### 3.2 ANSYS CFX thermal-hydraulics

CFX can provide:

- temperature field;
- pressure field;
- velocity / flow field;
- heat-transfer coefficient;
- wall temperature;
- other postprocessed thermal-hydraulic quantities available through CFD-Post.

The intended multiphysics workflow is:

`NWL → MCNP → volumetric nuclear heating → CFX → T / P / V / HTC`

Not every MCNP case currently has a corresponding CFX case because thermal-hydraulic simulations are more expensive.

The data model must therefore support cases where:

- MCNP exists;
- CFX does not exist.

Do not assume one-to-one availability.

## 4. Representative CAD

Current STEP file:

`test_blanket.stp`

The STEP model is composed of separate solid bodies.

Known structure:

| Component | Count |
|---|---:|
| Armor | 1 |
| First Wall | 1 |
| Pressure Tube | 1 |
| Pin | 10 |
| Breeder | 1 |
| Multiplier | 1 |
| Coolant | 9 |
| BSS | 2 |

Total solids: **26**

Approximate global CAD dimensions previously inspected:

- X extent ≈ 144.34 mm
- Y extent ≈ 125 mm
- Z extent ≈ 921 mm

The most negative-Z side / minimum-Z armor face is the plasma-facing side.

For the project convention, this surface is treated as `Z = 0`.

## 5. Coordinate system

Canonical direction:

- `+Z` = tokamak radial outward direction `+R`
- `-Z` = toward plasma
- X/Y = toroidal/poloidal directions

For the current single-cell application, exact X/Y semantic assignment is not critical.

Units:

- CAD = mm
- MCNP = cm
- future project-internal visualization frame = mm

Therefore:

`MCNP coordinates × 10 = CAD/project coordinates in mm`

This conversion must be explicit in code.

## 6. Current MCNP VTKHDF dataset

Current exported file:

`test_total_heating.vtkhdf`

It was created in ParaView from the larger MCNP/XDMF/HDF5 result set.

The original `runtpe.h5` was approximately 645 MB and contained many mesh tallies. For the application workflow, required mesh fields should be exported individually or as curated datasets rather than carrying the entire raw HDF5 file into the viewer.

The VTKHDF file size is approximately:

- 48 MB

Previously inspected characteristics:

- dataset type: VTKHDF / multiblock with unstructured-grid/voxel content;
- mesh cell count: approximately 758,778;
- point count: approximately 787,904;
- cell type: voxel;
- MCNP X range: approximately `-7.3 to +7.3 cm`;
- MCNP Y range: approximately `-6.3 to +6.3 cm`;
- MCNP Z range: approximately `0 to 92.1 cm`.

After unit conversion:

- X ≈ `-73 to +73 mm`
- Y ≈ `-63 to +63 mm`
- Z ≈ `0 to 921 mm`

This is consistent with the CAD domain and strongly indicates that spatial registration is simple scaling rather than rotation/translation.

Known included arrays have included:

- `4_tally`
- `4_relative_standard_deviation`
- `14_tally`
- `14_relative_standard_deviation`
- `Total`
- `Total heating (W_cm3)`

Primary field for v0.1:

- `Total heating (W_cm3)`

Observed total-heating value range was approximately:

- minimum ≈ `1e-4 W/cm³`
- maximum ≈ `32.21 W/cm³`

The exact runtime range should be read from the dataset, not hard-coded.

## 7. MCNP mesh interpretation

Do not treat the MCNP mesh as a CAD/material mesh.

The correct conceptual layering is:

- CAD = exact engineering/material boundaries;
- MCNP voxel field = independent neutronics spatial sampling;
- CFX mesh = independent body-fitted thermal-fluid mesh.

These three meshes may differ and should remain independent.

The requirement is **coordinate registration**, not mesh matching.

For an exact raw MCNP probe at position `(x, y, z)`:

1. convert position to the MCNP/project frame as needed;
2. find the containing MCNP voxel;
3. return that voxel's tally value.

Optional interpolation may be added later but must be labeled as interpolated.

## 8. Current representative case

Current geometry parameter:

`V_breeder / (V_breeder + V_multiplier) = 32.6%`

Coolant:

- water

Pressure:

- 15.5 MPa

Inlet temperature:

- 295 °C

Expected blanket outlet temperature:

- 325 °C

NWL:

- 134 W/cm²
- 1.34 MW/m²

TBR:

- approximately 1.233

Current coolant mass flow:

- not yet finalized;
- not yet simulated for the current representative CFX case.

Do not populate the production metadata with an invented mass-flow value.

## 9. Data export strategy

### 9.1 MCNP

Preferred workflow:

`MCNP → XDMF/HDF5 → ParaView → curated VTKHDF`

VTKHDF was selected because it preserves mesh topology and is convenient for VTK/PyVista.

CSV is not preferred for 3D field transfer because it discards topology/connectivity and creates extra reconstruction work.

Future MCNP fields may be exported as:

- total heating;
- neutron flux;
- photon flux;
- T-production;
- multiplication.

### 9.2 CFX

Do not use giant point-cloud CSV files as the primary full-field exchange format.

Preferred direction:

`CFX .res → CGNS or mesh-preserving export → ParaView/VTK → VTU/VTKHDF/VTM as appropriate`

Initial thermal fields of interest:

Solid regions:
- temperature

Coolant regions:
- temperature
- pressure
- velocity

Later:
- HTC
- wall quantities
- additional engineering metrics

CFX and MCNP meshes do not need to match.

## 10. Current application strategy

Initial scientific stack:

- Python
- VTK
- PyVista
- trame / browser UI

The reason is compatibility with the current ParaView/VTK workflow and reduced implementation burden for scientific operations such as:

- clipping;
- slicing;
- probing;
- contouring;
- mesh overlays;
- scalar color maps.

High-end 3D engines such as Omniverse, Unreal, or Unity are intentionally deferred.

They may later become a showcase/presentation layer connected to the same backend.

## 11. v0.1 functional concept

v0.1 is not intended to be a complete digital twin.

It is the first working scientific virtual-blanket viewer.

Target behavior:

- load the STEP/CAD geometry;
- load MCNP Total Heating;
- apply MCNP cm → mm scaling;
- overlay the MCNP field with CAD;
- show CAD transparently;
- display a radial Z slice of nuclear heating;
- provide a color bar;
- allow radial slice movement;
- allow raw voxel probing;
- show key case metadata.

Initial case metadata shown in UI should include:

- TBR ≈ 1.233
- NWL = 1.34 MW/m²
- breeder ratio = 32.6%
- coolant = water
- pressure = 15.5 MPa
- inlet temperature = 295 °C
- expected outlet temperature = 325 °C
- mass flow = N/A / not simulated

## 12. Desired future UI

Eventually the application should present:

### Main 3D view

- CAD blanket cell;
- transparent / exploded modes;
- MCNP fields;
- CFX fields;
- clipping;
- point probes;
- field selection.

### Neutronics selector

- neutron flux;
- photon flux;
- nuclear heating;
- tritium production;
- multiplication.

### Thermal-hydraulics selector

- temperature;
- pressure;
- velocity;
- HTC.

### KPI panel

- TBR;
- Li-6 TBR;
- Li-7 TBR;
- Tmax;
- outlet temperature;
- pressure drop;
- other future performance metrics.

### Multiphysics pipeline

Visually communicate:

`PLASMA → NEUTRONICS → NUCLEAR HEATING → THERMAL-HYDRAULICS → PERFORMANCE`

### Linked 2D plots

Examples:

- heating vs distance from First Wall;
- neutron/photon energy spectra;
- temperature vs radial position;
- pressure vs coolant path;
- HTC vs coolant path.

The 3D slice position and 2D radial graph marker should eventually be linked.

## 13. Surrogate / ROM direction

MCNP can be run for many more parameter combinations than CFX.

This naturally creates a sparse multiphysics database.

Future state/input vector may include:

- breeder fraction;
- multiplier fraction;
- coolant mass flow;
- coolant inlet temperature;
- outlet pressure;
- NWL;
- selected geometry parameters.

Future scalar outputs may include:

- TBR;
- Tmax;
- Tout;
- pressure drop;
- other KPIs.

Field prediction may later use reduced-order modeling, for example:

- POD/PCA basis of temperature fields;
- surrogate model predicting modal coefficients.

Do not introduce complex ML before the basic database, field alignment, and viewer are stable.

## 14. Long-term digital twin path

### Stage 1 — Virtual Model

`MCNP + CFX → simulation database → 3D virtual blanket`

### Stage 2 — Simulation-driven Virtual Twin

`DOE database → surrogate/ROM → near-real-time what-if analysis`

### Stage 3 — Digital Shadow

`physical rig → sensors/DAQ → virtual blanket`

Typical future experimental measurements:

- temperature;
- pressure;
- mass flow;
- inlet temperature;
- outlet temperature.

### Stage 4 — Digital Twin

`physical blanket ↔ data assimilation/state estimation ↔ multiphysics digital model ↔ prediction/optimization`

The important future scientific objective is reconstruction of unmeasured internal states from sparse measurements.

Potential estimated quantities:

- full temperature field;
- pressure field;
- HTC field;
- possibly corrected neutronics state;
- unmeasurable internal quantities.

## 15. Research value

A key differentiator of this project is its explicit multiphysics chain:

`NWL → neutron/photon transport → tritium breeding & multiplication → nuclear heating → thermal-fluid response`

This should remain visible in both software architecture and UI.

The platform should not become a generic CFD viewer.

## 16. Hardware / user environment

Primary development workstation:

- CPU: AMD Ryzen 9 7900
- RAM: DDR5 96 GB
- GPU: NVIDIA GeForce RTX 4060 Ti
- preferred IDE: PyCharm
- Python-oriented workflow preferred
- no prior Unreal/Unity/Omniverse experience

This hardware is adequate for the current scientific viewer and single-cell visualization target.

## 17. Git / repository strategy

Repository:

`fusion-blanket-twin`

Recommended development pattern:

- stable branch: `main`
- initial development branch: `feature/mcnp-cad-viewer`
- version tags: `v0.1.0`, `v0.2.0`, ...

Large simulation files should generally remain outside normal Git tracking.

Suggested high-level structure:

```text
fusion-blanket-twin/
├─ AGENTS.md
├─ app/
├─ src/
│  ├─ geometry/
│  ├─ mcnp/
│  ├─ cfx/
│  ├─ visualization/
│  ├─ data/
│  └─ config/
├─ data/
│  ├─ sample/
│  └─ README.md
├─ docs/
│  ├─ PROJECT_CONTEXT.md
│  └─ ROADMAP.md
├─ tests/
├─ requirements.txt
├─ .gitignore
└─ README.md
```

## 18. Immediate development principle

The most important first technical problem is:

**CAD–MCNP–CFX spatial registration**

Once this is correct, most later work becomes visualization, data management, surrogate modeling, and UI engineering.

Do not prioritize cosmetic 3D rendering before this spatial/physics foundation is correct.
