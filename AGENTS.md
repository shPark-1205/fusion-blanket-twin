# Fusion Blanket Twin — Agent Instructions

## Project identity

Project name: **Fusion Blanket Twin**

Repository: `fusion-blanket-twin`

Primary goal: develop a **simulation-driven virtual breeding blanket platform** that can later evolve into a physical **digital twin** when an experimental blanket rig and live sensors become available.

The current system is **not yet a full digital twin**. Treat it as a virtual / simulation-driven pre-digital-twin environment.

## Current scope

For now, limit development to:

- one solid-breeder blanket unit cell;
- MCNP-based neutronics;
- ANSYS CFX-based thermal-hydraulics;
- Python-based scientific visualization and application logic;
- VTK/PyVista/trame-style scientific visualization before any optional Omniverse/Unreal/Unity showcase layer.

Do not expand scope to whole-tokamak or whole-sector models unless explicitly requested.

## Core architecture principle

Keep these layers separated:

1. Physics layer
   - MCNP
   - ANSYS CFX

2. Data layer
   - geometry
   - case metadata
   - neutronics fields
   - thermal-hydraulic fields
   - future experiment/sensor data

3. Digital model layer
   - interpolation
   - surrogate model
   - reduced-order model
   - state estimation
   - prediction / optimization

4. Presentation layer
   - local scientific viewer
   - browser UI
   - later optional high-end 3D frontend

The frontend must never become the only place where physics/data logic lives.

## Coordinate convention — DO NOT CHANGE

Canonical project coordinates:

- `+Z` = tokamak `+R`, radially outward
- `-Z` = toward the plasma
- `Z = 0` = plasma-facing armor surface
- X/Y = toroidal/poloidal directions; exact assignment is not critical for the current single-cell prototype
- CAD geometry length unit = **mm**
- MCNP mesh tally length unit = **cm**
- Convert MCNP spatial coordinates to the project/CAD frame using:

  `x_mm = 10 * x_mcnp_cm`

  `y_mm = 10 * y_mcnp_cm`

  `z_mm = 10 * z_mcnp_cm`

Do not silently alter the coordinate frame or units.

## MCNP mesh tally rule — DO NOT CHANGE

MCNP mesh tally is an independent user-defined Cartesian mesh and does **not** conform to CAD/material cell boundaries.

Therefore:

- preserve the original tally mesh;
- do not force mesh voxels to match CAD bodies;
- a tally voxel may overlap multiple MCNP cells/materials;
- treat the tally value as the value associated with that MCNP voxel;
- for raw probe operations, return the actual containing voxel value rather than an invented continuous value;
- any interpolation must be explicitly labeled as interpolated/smoothed and must not replace the raw tally data.

## Current MCNP field

Primary v0.1 field:

- `Total heating (W_cm3)`

Use the existing VTKHDF dataset directly when possible.

## Current representative case

- `V_breeder / (V_breeder + V_multiplier) = 0.326`
- coolant = water
- coolant pressure = `15.5 MPa`
- coolant inlet temperature = `295 °C`
- expected blanket outlet temperature = `325 °C`
- NWL = `134 W/cm² = 1.34 MW/m²`
- TBR ≈ `1.233`
- coolant mass flow = not yet simulated / not yet fixed

Do not invent a physical coolant mass-flow value for production data. If a demo-only value is used, label it clearly as synthetic/demo.

## CAD/body rules

The current STEP geometry contains separate solids for materials/components.

Known body groups:

- Armor: 1
- First Wall: 1
- Pressure Tube: 1
- Pin: 10
- Breeder: 1
- Multiplier: 1
- Coolant: 9
- BSS: 2

Repeated bodies should receive stable internal IDs, e.g.:

- `Pin_01 ... Pin_10`
- `Coolant_01 ... Coolant_09`

Do not rename or merge original engineering bodies without a clear reason.

## v0.1 target

The minimum viable scientific viewer must support:

- loading the blanket CAD;
- loading the MCNP Total Heating VTKHDF;
- MCNP cm → mm coordinate conversion;
- spatial registration of CAD and MCNP mesh;
- CAD opacity control;
- radial Z slice / clipping through the heating field;
- color mapping of `Total heating (W_cm3)`;
- raw voxel probe by position;
- display of representative case metadata;
- local execution from PyCharm / Python.

Scientific correctness and data alignment are more important than visual polish.

## Development priorities

Prefer:

- Python
- VTK
- PyVista
- trame / browser UI
- small, testable modules
- clear separation of I/O, transforms, data models, and UI

Avoid premature migration into Omniverse, Unreal, or Unity.

High-end 3D engines may be added later as a presentation layer after the scientific backend is stable.


## Windows shell restriction — IMPORTANT

This development machine is protected by **AhnLab Safe Transaction**.

AhnLab detects and blocks `powershell.exe` execution used by Codex/PyCharm as a fileless-execution pattern. Therefore, **PowerShell must not be used for this project**.

### Forbidden

Do not invoke, spawn, or generate commands for:

- `powershell.exe`
- `pwsh.exe`
- PowerShell scripts (`*.ps1`)
- PowerShell-specific syntax such as:
  - `$env:VAR=...`
  - `Get-ChildItem`
  - `Set-Location`
  - `Invoke-*`
- shell wrappers that indirectly launch PowerShell

Do not use PowerShell even if it is the default Windows shell.

### Allowed / preferred execution methods

Use, in this order:

1. direct executable invocation where possible;
2. `cmd.exe`;
3. Git Bash when POSIX-style shell syntax is more convenient;
4. direct Python scripts for filesystem or automation tasks.

Prefer commands that call the actual executable directly instead of relying on shell behavior.

Examples:

```cmd
.venv\Scripts\python.exe main.py
```

```cmd
.venv\Scripts\python.exe main.py --viewer --port 8080
```

```cmd
git status
```

```cmd
git branch
```

If an environment variable must be set with Windows `cmd.exe`, use:

```cmd
set PYTHONPATH=src && .venv\Scripts\python.exe -m unittest discover -s tests -v
```

For Git Bash, use:

```bash
PYTHONPATH=src .venv/Scripts/python.exe -m unittest discover -s tests -v
```

Do **not** convert these commands into PowerShell equivalents.

### Codex command-execution policy

Before running any shell command:

1. check that it does not invoke PowerShell directly or indirectly;
2. prefer direct `python.exe`, `git.exe`, or other executable calls;
3. if a shell wrapper is required, use `cmd.exe /c` or Git Bash;
4. if a tool or dependency appears to require PowerShell, stop and report the requirement instead of attempting to run it.

A failed PowerShell command should **not** be retried with different PowerShell flags.

### PyCharm environment assumption

Assume the PyCharm integrated terminal should use either:

- `cmd.exe`, or
- Git Bash

and not PowerShell.

Any instructions provided to the user should follow the same restriction.


## Git workflow

Preferred workflow:

- `main` = stable integrated state
- feature branches for active work
- release/version tags for milestones

Current initial feature branch name:

- `feature/mcnp-cad-viewer`

Version milestones should use tags such as:

- `v0.1.0`
- `v0.2.0`
- `v0.3.0`

Do not create a permanent branch for every release unless there is a maintenance reason.

## Large-file policy

Do not commit large raw simulation outputs to normal Git unless explicitly requested.

Typical files to exclude:

- `*.res`
- `*.h5`
- `*.hdf5`
- `*.vtkhdf`
- `*.cgns`
- raw MCNP runtpe files
- generated result directories
- virtual environments
- IDE caches

Small sample datasets may be stored under `data/sample/` if they are intentionally curated for tests or demos.

## Coding expectations

- inspect the repository before editing;
- preserve existing coordinate and unit conventions;
- avoid hard-coding paths to one workstation;
- use `pathlib`;
- keep configuration in one place;
- add clear error messages for missing data;
- prefer reproducible transformations over manual GUI-only steps;
- document assumptions;
- avoid silently converting or normalizing engineering data;
- add small tests for coordinate conversion, bounds, and field naming where practical.

## Before changing physics/data behavior

Check `docs/PROJECT_CONTEXT.md` and `docs/ROADMAP.md`.

If a requested change conflicts with the conventions in this file, explicitly surface the conflict instead of silently changing behavior.
