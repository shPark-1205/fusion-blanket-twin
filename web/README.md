# Fusion Blanket Digital Twin Web

Presentation-layer prototype for the Fusion Blanket Twin. This Next.js application lives beside the existing Python/PyVista/trame scientific viewer and does not load or replace scientific datasets.

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
- `src/components/` contains the workstation shell, contextual controls, viewport placeholder, KPI/provenance rail, and plot area.
- `src/components/ui/` contains restrained shadcn-style Radix primitives.

The viewport schematic and chart shapes are explicitly labeled presentation placeholders. They are not scientific contours or simulation values.

## Interaction scope

- Workspace navigation is functional in the browser.
- Design, field-display, slice-status, scale, component-selection, and visibility controls update local presentation state only.
- The geometry preview is a conceptual layered cross-section, not CAD or scientific 3D rendering.
- Camera, fit, scientific section-plane, 3D layer, and fullscreen tools are visibly disabled until scientific 3D integration exists.
- Thermal-hydraulics is an explicitly unavailable workspace; no CFX data source is connected.
- Illustrative plots are static and do not expose invented scientific values through hover interactions.

## Production and Vercel

```cmd
npm run build
npm run start
```

For a future Vercel project, select `web` as the root directory and use the detected Next.js defaults. No credentials, environment variables, backend API, or large data assets are required for this milestone. Future backend endpoints should be supplied through environment variables rather than committed configuration.
