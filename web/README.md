# Fusion Blanket Digital Twin Web

Web presentation layer for the Fusion Blanket Twin. This Next.js application lives beside the existing Python/PyVista/trame scientific viewer. It renders derived CAD presentation geometry, obtains scalar predictions from a thin FastAPI adapter around the existing Python twin engine, and can load locally generated MCNP visualization fields.

## Local development

Requirements: Python 3.12 with `requirements.txt` installed, Node.js 20 or newer, npm, and the local 100-case MCNP inputs/workbook under `data/local/`.

Generate the ignored scientific visualization assets from the authoritative local VTKHDF sample:

```cmd
cmd.exe /c "set PYTHONPATH=src&& .venv\Scripts\python.exe scripts\export_web_scientific_field.py"
```

The command writes `public/scientific/generated/reference-mcnp/manifest.json` plus one Float32 payload for each canonical MCNP field. These generated files and the master `data/sample/test.vtkhdf` stay ignored; neither is committed or bundled as source. Then run the two development processes separately from the repository root.

Terminal 1 — Python Twin API:

```cmd
cmd.exe /c "set PYTHONPATH=src&& .venv\Scripts\python.exe -m uvicorn fusion_blanket_twin.api.app:app --host 127.0.0.1 --port 8000"
```

Terminal 2 — Next.js frontend:

Install dependencies once with `cmd.exe /c "cd /d web&& npm install"`, then run:

```cmd
cmd.exe /c "cd /d web&& set NEXT_PUBLIC_TWIN_API_URL=http://127.0.0.1:8000&& npm run dev"
```

Open:

- frontend: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:8000/api/health`
- Swagger UI: `http://127.0.0.1:8000/docs`
- OpenAPI JSON: `http://127.0.0.1:8000/openapi.json`

`NEXT_PUBLIC_TWIN_API_URL` defaults safely to `http://127.0.0.1:8000`. Copy `.env.example` to a local `.env.local` if persistent local configuration is preferred; local environment files remain ignored and must not contain secrets.

## Scalar API

- `GET /api/health` reports API/model readiness, API version, service startup time, and case count without exposing local paths.
- `GET /api/design-domain` reports backend-derived PZ 206 and CZ 301 radius ranges, known DOE levels, and centimetre units.
- `POST /api/predict/scalars` accepts `{"pz_206": number, "cz_301_radius": number}` in MCNP centimetres and returns Total TBR, Li-6 TBR, Li-7 TBR, Multiplying, exact/surrogate provenance, domain/extrapolation status, warning, nearest case, normalized nearest distance, and model metadata.
- `POST /api/geometry/design` accepts the same centimetre design coordinates and returns Python `ParametricCSGGeometryProvider` component surface meshes in project millimetres, with semantic groups, bounds, counts, provenance, generation timing, and cache status.

The FastAPI lifespan constructs the `ScalarPredictionService` once. Requests reuse that service and its fitted degree-3 scalar models. Exact DOE coordinates resolve to simulation values; other accepted coordinates use the existing surrogate, and extrapolation is returned explicitly rather than silently clamped.

## Validation

```cmd
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts both the real Python API and the Next.js development server. Its primary integration path exercises the real `ScalarPredictionService`; the separate offline case intentionally blocks API requests to verify graceful degradation. Scientific-viewer requests use a small deterministic raw-cell fixture in `tests/scientific-field-fixture.ts`, so browser tests do not depend on ignored local VTKHDF exports. Generated test results, HTML reports, screenshots, and traces are ignored.

## Architecture

- `../src/fusion_blanket_twin/api/` is the HTTP-only adapter; scientific prediction logic remains in `ScalarPredictionService` and `CaseRegistry`.
- `src/lib/twin-types.ts` defines typed HTTP and presentation contracts.
- `src/lib/twin-api.ts` is the single configurable native-fetch API client.
- `src/lib/scientific-field.ts` validates and loads the derived rectilinear cell-grid manifest, lazily loads Float32 field arrays, caches loaded arrays, maps X/Y/Z slice positions to raw cells, and computes click-based raw voxel probes.
- `src/lib/mock-twin-state.ts` supplies presentation-only geometry, field-control, and operating-basis state; it does not supply scalar KPIs.
- `src/lib/twin-store.ts` owns local interaction state and the health → domain → initial-prediction lifecycle.
- `src/lib/geometry-api.ts` is the typed client for Python parametric component-mesh responses; geometry is requested on startup and Apply Design, while the store retains the last good assembly during pending/error states.
- `src/lib/blanket-geometry.ts` owns the GLB path, unit adapter, engineering appearances, and source-name-to-semantic-component mapping.
- `src/components/blanket-three-scene.tsx` owns the React Three Fiber scene, GLB lifecycle, camera, picking, and the same-camera scientific slice layer.
- `src/components/` contains the workstation shell, contextual controls, Web CAD viewport, KPI/provenance rail, and plot area.
- `src/components/ui/` contains restrained shadcn-style Radix primitives.

The startup GLB at `public/models/blanket_unit_cell.glb` is a fixed presentation fallback derived from STEP geometry. When the geometry API responds, the viewport replaces it with Python `ParametricCSGGeometryProvider` component meshes in millimetres. Both paths use the same metre-sized Three.js scene scale and camera; the GLB node transforms remain intact. MCNP coordinates are transformed from centimetres to millimetres by the documented ×10 scale with no offset or rotation, then share the same scene scaling and camera as the CAD. The auxiliary chart remains explicitly labeled as a presentation placeholder.

## Interaction scope

- Workspace navigation is functional in the browser.
- Design sliders update local selected values and mark prediction pending; Apply Design requests real scalar KPIs from Python.
- PZ/CZ controls remain pending until Apply Design. Apply Design requests both scalar KPIs and current-family parametric CSG geometry from Python. If that geometry request is unavailable, the fixed representative GLB remains the presentation fallback.
- Neutron Flux, Photon Flux, Neutron Heating, Photon Heating, Total Nuclear Heating, X/Y/Z raw-cell slices, Linear, and Log controls operate on actual MCNP cell data. The Neutronics slice manager supports up to six simultaneous, independently positioned slices, including multiple slices on one axis. Iso-surface remains disabled.
- The viewport uses real GLB presentation geometry with orbit, zoom, pan, picking, Reset Camera, Fit Assembly, and fullscreen behavior.
- View scale defaults to Single Cell. Module Layout V1 adds a geometry-only 28-cell flat-top hexagonal array with stable `R01-C01` cell IDs, fixed pitch derived from the canonical unit-cell outer RAFM bounds, module bounds, cell selection, and a hex occupancy map derived from the same lattice coordinates. The module reuses one loaded single-cell component tree with translated instances; it does not request one geometry response per cell. R02-C05, R04-C05, and R06-C05 are intentionally absent from the occupancy definition.
- Module Layout V1 deliberately defers the external module RAFM envelope, rear manifold, coolant routing, module MCNP/CFX fields, and independent per-cell designs. All cells use one shared PZ/CZ design and the same component visibility and opacity controls.
- Geometry Section View applies a single Three.js clipping plane to the currently displayed CAD source (parametric CSG or GLB fallback). The position range follows that source's millimetre bounds. An amber visual cut-plane marker makes the section location explicit; it is a visual inspection aid rather than an exact material-filled cap, and clipped surfaces remain open because generated cap faces are deferred.
- Semantic selection, visibility, and opacity update the already-loaded scene without reloading the GLB.
- Every displayed slice uses raw containing-voxel cell values without point interpolation. All configured slices share one cached field array, scalar range, scale mode, and colormap. Their Float32 values are documented visualization copies; the Float64 VTKHDF remains authoritative. Log display is visualization-only; zero and nonpositive cells are hidden while raw values remain unchanged.
- Clicking a displayed slice performs a raw FMESH voxel probe by axis-boundary lookup, not ray-testing millions of cells. The probe reports the slice ID/axis, i/j/k, physical cell bounds, center, and all five canonical field values. Probe Layer Center targets the active slice. Nuclear Heating − (Neutron Heating + Photon Heating) is retained as a visually secondary numerical consistency check, not presented as an independent tally.
- The loaded field is one fixed reference MCNP simulation. It never follows PZ/CZ scalar-surrogate design changes and is labeled accordingly.
- The parametric CSG web mesh is functional inspection geometry but remains somewhat faceted/STL-like; presentation-grade boundary-mesh cleanup is deferred.
- Thermal-hydraulics is an explicitly unavailable workspace; no CFX data source is connected.
- Scientific slices and probes remain single-cell reference data. In Module mode, the existing MCNP case `107-E` controls are available immediately and global X/Y/Z planes produce separate valid patches only on intersected module cells. Field arrays and local coordinates remain unchanged; no interpolation bridges cells. The UI labels this `Single-cell reference MCNP field` / `Repeated across module cells for visualization` / `Not a module-scale simulation`. True module-scale MCNP remains future work.
- The viewer also provides optional incoming-neutron and shallow 3D plasma-source presentation overlays in both Single Cell and Module modes. They use one lightweight instanced emitter plus a bounded animated shader volume, localized to the shared emitter bounds. Density, speed, source On/Off, and source intensity are presentation controls only; these effects are explicitly not particle-transport, MCNP-history, or plasma simulations.
- The selected-cell Module reference slice uses a scoped scientific overlay so an internal contour remains visible through the selected cell's opaque CAD. This does not make the module globally transparent and does not change field values or spatial registration.
- Illustrative plots are static and do not expose invented scientific values through hover interactions.

## Production and Vercel

```cmd
npm run build
npm run start
```

For a future production deployment, the frontend requires a reachable Python Twin API configured with `NEXT_PUBLIC_TWIN_API_URL`. The current generated field asset is suitable for a local spike, not a 100-case catalog. Cloud backend deployment, databases, authentication, and object storage remain outside this milestone; larger scientific catalogs should use separate backend/object storage rather than the Vercel source bundle.
