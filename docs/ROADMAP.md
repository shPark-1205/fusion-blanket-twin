# Fusion Blanket Twin — Development Roadmap

## Guiding principle

Build the scientific backbone first.

Order of priority:

1. coordinate correctness;
2. repeatable data loading;
3. stable scientific visualization;
4. field interaction;
5. case/database structure;
6. CFX coupling;
7. surrogate / ROM;
8. sensor integration;
9. high-end visual polish.

Avoid solving visual-design problems before the data model is stable.

---

# Milestone v0.1.0 — MCNP + CAD Scientific Viewer

Branch:

`feature/mcnp-cad-viewer`

## Goal

Create the first working virtual breeding blanket viewer using:

- current STEP geometry;
- current MCNP Total Heating VTKHDF;
- Python/PyVista/VTK;
- local execution from PyCharm;
- optional trame/browser interface.

## Must-have features

### Geometry

- load the current blanket geometry;
- preserve separate components where practical;
- convert/cache geometry into VTK-friendly surfaces if direct STEP loading is inconvenient;
- avoid requiring the user to manually re-export CAD every run.

### MCNP

- load `test_total_heating.vtkhdf`;
- locate the `Total heating (W_cm3)` field;
- validate field presence;
- convert MCNP coordinates from cm to mm;
- verify bounds against CAD.

Expected converted MCNP bounds:

- X ≈ `[-73, 73] mm`
- Y ≈ `[-63, 63] mm`
- Z ≈ `[0, 921] mm`

### Visualization

- show CAD and MCNP in the same scene;
- default CAD to semi-transparent;
- display a radial Z-oriented nuclear-heating slice;
- allow Z slice movement from plasma-facing side to blanket rear;
- show scalar legend/color bar;
- allow reset camera;
- expose CAD opacity control.

### Probe

Initial acceptable implementation:

- user provides X/Y/Z coordinate;
- app finds containing MCNP voxel;
- app returns raw `Total heating (W_cm3)` value.

Do not interpolate in v0.1 unless interpolation is explicitly separated from raw probe mode.

### Metadata

Display:

- TBR ≈ 1.233
- NWL = 1.34 MW/m²
- breeder ratio = 32.6%
- coolant = water
- pressure = 15.5 MPa
- Tin = 295 °C
- expected Tout = 325 °C
- mass flow = not simulated / N/A

## v0.1 acceptance criteria

v0.1 is complete when:

- the app runs from a clean Python environment;
- CAD loads;
- MCNP heating loads;
- MCNP/CAD overlap is spatially correct;
- Z slice moves correctly through the entire blanket;
- heating scalar is visible;
- a raw probe returns plausible voxel values;
- missing files produce clear errors;
- no hard-coded absolute workstation paths are required.

## Recommended code organization

```text
app/
  app.py

src/
  geometry/
    loader.py
    preprocessing.py

  mcnp/
    loader.py
    transforms.py
    probe.py

  visualization/
    scene.py
    colormaps.py

  config/
    settings.py

tests/
  test_mcnp_transform.py
  test_bounds.py
  test_field_detection.py
```

## Suggested first tests

1. `cm → mm` conversion:
   - `92.1 cm → 921 mm`

2. expected MCNP Z bounds:
   - min ≈ 0 mm
   - max ≈ 921 mm

3. required field exists:
   - `Total heating (W_cm3)`

4. probe coordinate outside mesh:
   - returns a clear out-of-bounds result

5. missing data file:
   - returns a human-readable error.

---

# Milestone v0.2.0 — Component-Aware Viewer

## Goal

Make the viewer feel like a real engineering model rather than a field overlay.

## Features

- component tree;
- show/hide by component group;
- per-component opacity;
- stable component IDs;
- support:
  - Armor
  - First Wall
  - Pressure Tube
  - Pins
  - Breeder
  - Multiplier
  - Coolant
  - BSS
- clipping of CAD itself;
- better camera presets:
  - plasma-facing view
  - radial side view
  - section view
  - isometric view.

## Probe improvement

Add 3D mouse-click picking if reliable.

At a picked point show:

- position;
- nearest/containing MCNP voxel;
- total heating;
- component/material under CAD if determinable.

---

# Milestone v0.3.0 — Neutronics Field Explorer

## Goal

Expand from one heating field to a reusable neutronics viewer.

## Add fields

- neutron flux;
- photon flux;
- total heating;
- tritium production;
- multiplication.

## UI

Create a field selector:

```text
NEUTRONICS
- Neutron Flux
- Photon Flux
- Total Nuclear Heating
- Tritium Production
- Multiplication
```

## Linked plots

Add at least one 2D engineering plot:

- nuclear heating vs radial distance from plasma-facing surface.

The active Z slice position should be marked on the plot.

Later add:

- neutron flux vs energy;
- photon flux vs energy.

---

# Milestone v0.4.0 — Case Management

## Goal

Move from one hard-coded case to a reusable case database.

## Case metadata

Use a structured file such as JSON or YAML.

Example fields:

- case ID;
- breeder fraction;
- multiplier fraction;
- NWL;
- coolant;
- pressure;
- Tin;
- Tout;
- mass flow;
- TBR;
- MCNP availability;
- CFX availability;
- file paths.

## Requirements

The viewer must support:

- multiple MCNP cases;
- cases without CFX;
- clear indication of missing physics results.

Do not fabricate absent CFX results.

---

# Milestone v0.5.0 — CFX Integration

## Goal

Add thermal-hydraulic fields to the same registered 3D environment.

## Initial fields

Solid domains:

- temperature.

Coolant domains:

- temperature;
- pressure;
- velocity.

Later:

- HTC;
- wall temperature;
- pressure drop.

## Data path

Preferred:

`CFX .res → CGNS/mesh-preserving export → ParaView/VTK → app`

Avoid using CSV as the canonical full-field representation.

## Acceptance criteria

- CFX mesh remains independent from MCNP mesh;
- both align in the same CAD coordinate frame;
- the user can switch between:
  - Nuclear Heating
  - Temperature
  - Pressure
  - Velocity.

## UI concept

```text
PHYSICS
- Geometry
- Neutronics
- Thermal-Hydraulics
```

---

# Milestone v0.6.0 — Multiphysics Interaction

## Goal

Make the chain between MCNP and CFX visually obvious.

## UI pipeline

`PLASMA → NEUTRONICS → HEATING → THERMAL-HYDRAULICS → PERFORMANCE`

Clicking each stage should change the active field or view.

## Combined probe

At one physical point, show available values from different models:

- neutron flux;
- photon flux;
- heating;
- temperature;
- pressure if coolant region;
- other available quantities.

This is a major project differentiator.

---

# Milestone v0.7.0 — Browser App / Engineering Dashboard

## Goal

Provide an easily accessible local browser interface.

Recommended technology:

- trame with VTK/PyVista;
- local server first;
- remote deployment later.

## UI layout

### Left
- component tree;
- physics selector;
- field selector.

### Center
- 3D viewer.

### Right
- KPI cards;
- probe values;
- case metadata.

### Bottom
- design variables;
- linked engineering plots.

---

# Milestone v0.8.0 — Parametric Database

## Goal

Support many design cases.

Likely design variables:

- breeder fraction;
- multiplier fraction;
- NWL;
- coolant mass flow;
- inlet temperature;
- outlet pressure;
- selected geometry variables.

## Important reality

MCNP case count will likely be much greater than CFX case count.

Database design must handle sparse CFX coverage.

---

# Milestone v0.9.0 — Surrogate / Reduced-Order Model

## Goal

Enable near-real-time what-if exploration.

## Scalar surrogate targets

Possible outputs:

- TBR;
- Tmax;
- Tout;
- pressure drop.

Start with simple robust models.

Possible approaches:

- Gaussian Process;
- XGBoost;
- small neural network.

Model choice should be driven by dataset size and validation performance.

## Field surrogate

Only after multiple aligned CFX fields exist.

Suggested path:

1. interpolate fields to a common representation if required;
2. POD/PCA;
3. retain dominant spatial modes;
4. train a surrogate for modal coefficients;
5. reconstruct `T(x,y,z)`.

Do not jump directly to complex neural operators without evidence that simpler ROMs are inadequate.

---

# Milestone v1.0.0 — Simulation-Driven Virtual Blanket

## Goal

A stable pre-digital-twin platform.

Expected capabilities:

- multiple neutronics fields;
- thermal-hydraulic fields;
- case database;
- interactive CAD;
- linked 3D/2D visualization;
- probes;
- KPI dashboard;
- parameter exploration;
- validated surrogate or ROM for selected outputs;
- clear separation between simulation data and future sensor data.

At this point the platform may be presented as:

**Simulation-Driven Virtual Breeding Blanket Platform for Digital Twin Development**

---

# Post-v1.0 — Experimental Rig Integration

## Stage A — Digital Shadow

Add experimental inputs:

- pressure sensors;
- temperature sensors;
- flow meter;
- inlet/outlet measurements;
- DAQ.

Architecture:

`Experimental rig → DAQ → Data interface → Virtual Blanket`

UI should distinguish:

- Simulation
- Experiment
- Digital Twin

Never label simulated playback as live experimental data.

---

# Post-v1.0 — State Estimation

## Goal

Use sparse measurements to estimate unmeasured fields.

Potential measured state:

- thermocouples;
- Pin/Pout;
- Tin/Tout;
- mass flow.

Potential estimated state:

- full temperature field;
- full pressure field;
- HTC field;
- thermal margin.

This is expected to become a major digital-twin research contribution.

---

# Post-v1.0 — Predictive / Prescriptive Twin

## Predictive examples

Given current operating state:

- predict Tmax at a future/higher NWL;
- estimate outlet temperature;
- estimate thermal margin;
- detect model/experiment deviation.

## Prescriptive examples

Given constraints such as:

- TBR ≥ 1.1
- Tmax ≤ material limit
- pressure drop minimized

recommend:

- coolant flow;
- geometry/material ratio;
- operating point.

---

# Optional Showcase Layer

Only after the scientific backend is stable.

Possible technologies:

- NVIDIA Omniverse / OpenUSD;
- Unreal Engine;
- Unity.

Use this layer for:

- realistic materials;
- lighting;
- cinematic camera;
- exploded animation;
- transparent assemblies;
- high-quality particles/flow animation.

It should consume the same backend/data API as the engineering viewer.

The scientific viewer remains the reference for engineering correctness.

---

# Immediate next task for Codex

When starting in PyCharm Codex:

1. read `AGENTS.md`;
2. read `docs/PROJECT_CONTEXT.md`;
3. inspect the current repository;
4. locate or create the v0.1 implementation;
5. work on `feature/mcnp-cad-viewer`;
6. prioritize reliable CAD + MCNP loading and registration;
7. do not modify physics conventions without explicit instruction.

Suggested first Codex prompt:

> Read `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, and `docs/ROADMAP.md`. Inspect the repository before changing anything. Continue the `feature/mcnp-cad-viewer` implementation toward v0.1.0. Preserve the coordinate and unit conventions exactly, and first verify the current CAD and MCNP data-loading paths and spatial bounds.
