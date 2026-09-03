import { expect, test } from "@playwright/test";

import { installScientificFieldFixture } from "./scientific-field-fixture";

test.beforeEach(async ({ page }) => {
  await installScientificFieldFixture(page);
});

test("every exposed interaction is functional, local-state, or explicitly unavailable", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText ?? "unknown failure"}`);
  });

  let glbResponseStatus: number | null = null;
  await page.route("**/models/blanket_unit_cell.glb", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.route("**/scientific/**/*.f32", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fallback();
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/models/blanket_unit_cell.glb")) glbResponseStatus = response.status();
  });

  await page.goto("/");
  await expect(page).toHaveTitle(/Fusion Blanket Digital Twin/);
  await expect(page.getByRole("heading", { name: "Blanket Unit Cell" })).toBeVisible();
  await expect(page.getByTestId("geometry-loading")).toBeVisible();
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-geometry-source", "parametric-csg");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-primary-geometry-root-count", "1");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-component-count", "26");
  await expect(page.getByTestId("geometry-ready")).not.toHaveAttribute("data-camera-position", "unknown");
  const defaultCameraPosition = (await page.getByTestId("geometry-ready").getAttribute("data-camera-position"))!.split(",").map(Number);
  const defaultCameraTarget = (await page.getByTestId("geometry-ready").getAttribute("data-camera-target"))!.split(",").map(Number);
  expect(defaultCameraPosition[0] - defaultCameraTarget[0]).toBeLessThan(0);
  expect(defaultCameraPosition[1] - defaultCameraTarget[1]).toBeGreaterThan(0);
  expect(defaultCameraPosition[2] - defaultCameraTarget[2]).toBeLessThan(0);
  await expect(page.getByTestId("geometry-group-armor")).toHaveAttribute("data-mesh-count", "1");
  await expect(page.getByTestId("geometry-group-breeder")).toHaveAttribute("data-mesh-count", "1");
  await expect(page.getByTestId("geometry-group-multiplier")).toHaveAttribute("data-mesh-count", "1");
  await expect(page.getByTestId("geometry-group-structure")).toHaveAttribute("data-mesh-count", "6");
  await expect(page.getByTestId("geometry-group-coolant")).toHaveAttribute("data-mesh-count", "1");
  expect(glbResponseStatus).toBe(200);
  await expect(page.getByText("Web CAD Geometry", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Parametric CSG|Fixed GLB derived from STEP/).first()).toBeVisible();
  await expect(page.locator(".geometry-provenance")).toHaveCount(0);
  await expect(page.getByTestId("preview-status")).toHaveCount(0);
  await expect(page.locator(".kpi-grid .kpi > span")).toHaveText(["Total TBR", "Multiplying", "Li-6 TBR", "Li-7 TBR"]);
  await expect(page.getByTestId("kpi-multiplying").locator(".." )).toHaveClass(/kpi-amber/);
  await expect(page.getByTestId("api-status")).toContainText("Twin API · Connected");
  await expect(page.getByTestId("kpi-total-tbr")).not.toHaveText("--");
  await expect(page.getByTestId("scalar-source")).toHaveText("Simulation");

  // The local scientific path exposes its loading state and resolves independently.
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByRole("heading", { name: "Field controls" })).toBeVisible();
  const scientificLoading = page.getByTestId("scientific-loading");
  if (await scientificLoading.count()) await expect(scientificLoading).toContainText(/Loading|Validating/);
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("scientific-status")).toContainText("3D Field · Reference MCNP");
  await expect(page.getByTestId("scientific-scalar-bar")).toBeVisible();
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Total Nuclear Heating");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("W/cm³");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-cell-count", "27");
  await expect(page.getByText("Reference MCNP field", { exact: true }).first()).toBeVisible();
  const canvas = page.locator("canvas");
  const canvasBounds = await canvas.boundingBox();
  if (canvasBounds) {
    await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.55, canvasBounds.y + canvasBounds.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.62, canvasBounds.y + canvasBounds.height * 0.54, { steps: 4 });
    await page.mouse.up();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  await page.getByTestId("nav-overview").click();

  // The real camera actions are enabled and each reports immediate feedback.
  await page.getByTestId("reset-camera").click();
  await page.getByTestId("fit-assembly").click();
  await page.getByTestId("roll-cw").click();
  await page.getByTestId("roll-ccw").click();
  await expect(page.getByTestId("rotate-x-cw")).toHaveCount(0);
  await expect(page.getByTestId("rotate-x-ccw")).toHaveCount(0);

  // Overview -> Design; local slider motion marks the real scalar prediction pending.
  await page.getByTestId("nav-design").click();
  await expect(page.getByRole("heading", { name: "Design variables" })).toBeVisible();
  await expect(page.getByTestId("reset-design")).toBeDisabled();
  await page.getByRole("slider", { name: "PZ 206" }).press("Home");
  await expect(page.getByTestId("pz-206-slider-value")).toContainText("2.60");
  await page.getByRole("slider", { name: "CZ 301 radius" }).press("Home");
  await expect(page.getByTestId("reset-design")).toBeEnabled();
  await expect(page.getByTestId("cz-301-slider-value")).toContainText("3.60");
  await expect(page.getByTestId("prediction-status")).toContainText("Prediction pending");

  await page.route("**/api/predict/scalars", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.getByTestId("apply-design").click();
  await expect(page.getByTestId("prediction-updating")).toContainText("Updating prediction");
  await expect(page.getByTestId("prediction-status")).toContainText("Predicted · PZ 2.60 · CZ 3.60 cm");
  await expect(page.getByTestId("kpi-total-tbr")).toHaveText("1.12856");
  await expect(page.getByTestId("scalar-source")).toHaveText("Simulation");
  await expect(page.getByTestId("nearest-case")).toHaveText("104-A");
  await expect(page.getByText(/Parametric CSG/).first()).toBeVisible();
  await expect(page.getByTestId("design-space-plot")).toBeVisible();
  await expect(page.getByTestId("selected-design-marker")).toBeVisible();
  await expect(page.getByTestId("applied-design-marker")).toBeVisible();
  await expect(page.getByTestId("component-display-controls")).toBeVisible();
  await expect(page.getByTestId("opacity-slider-armor")).toBeVisible();
  await expect(page.getByTestId("opacity-slider-breeder")).toBeVisible();
  await expect(page.getByTestId("opacity-slider-multiplier")).toBeVisible();
  await expect(page.getByTestId("opacity-slider-structure")).toBeVisible();
  await expect(page.getByTestId("opacity-slider-coolant")).toBeVisible();
  await expect(page.getByTestId("opacity-armor")).toHaveText("100%");
  await expect(page.getByTestId("opacity-structure")).toHaveText("100%");

  // An in-domain non-DOE coordinate is served by the real polynomial surrogate.
  for (let index = 0; index < 10; index += 1) await page.getByRole("slider", { name: "PZ 206" }).press("ArrowRight");
  for (let index = 0; index < 20; index += 1) await page.getByRole("slider", { name: "CZ 301 radius" }).press("ArrowRight");
  await expect(page.getByTestId("pz-206-slider-value")).toContainText("3.10");
  await expect(page.getByTestId("cz-301-slider-value")).toContainText("3.80");
  const exactTotalTbr = await page.getByTestId("kpi-total-tbr").textContent();
  await page.getByTestId("roll-cw").click();
  const cameraPositionBeforeApply = await page.getByTestId("geometry-ready").getAttribute("data-camera-position");
  const cameraTargetBeforeApply = await page.getByTestId("geometry-ready").getAttribute("data-camera-target");
  const cameraUpBeforeApply = await page.getByTestId("geometry-ready").getAttribute("data-camera-up");
  await page.getByTestId("apply-design").click();
  await expect(page.getByTestId("scalar-source")).toHaveText("Surrogate Prediction");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-position", cameraPositionBeforeApply!);
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-target", cameraTargetBeforeApply!);
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-up", cameraUpBeforeApply!);
  await expect(page.getByTestId("kpi-total-tbr")).not.toHaveText(exactTotalTbr ?? "1.12856");

  // Design -> Neutronics; all five fields and X/Y/Z raw-cell slices are real.
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByRole("heading", { name: "Field controls" })).toBeVisible();
  await expect(page.getByTestId("field-selector")).toBeEnabled();
  await expect(page.getByTestId("field-selector")).toHaveValue("nuclear_heating");
  await expect(page.getByTestId("viewport-state")).toContainText("Total Nuclear Heating");
  await expect(page.getByTestId("mode-iso-surface")).toBeDisabled();
  await expect(page.getByTestId("axis-x")).toBeEnabled();
  await expect(page.getByTestId("axis-y")).toBeEnabled();
  await expect(page.getByTestId("axis-z")).toBeEnabled();
  await expect(page.getByTestId("log-scale")).toBeEnabled();

  const options = await page.getByTestId("field-selector").locator("option").allTextContents();
  expect(options).toEqual(["Neutron Flux", "Photon Flux", "Neutron Heating", "Photon Heating", "Total Nuclear Heating"]);
  await page.getByTestId("field-selector").selectOption("photon_flux");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "photon_flux");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Photon Flux");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("n/cm²/s");
  await page.getByTestId("log-scale").check();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-scale-mode", "log");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Log");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Zero / nonpositive");
  await expect(page.getByTestId("scientific-display-controls")).toBeVisible();
  await expect(page.getByTestId("scientific-slice-opacity-slider")).toBeVisible();
  const scalarDomain = await page.getByTestId("scientific-field-ready").getAttribute("data-scalar-domain");
  expect(scalarDomain).not.toContain("Infinity");
  expect(scalarDomain).not.toContain("NaN");
  await page.getByTestId("log-scale").uncheck();
  await page.getByTestId("field-selector").selectOption("nuclear_heating");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "nuclear_heating");

  const initialLayer = await page.getByTestId("scientific-field-ready").getAttribute("data-z-layer");
  const initialBounds = await page.getByTestId("scientific-field-ready").getAttribute("data-z-layer-bounds");
  await page.getByRole("slider", { name: "Z position" }).press("End");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-z-layer", initialLayer ?? "");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-z-layer-bounds", initialBounds ?? "");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Z layer");

  await page.getByTestId("axis-x").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-axis", "X");
  await expect(page.getByRole("slider", { name: "X position" })).toBeVisible();
  const xLayer = await page.getByTestId("scientific-field-ready").getAttribute("data-layer");
  await page.getByRole("slider", { name: "X position" }).press("Home");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-layer", xLayer ?? "");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("X layer");

  await page.getByTestId("axis-y").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-axis", "Y");
  await expect(page.getByRole("slider", { name: "Y position" })).toBeVisible();
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Y layer");

  await page.getByTestId("probe-layer-center").click();
  await expect(page.getByTestId("probe-indices")).toContainText(/i \d+ · j \d+ · k \d+/, { timeout: 15_000 });
  await expect(page.getByTestId("probe-panel")).toContainText("Neutron Flux");
  await expect(page.getByTestId("probe-panel")).toContainText("Photon Flux");
  await expect(page.getByTestId("probe-panel")).toContainText("Neutron Heating");
  await expect(page.getByTestId("probe-panel")).toContainText("Photon Heating");
  await expect(page.getByTestId("probe-panel")).toContainText("Total Nuclear Heating");
  await expect(page.getByTestId("probe-panel")).not.toContainText("Heating closure");
  await expect(page.getByTestId("heating-consistency")).toContainText("Heating consistency");
  await expect(page.getByTestId("heating-consistency")).toContainText("Residual:");
  await expect(page.getByTestId("heating-consistency")).toHaveAttribute(
    "title",
    "Numerical consistency check: Nuclear Heating - (Neutron Heating + Photon Heating)",
  );
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-probe-ms", "unknown");

  await page.getByTestId("axis-z").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-axis", "Z");
  await expect(page.getByRole("slider", { name: "Z position" })).toBeVisible();

  await page.getByTestId("mode-off").click();
  await expect(page.getByTestId("scientific-scalar-bar")).toBeHidden();
  await expect(page.getByTestId("probe-panel")).toContainText("Click the active slice");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "false");
  await expect(page.getByTestId("geometry-ready")).toBeAttached();
  await page.getByTestId("mode-slice").click();
  await expect(page.getByTestId("scientific-scalar-bar")).toBeVisible();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "true");
  await expect(page.getByText("Reference MCNP field", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("scalar-source")).toHaveText("Surrogate Prediction");

  // Component selection and visibility update both the preview and selected-component panel.
  await page.getByTestId("component-armor").click();
  await expect(page.getByTestId("selected-component-name")).toHaveText("Armor");
  await page.getByTestId("visibility-armor").click();
  await expect(page.getByTestId("visibility-armor")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("geometry-group-armor")).toHaveAttribute("data-visible", "false");
  await expect(page.locator(".selected-section")).toContainText("Hidden");
  await page.getByTestId("visibility-armor").click();
  await expect(page.getByTestId("geometry-group-armor")).toHaveAttribute("data-visible", "true");
  await page.getByTestId("component-breeder").click();
  await expect(page.getByTestId("selected-component-name")).toHaveText("Breeder");
  await expect(page.getByTestId("geometry-group-breeder")).toHaveAttribute("data-selected", "true");
  await page.getByTestId("component-opacity").press("Home");
  await expect(page.getByTestId("component-opacity-value")).toHaveText("15%");

  // Thermal-hydraulics is a navigable unavailable state, not a fake loaded workspace.
  await page.getByTestId("nav-thermal-hydraulics").click();
  await expect(page.getByText("CFX dataset not connected", { exact: true })).toBeVisible();
  await expect(page.locator(".disabled-field[aria-disabled='true']")).toHaveCount(4);

  await page.getByTestId("nav-performance").click();
  await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
  await expect(page.getByText("Illustrative DOE trend", { exact: true })).toBeVisible();
  await page.getByTestId("nav-overview").click();
  await expect(page.getByRole("heading", { name: "Twin overview" })).toBeVisible();

  expect(consoleErrors, `browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  expect(failedRequests, `failed network requests:\n${failedRequests.join("\n")}`).toEqual([]);
});

test("a missing geometry asset fails clearly without crashing the workspace", async ({ page }) => {
  await page.route("**/models/blanket_unit_cell.glb", (route) => route.abort("failed"));
  await page.route("**/api/geometry/design", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByTestId("geometry-error")).toContainText("Blanket geometry asset unavailable");
  await expect(page.getByTestId("reset-camera")).toBeDisabled();
  await expect(page.getByTestId("nav-design")).toBeEnabled();
});

test("reports lightweight real scientific load and interaction timings", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-scalar-bar")).toBeVisible();
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-render-ms", "unknown");
  const beforeLayer = await page.getByTestId("scientific-field-ready").getAttribute("data-z-layer");
  await page.getByRole("slider", { name: "Z position" }).press("Home");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-z-layer", beforeLayer ?? "");
  await page.getByTestId("field-selector").selectOption("neutron_flux");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "neutron_flux");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-field-switch-ms", "unknown");
  await page.getByTestId("field-selector").selectOption("nuclear_heating");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "nuclear_heating");
  await page.getByTestId("axis-x").click();
  await page.getByRole("slider", { name: "X position" }).press("End");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-axis", "X");
  await page.getByTestId("axis-y").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-axis", "Y");
  await page.getByTestId("probe-layer-center").click();
  await expect(page.getByTestId("probe-indices")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("slider", { name: "Y position" }).press("End");
  await page.getByTestId("axis-z").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-axis", "Z");
  const measureFrameCadence = () => page.evaluate(() => new Promise<{ meanMs: number; maxMs: number }>((resolve) => {
    const intervals: number[] = [];
    let previous = performance.now();
    const sample = (now: number) => {
      intervals.push(now - previous);
      previous = now;
      if (intervals.length === 20) resolve({
        meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
        maxMs: Math.max(...intervals),
      });
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const sliceFrameCadence = await measureFrameCadence();
  await page.getByTestId("mode-off").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "false");
  const cadOnlyFrameCadence = await measureFrameCadence();
  const metrics = await page.getByTestId("scientific-field-ready").evaluate((element) => ({
    metadataMs: element.getAttribute("data-metadata-ms"),
    geometryValidationMs: element.getAttribute("data-geometry-validation-ms"),
    scalarDownloadMs: element.getAttribute("data-scalar-download-ms"),
    scalarParseMs: element.getAttribute("data-scalar-parse-ms"),
    totalMs: element.getAttribute("data-load-ms"),
    firstRenderMs: element.getAttribute("data-render-ms"),
    sliceUpdateMs: element.getAttribute("data-slice-update-ms"),
    fieldSwitchMs: element.getAttribute("data-field-switch-ms"),
    probeMs: element.getAttribute("data-probe-ms"),
  }));
  const cadenceRatio = sliceFrameCadence.meanMs / cadOnlyFrameCadence.meanMs;
  console.log("SCIENTIFIC_PERFORMANCE", { ...metrics, sliceFrameCadence, cadOnlyFrameCadence, cadenceRatio });
  expect(cadenceRatio).toBeLessThan(1.5);
});

test("an unavailable Python API does not crash or disable the Web CAD viewport", async ({ page }) => {
  await page.route("http://127.0.0.1:8000/api/**", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByTestId("api-status")).toContainText("Twin API · Offline");
  await expect(page.getByTestId("prediction-error")).toContainText("Twin API is unavailable");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Total Nuclear Heating");
  await expect(page.getByTestId("reset-camera")).toBeEnabled();
  await page.getByTestId("reset-camera").click();
  await expect(page.getByTestId("geometry-ready")).toBeAttached();
});

test("a missing selected field file reports that field without disabling cached fields", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/scientific/**/photon_flux.f32", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Total Nuclear Heating");
  await page.getByTestId("field-selector").selectOption("photon_flux");
  await expect(page.getByTestId("scientific-error")).toContainText("Photon Flux scalar request failed");
  await expect(page.getByTestId("reset-camera")).toBeEnabled();
  await page.getByTestId("field-selector").selectOption("nuclear_heating");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "nuclear_heating");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Total Nuclear Heating");
  expect(
    consoleErrors.filter((message) => !message.includes("404") && !message.includes("Not Found")),
    `browser console errors:\n${consoleErrors.join("\n")}`,
  ).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("a missing scientific asset does not crash the real GLB or Twin API", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/scientific/**/manifest.json", (route) => route.fulfill({ status: 204 }));
  await page.goto("/");
  await expect(page.getByTestId("api-status")).toContainText("Twin API · Connected");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-error")).toContainText("Scientific field asset unavailable");
  await expect(page.getByTestId("scientific-error")).toContainText("CAD and scalar Twin API remain independent");
  await expect(page.getByTestId("reset-camera")).toBeEnabled();
  await page.getByTestId("reset-camera").click();
  await expect(page.getByTestId("geometry-ready")).toBeAttached();
  expect(consoleErrors, `browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("the scientific slice manager supports independent multi-axis and same-axis raw-cell slices", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-slice-manager")).toBeVisible();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "1");
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-slice-axis", "Z");

  await page.getByTestId("add-scientific-slice").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "2");
  await expect(page.getByTestId("scientific-slice-slice-2")).toHaveAttribute("data-slice-axis", "Z");
  await expect(page.getByTestId("scientific-slice-row-slice-2")).toHaveClass(/is-active/);

  const rowOne = page.getByTestId("scientific-slice-row-slice-1");
  const rowTwo = page.getByTestId("scientific-slice-row-slice-2");
  await rowOne.getByTestId("scientific-slice-slice-1-axis-y").click();
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-slice-axis", "Y");
  await expect(page.getByTestId("scientific-slice-slice-2")).toHaveAttribute("data-slice-axis", "Z");
  await rowTwo.getByRole("slider", { name: "slice-2 position" }).press("End");
  const rowOneCenter = await page.getByTestId("scientific-slice-slice-1").getAttribute("data-slice-center-mm");
  await expect(page.getByTestId("scientific-slice-slice-2")).not.toHaveAttribute("data-slice-center-mm", rowOneCenter ?? "");

  await page.getByTestId("add-scientific-slice").click();
  const rowThree = page.getByTestId("scientific-slice-row-slice-3");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "3");
  await rowThree.getByTestId("scientific-slice-slice-3-axis-x").click();
  await expect(page.getByTestId("scientific-slice-slice-3")).toHaveAttribute("data-slice-axis", "X");
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-slice-axis", "Y");
  await expect(page.getByTestId("scientific-slice-slice-2")).toHaveAttribute("data-slice-axis", "Z");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible-slice-count", "3");

  await rowTwo.getByTestId("scientific-slice-slice-2-axis-z").click();
  await rowThree.getByTestId("scientific-slice-slice-3-axis-z").click();
  const sliceThreeCenter = await page.getByTestId("scientific-slice-slice-3").getAttribute("data-slice-center-mm");
  await rowTwo.getByRole("slider", { name: "slice-2 position" }).press("Home");
  await expect(page.getByTestId("scientific-slice-slice-3")).toHaveAttribute("data-slice-center-mm", sliceThreeCenter ?? "");
  await rowTwo.getByTestId("remove-scientific-slice-slice-2").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "2");
  await expect(page.getByTestId("scientific-slice-slice-2")).toHaveCount(0);
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveCount(1);
  await expect(page.getByTestId("scientific-slice-slice-3")).toHaveCount(1);

  await page.getByTestId("scientific-slice-visible-slice-1").uncheck();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible-slice-count", "1");
  await page.getByTestId("mode-off").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "false");
  await page.getByTestId("mode-slice").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "true");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "2");

  await rowThree.getByTestId("select-scientific-slice-slice-3").click();
  await expect(rowThree).toHaveClass(/is-active/);
  await rowThree.getByTestId("scientific-slice-slice-3-axis-x").click();
  await page.getByTestId("probe-layer-center").click();
  await expect(page.getByTestId("probe-indices")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("probe-panel")).toContainText("slice-3 · X");

  await page.getByTestId("field-selector").selectOption("photon_flux");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "photon_flux");
  await page.getByTestId("log-scale").check();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-scale-mode", "log");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("1 visible slice");
  await expect(page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).resolves.toBeLessThanOrEqual(0);
  expect(consoleErrors, `browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("design, section, camera, opacity, and multi-slice state remain compatible", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await page.getByTestId("add-scientific-slice").click();
  await page.getByTestId("scientific-slice-slice-1-axis-y").click();
  await page.getByTestId("field-selector").selectOption("photon_flux");
  await page.getByTestId("log-scale").check();
  await page.getByTestId("section-view-toggle").check();
  await page.getByTestId("opacity-slider-breeder").press("Home");
  await page.getByTestId("roll-cw").click();
  const cameraPosition = await page.getByTestId("geometry-ready").getAttribute("data-camera-position");
  const cameraTarget = await page.getByTestId("geometry-ready").getAttribute("data-camera-target");

  await page.getByTestId("nav-design").click();
  await page.getByRole("slider", { name: "PZ 206" }).press("Home");
  await page.getByTestId("apply-design").click();
  await expect(page.getByTestId("prediction-status")).toContainText("Predicted · PZ 2.60");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-enabled", "true");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-position", cameraPosition ?? "");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-target", cameraTarget ?? "");

  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "2");
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-slice-axis", "Y");
  await expect(page.getByTestId("scientific-slice-slice-2")).toHaveAttribute("data-slice-axis", "Z");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "photon_flux");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-scale-mode", "log");
  await expect(page.getByTestId("scientific-scalar-bar")).toBeVisible();
  await expect(page.getByTestId("opacity-breeder")).toHaveText("15%");
  await expect(page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).resolves.toBeLessThanOrEqual(0);
  expect(consoleErrors, `browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("geometry section view clips CAD independently from the scientific slice", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("section-view-controls")).toBeVisible();
  await expect(page.getByTestId("section-view-toggle")).not.toBeChecked();
  await expect(page.getByTestId("section-axis-z")).toHaveAttribute("data-state", "on");

  const cameraBefore = await page.getByTestId("geometry-ready").getAttribute("data-camera-position");
  const fieldPositionBefore = await page.getByTestId("scientific-field-ready").getAttribute("data-position-mm");
  const sectionSlider = page.getByRole("slider", { name: "Section position" });
  expect(Number(await sectionSlider.getAttribute("aria-valuemin"))).toBeLessThan(Number(await sectionSlider.getAttribute("aria-valuemax")));

  await page.getByTestId("section-view-toggle").check();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-enabled", "true");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-clipping-plane-count", "1");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-plane-visible", "true");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-material-policy", "component-opacity-controlled");

  await page.getByTestId("section-axis-x").click();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-axis", "X");
  await expect(page.getByTestId("section-position-value")).toContainText("mm");
  const xMinimum = await sectionSlider.getAttribute("aria-valuemin");
  await page.getByRole("slider", { name: "Section position" }).press("Home");
  const xPosition = await page.getByTestId("geometry-ready").getAttribute("data-section-position-mm");
  expect(Number(xPosition)).toBeCloseTo(Number(xMinimum), 2);

  await page.getByTestId("section-axis-y").click();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-axis", "Y");
  await page.getByRole("slider", { name: "Section position" }).press("End");
  const yPosition = await page.getByTestId("geometry-ready").getAttribute("data-section-position-mm");
  expect(Number(yPosition)).toBeCloseTo(Number(await page.getByRole("slider", { name: "Section position" }).getAttribute("aria-valuemax")), 2);

  await page.getByTestId("section-axis-z").click();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-axis", "Z");
  await page.getByTestId("section-flip").check();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-flip", "true");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-clipping-plane-count", "1");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-position", cameraBefore!);

  await page.getByTestId("opacity-slider-breeder").press("Home");
  await expect(page.getByTestId("geometry-group-breeder")).toHaveAttribute("data-visible", "true");

  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-scalar-bar")).toBeVisible();
  await page.getByTestId("section-axis-x").click();
  await page.getByRole("slider", { name: "Section position" }).press("End");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-axis", "X");
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-position-mm", fieldPositionBefore!);
  await page.getByTestId("mode-off").click();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "false");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-enabled", "true");

  await page.getByTestId("section-view-toggle").uncheck();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-clipping-plane-count", "0");
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-plane-visible", "false");
  expect(consoleErrors, `browser console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("geometry section view remains available on the GLB fallback", async ({ page }) => {
  await page.route("**/api/geometry/design", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-geometry-source", "glb");
  await expect(page.getByTestId("section-view-controls")).toBeVisible();
  await page.getByTestId("section-view-toggle").check();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-clipping-plane-count", "1");
  await page.getByTestId("section-axis-y").click();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-section-axis", "Y");
  await expect(page.getByTestId("reset-camera")).toBeEnabled();
});

test("geometry section interactions preserve page and canvas layout", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });

  const readLayout = () => page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="geometry-viewport"]')?.getBoundingClientRect();
    const canvas = document.querySelector("canvas")?.getBoundingClientRect();
    if (!viewport || !canvas) throw new Error("Geometry viewport or canvas is missing");
    return {
      scrollY: window.scrollY,
      viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      viewportBottom: viewport.bottom,
      innerHeight: window.innerHeight,
    };
  });
  const initial = await readLayout();
  const expectStableLayout = async () => {
    const next = await readLayout();
    expect(next.scrollY).toBe(initial.scrollY);
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(next.viewport[key] - initial.viewport[key])).toBeLessThan(1);
      expect(Math.abs(next.canvas[key] - initial.canvas[key])).toBeLessThan(1);
    }
    expect(next.viewportBottom).toBeLessThanOrEqual(next.innerHeight + 1);
  };

  const sectionToggle = page.getByTestId("section-view-toggle");
  const sectionFlip = page.getByTestId("section-flip");
  const sectionPosition = page.getByTestId("section-position");
  const cameraBefore = await page.getByTestId("geometry-ready").getAttribute("data-camera-position");

  await sectionToggle.check();
  await expectStableLayout();
  await sectionFlip.check();
  await expectStableLayout();
  await sectionPosition.press("Home");
  await expectStableLayout();
  await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-camera-position", cameraBefore ?? "");
});

test("the engineering workspace remains readable and unclipped at target desktop resolutions", async ({ page }) => {
  const resolutions = [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  for (const resolution of resolutions) {
    await page.setViewportSize(resolution);
    await page.goto("/");
    await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
    await expect(page.locator(".geometry-provenance")).toHaveCount(0);

    const viewport = page.getByTestId("geometry-viewport");
    const viewportBox = await viewport.boundingBox();
    expect(viewportBox?.width).toBeGreaterThan(500);
    await expect(page.getByTestId("kpi-total-tbr")).toBeVisible();
    await expect(page.getByTestId("component-display-controls")).toBeVisible();
    await expect(page.getByTestId("section-view-controls")).toBeVisible();
    for (const component of ["armor", "breeder", "multiplier", "structure", "coolant"]) {
      await expect(page.getByTestId(`opacity-slider-${component}`)).toBeVisible();
    }

    for (const section of ["overview", "design", "neutronics", "thermal-hydraulics", "performance"]) {
      await page.getByTestId(`nav-${section}`).click();
      await expect(page.getByTestId("control-panel")).toBeVisible();
    }

    await page.getByTestId("nav-neutronics").click();
    await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Total Nuclear Heating");
    await expect(page.getByTestId("scientific-scalar-bar")).toContainText("W/cm³");
    await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Zero / nonpositive");
    await expect(page.getByTestId("scientific-display-controls")).toBeVisible();
    await expect(page.getByTestId("scientific-slice-opacity-slider")).toBeVisible();

    const readability = await page.evaluate(() => {
      const fontSize = (selector: string) => Number.parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
      return {
        body: fontSize("body"),
        nav: fontSize(".nav-text"),
        metric: fontSize(".metric-row > span"),
        scalarTick: fontSize(".scalar-ticks"),
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(readability.body).toBeGreaterThanOrEqual(14);
    expect(readability.nav).toBeGreaterThanOrEqual(13);
    expect(readability.metric).toBeGreaterThanOrEqual(12);
    expect(readability.scalarTick).toBeGreaterThanOrEqual(12);
    expect(readability.horizontalOverflow).toBeLessThanOrEqual(0);
  }
});
