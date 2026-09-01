# Fusion Blanket Digital Twin Web

Web presentation layer for the Fusion Blanket Twin. This Next.js application lives beside the existing Python/PyVista/trame scientific viewer. It renders derived CAD presentation geometry, obtains scalar predictions from a thin FastAPI adapter around the existing Python twin engine, and can load one locally generated MCNP Total Nuclear Heating visualization field.

## Local development

Requirements: Python 3.12 with `requirements.txt` installed, Node.js 20 or newer, npm, and the local 100-case MCNP inputs/workbook under `data/local/`.

Generate the ignored scientific visualization asset from the authoritative local VTKHDF sample:

```cmd
set PYTHONPATH=src&& .venv\Scripts\python.exe scripts\export_web_scientific_field.py
```

The command writes `public/scientific/generated/reference-mcnp/nuclear-heating/manifest.json` and `values.f32`. These generated files and the master `data/sample/test.vtkhdf` stay ignored; neither is committed or bundled as source. Then run the two development processes separately from the repository root.

Terminal 1 — Python Twin API:

```cmd
set PYTHONPATH=src&& .venv\Scripts\python.exe -m uvicorn fusion_blanket_twin.api.app:app --host 127.0.0.1 --port 8000 --reload
```

Terminal 2 — Next.js frontend:

```cmd
cd web
npm install
set NEXT_PUBLIC_TWIN_API_URL=http://127.0.0.1:8000
npm run dev
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

The FastAPI lifespan constructs the `ScalarPredictionService` once. Requests reuse that service and its fitted degree-3 scalar models. Exact DOE coordinates resolve to simulation values; other accepted coordinates use the existing surrogate, and extrapolation is returned explicitly rather than silently clamped.

## Validation

```cmd
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts both the real Python API and the Next.js development server. Its primary integration path exercises the real `ScalarPredictionService`; the separate offline case intentionally blocks API requests to verify graceful degradation. Generated test results, HTML reports, screenshots, and traces are ignored.

## Architecture

- `../src/fusion_blanket_twin/api/` is the HTTP-only adapter; scientific prediction logic remains in `ScalarPredictionService` and `CaseRegistry`.
- `src/lib/twin-types.ts` defines typed HTTP and presentation contracts.
- `src/lib/twin-api.ts` is the single configurable native-fetch API client.
- `src/lib/scientific-field.ts` validates and loads the derived rectilinear cell-grid manifest and Float32 visualization array.
- `src/lib/mock-twin-state.ts` supplies presentation-only geometry, field-control, and operating-basis state; it does not supply scalar KPIs.
- `src/lib/twin-store.ts` owns local interaction state and the health → domain → initial-prediction lifecycle.
- `src/lib/blanket-geometry.ts` owns the GLB path, unit adapter, engineering appearances, and source-name-to-semantic-component mapping.
- `src/components/blanket-three-scene.tsx` owns the React Three Fiber scene, GLB lifecycle, camera, picking, and the same-camera scientific slice layer.
- `src/components/` contains the workstation shell, contextual controls, Web CAD viewport, KPI/provenance rail, and plot area.
- `src/components/ui/` contains restrained shadcn-style Radix primitives.

The blanket geometry at `public/models/blanket_unit_cell.glb` is a web presentation derivative of STEP geometry. Its numeric coordinates are millimetres and are normalized once to metre-sized Three.js scene units in `blanket-geometry.ts`; the GLB node transforms remain intact. MCNP coordinates are transformed from centimetres to millimetres by the documented ×10 scale with no offset or rotation, then share the same scene scaling and camera as the CAD. The auxiliary chart remains explicitly labeled as a presentation placeholder.

## Interaction scope

- Workspace navigation is functional in the browser.
- Design sliders update local selected values and mark prediction pending; Apply Design requests real scalar KPIs from Python.
- The PZ/CZ design state and scalar prediction state are distinct from the fixed representative GLB. Changing design values does not deform the displayed CAD.
- Total Nuclear Heating, Z Slice, Z position, and Linear display controls operate on actual MCNP cell data. X/Y, iso-surface, and logarithmic display remain disabled.
- The viewport uses real GLB presentation geometry with orbit, zoom, pan, picking, Reset Camera, Fit Assembly, and fullscreen behavior.
- Semantic selection, visibility, and opacity update the already-loaded scene without reloading the GLB.
- The displayed slice uses raw containing-voxel cell values without point interpolation. Its Float32 values are a documented visualization copy; the Float64 VTKHDF remains authoritative.
- The loaded field is one fixed reference MCNP simulation. It never follows PZ/CZ scalar-surrogate design changes and is labeled accordingly.
- Thermal-hydraulics is an explicitly unavailable workspace; no CFX data source is connected.
- Illustrative plots are static and do not expose invented scientific values through hover interactions.

## Production and Vercel

```cmd
npm run build
npm run start
```

For a future production deployment, the frontend requires a reachable Python Twin API configured with `NEXT_PUBLIC_TWIN_API_URL`. The current generated field asset is suitable for a local spike, not a 100-case catalog. Cloud backend deployment, databases, authentication, and object storage remain outside this milestone; larger scientific catalogs should use separate backend/object storage rather than the Vercel source bundle.
