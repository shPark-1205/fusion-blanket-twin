# Fusion Blanket Digital Twin Web

Web presentation layer for the Fusion Blanket Twin. This Next.js application lives beside the existing Python/PyVista/trame scientific viewer. It renders derived CAD presentation geometry but does not load or replace scientific datasets.

## Local development

Requirements: Node.js 20 or newer and npm.

```cmd
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Validation

```cmd
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright starts the development server automatically for the smoke test. Generated test results, HTML reports, screenshots, and traces are ignored.

## Architecture

- `src/lib/twin-types.ts` defines lightweight contracts for future backend responses.
- `src/lib/mock-twin-state.ts` is the single presentation data source.
- `src/lib/twin-store.ts` owns local interaction state.
- `src/lib/blanket-geometry.ts` owns the GLB path, unit adapter, engineering appearances, and source-name-to-semantic-component mapping.
- `src/components/blanket-three-scene.tsx` owns the React Three Fiber scene, GLB lifecycle, camera, picking, and in-place mesh updates.
- `src/components/` contains the workstation shell, contextual controls, Web CAD viewport, KPI/provenance rail, and plot area.
- `src/components/ui/` contains restrained shadcn-style Radix primitives.

The blanket geometry at `public/models/blanket_unit_cell.glb` is a web presentation derivative of STEP geometry. Its numeric coordinates are millimetres and are normalized once to metre-sized Three.js scene units in `blanket-geometry.ts`; the GLB node transforms remain intact. The auxiliary chart is still explicitly labeled as a presentation placeholder. Neither surface colors nor chart shapes are scientific contours or simulation values.

## Interaction scope

- Workspace navigation is functional in the browser.
- Design, field-display, slice-status, scale, component-selection, visibility, and opacity controls update local presentation state only.
- The viewport uses real GLB presentation geometry with orbit, zoom, pan, picking, Reset Camera, Fit Assembly, and fullscreen behavior.
- Semantic selection, visibility, and opacity update the already-loaded scene without reloading the GLB.
- Scientific section/clipping remains visibly unavailable. No flux, heating, slice, iso-surface, or voxel values are rendered on the CAD.
- Thermal-hydraulics is an explicitly unavailable workspace; no CFX data source is connected.
- Illustrative plots are static and do not expose invented scientific values through hover interactions.

## Production and Vercel

```cmd
npm run build
npm run start
```

For a future Vercel project, select `web` as the root directory and use the detected Next.js defaults. No credentials, environment variables, backend API, or scientific data assets are required for this milestone. Future backend endpoints should be supplied through environment variables rather than committed configuration.
