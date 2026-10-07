import { expect, test } from "@playwright/test";

import { installScientificFieldFixture } from "./scientific-field-fixture";

type ScientificPerformanceDiagnostics = {
  sliderInputEvents: number;
  scientificStateUpdates: number;
  moduleIntersectionCalculations: number;
  globalToLocalMappings: number;
  sliceExtractionCalls: number;
  colorMappingCalls: number;
  bufferGeometryCreations: number;
  bufferAttributeAllocations: number;
  scientificComponentRenders: number;
  geometryCacheHits: number;
  geometryCacheMisses: number;
  fieldRequestCount: number;
  renderedPatchCount: number;
  lastInputAtMs: number | null;
  lastRenderAtMs: number | null;
  lastInputToRenderMs: number | null;
};

async function diagnostics(page: Parameters<typeof installScientificFieldFixture>[0]) {
  return page.evaluate(() => ({ ...window.__fusionScientificPerformance })) as Promise<ScientificPerformanceDiagnostics>;
}

async function openModuleNeutronics(page: Parameters<typeof installScientificFieldFixture>[0]) {
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await page.getByTestId("view-scale-module").click();
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-rendered-patch-count", "28");
  await expect.poll(async () => (await diagnostics(page)).renderedPatchCount).toBe(28);
}

test.beforeEach(async ({ page }) => {
  await installScientificFieldFixture(page);
});

test("module raw-layer movement deduplicates extraction and reuses one Z geometry", async ({ page }) => {
  await openModuleNeutronics(page);
  const before = await diagnostics(page);
  expect(before.renderedPatchCount).toBe(28);

  const zSlider = page.getByRole("slider", { name: "Z position" });
  const initialLayer = await page.getByTestId("scientific-field-ready").getAttribute("data-z-layer");
  for (let index = 0; index < 5; index += 1) await zSlider.press("ArrowRight");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-z-layer", initialLayer!);
  const insideLayer = await diagnostics(page);

  expect(insideLayer.sliderInputEvents - before.sliderInputEvents).toBe(5);
  expect(insideLayer.scientificStateUpdates - before.scientificStateUpdates).toBeGreaterThan(0);
  expect(insideLayer.scientificStateUpdates - before.scientificStateUpdates).toBeLessThanOrEqual(5);
  expect(insideLayer.sliceExtractionCalls - before.sliceExtractionCalls).toBe(0);
  expect(insideLayer.colorMappingCalls - before.colorMappingCalls).toBe(0);
  expect(insideLayer.bufferGeometryCreations - before.bufferGeometryCreations).toBe(0);
  expect(insideLayer.bufferAttributeAllocations - before.bufferAttributeAllocations).toBe(0);
  expect(insideLayer.scientificComponentRenders - before.scientificComponentRenders).toBe(0);

  await zSlider.press("End");
  await expect.poll(async () => Number(await page.getByTestId("scientific-slice-slice-1").getAttribute("data-global-slice-position-mm")))
    .toBeCloseTo(Number(await zSlider.getAttribute("aria-valuemax")), 1);
  await expect.poll(async () => (await diagnostics(page)).sliceExtractionCalls).toBe(insideLayer.sliceExtractionCalls + 1);
  const crossedLayer = await diagnostics(page);
  expect(crossedLayer.sliceExtractionCalls - insideLayer.sliceExtractionCalls).toBe(1);
  expect(crossedLayer.colorMappingCalls - insideLayer.colorMappingCalls).toBeGreaterThan(0);
  expect(crossedLayer.renderedPatchCount).toBe(28);

  await zSlider.press("Home");
  await expect.poll(async () => Number(await page.getByTestId("scientific-slice-slice-1").getAttribute("data-global-slice-position-mm")))
    .toBeCloseTo(Number(await zSlider.getAttribute("aria-valuemin")), 1);
  await expect.poll(async () => (await diagnostics(page)).sliceExtractionCalls).toBe(crossedLayer.sliceExtractionCalls + 1);
  const beforeRevisit = await diagnostics(page);
  await zSlider.press("End");
  await expect.poll(async () => Number(await page.getByTestId("scientific-slice-slice-1").getAttribute("data-global-slice-position-mm")))
    .toBeCloseTo(Number(await zSlider.getAttribute("aria-valuemax")), 1);
  await expect.poll(async () => (await diagnostics(page)).geometryCacheHits).toBeGreaterThan(beforeRevisit.geometryCacheHits);
  const revisited = await diagnostics(page);
  expect(revisited.sliceExtractionCalls).toBe(beforeRevisit.sliceExtractionCalls);
  expect(revisited.geometryCacheHits).toBeGreaterThan(beforeRevisit.geometryCacheHits);
  expect(revisited.geometryCacheMisses).toBe(beforeRevisit.geometryCacheMisses);
  expect(revisited.fieldRequestCount).toBe(beforeRevisit.fieldRequestCount);
});

test("module X/Y layers reuse repeated local geometry and keep field data single-loaded", async ({ page }) => {
  const scientificRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/scientific/") && request.url().endsWith(".f32")) scientificRequests.push(request.url());
  });
  await openModuleNeutronics(page);
  const initial = await diagnostics(page);

  await page.getByTestId("axis-x").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-rendered-patch-count", "4");
  const xRendered = await diagnostics(page);
  expect(xRendered.renderedPatchCount).toBe(4);
  expect(xRendered.sliceExtractionCalls - initial.sliceExtractionCalls).toBe(1);
  expect(xRendered.bufferGeometryCreations - initial.bufferGeometryCreations).toBe(3);
  expect(xRendered.geometryCacheHits).toBeGreaterThanOrEqual(initial.geometryCacheHits);

  await page.getByTestId("axis-y").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-rendered-patch-count", "7");
  const yRendered = await diagnostics(page);
  expect(yRendered.renderedPatchCount).toBe(7);
  expect(yRendered.sliceExtractionCalls - xRendered.sliceExtractionCalls).toBe(1);
  expect(yRendered.bufferGeometryCreations - xRendered.bufferGeometryCreations).toBe(3);

  await page.getByTestId("field-selector").selectOption("photon_flux");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "photon_flux");
  await page.getByTestId("field-selector").selectOption("nuclear_heating");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "nuclear_heating");
  await page.getByTestId("field-selector").selectOption("photon_flux");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "photon_flux");
  expect(new Set(scientificRequests).size).toBe(2);
  expect((await diagnostics(page)).fieldRequestCount - initial.fieldRequestCount).toBe(1);
});

test("module slider readout stays responsive while scientific render remains raw-layer based", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openModuleNeutronics(page);

  const zSlider = page.getByRole("slider", { name: "Z position" });
  const before = await zSlider.getAttribute("aria-valuenow");
  await zSlider.press("ArrowRight");
  await zSlider.press("ArrowRight");
  await expect(zSlider).not.toHaveAttribute("aria-valuenow", before!);
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-global-slice-position-mm", /.+/);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("manual range and scale changes invalidate color geometry without duplicating module patches", async ({ page }) => {
  await openModuleNeutronics(page);
  const before = await diagnostics(page);
  await page.getByTestId("scientific-range-manual").click();
  await page.getByTestId("scientific-range-min").fill("10");
  await page.getByTestId("scientific-range-max").fill("20");
  await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range", "10,20");
  await expect.poll(async () => (await diagnostics(page)).geometryCacheMisses).toBeGreaterThan(before.geometryCacheMisses);
  const linear = await diagnostics(page);
  expect(linear.renderedPatchCount).toBe(28);
  expect(linear.sliceExtractionCalls - before.sliceExtractionCalls).toBeLessThanOrEqual(2);

  await page.getByTestId("scientific-range-max").fill("21");
  await expect.poll(async () => (await diagnostics(page)).geometryCacheMisses).toBeGreaterThan(linear.geometryCacheMisses);
  const beforeRevisit = await diagnostics(page);
  await page.getByTestId("scientific-range-max").fill("20");
  await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range", "10,20");
  await expect.poll(async () => (await diagnostics(page)).geometryCacheHits).toBeGreaterThan(beforeRevisit.geometryCacheHits);
  const revisited = await diagnostics(page);
  expect(revisited.sliceExtractionCalls).toBe(beforeRevisit.sliceExtractionCalls);

  await page.getByTestId("log-scale").check();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-scale-mode", "log");
  await expect.poll(async () => (await diagnostics(page)).geometryCacheMisses).toBeGreaterThan(revisited.geometryCacheMisses);
  expect((await diagnostics(page)).renderedPatchCount).toBe(28);
});

test("three Z slices and mixed X/Y/Z slices reuse unique local layers", async ({ page }) => {
  await openModuleNeutronics(page);
  const initial = await diagnostics(page);
  await page.getByTestId("add-scientific-slice").click();
  await page.getByTestId("add-scientific-slice").click();
  await expect.poll(async () => (await diagnostics(page)).renderedPatchCount).toBe(84);
  const threeSameLayer = await diagnostics(page);
  expect(threeSameLayer.sliceExtractionCalls).toBe(initial.sliceExtractionCalls);
  expect(threeSameLayer.bufferGeometryCreations).toBe(initial.bufferGeometryCreations);

  await page.getByTestId("select-scientific-slice-slice-2").click();
  await page.getByTestId("axis-x").click();
  await page.getByTestId("select-scientific-slice-slice-3").click();
  await page.getByTestId("axis-y").click();
  await expect.poll(async () => (await diagnostics(page)).renderedPatchCount).toBe(39);
  const mixedAxes = await diagnostics(page);
  expect(mixedAxes.sliceExtractionCalls - threeSameLayer.sliceExtractionCalls).toBe(2);
  expect(mixedAxes.bufferGeometryCreations - threeSameLayer.bufferGeometryCreations).toBe(6);
  expect(mixedAxes.fieldRequestCount).toBe(initial.fieldRequestCount);
});
