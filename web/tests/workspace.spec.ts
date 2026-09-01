import { expect, test } from "@playwright/test";

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
  await page.route("**/scientific/**/values.f32", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/models/blanket_unit_cell.glb")) glbResponseStatus = response.status();
  });

  await page.goto("/");
  await expect(page).toHaveTitle(/Fusion Blanket Digital Twin/);
  await expect(page.getByRole("heading", { name: "Blanket Unit Cell" })).toBeVisible();
  await expect(page.getByTestId("geometry-loading")).toBeVisible();
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await expect(page.getByTestId("geometry-group-armor")).toHaveAttribute("data-mesh-count", "1");
  await expect(page.getByTestId("geometry-group-breeder")).toHaveAttribute("data-mesh-count", "1");
  await expect(page.getByTestId("geometry-group-multiplier")).toHaveAttribute("data-mesh-count", "1");
  await expect(page.getByTestId("geometry-group-structure")).toHaveAttribute("data-mesh-count", "6");
  await expect(page.getByTestId("geometry-group-coolant")).toHaveAttribute("data-mesh-count", "1");
  expect(glbResponseStatus).toBe(200);
  await expect(page.getByText("Web CAD Geometry", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("GLB derived from STEP", { exact: true }).first()).toBeVisible();
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
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-cell-count", "1172380");
  await expect(page.getByText("Loaded MCNP Simulation", { exact: true }).first()).toBeVisible();
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
  await expect(page.getByTestId("preview-status")).toContainText("Camera reset to engineering view");
  await page.getByTestId("fit-assembly").click();
  await expect(page.getByTestId("preview-status")).toContainText("Assembly fitted to viewport");

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
  await expect(page.getByTestId("preview-status")).toContainText("CAD fixed");

  // An in-domain non-DOE coordinate is served by the real polynomial surrogate.
  for (let index = 0; index < 10; index += 1) await page.getByRole("slider", { name: "PZ 206" }).press("ArrowRight");
  for (let index = 0; index < 20; index += 1) await page.getByRole("slider", { name: "CZ 301 radius" }).press("ArrowRight");
  await expect(page.getByTestId("pz-206-slider-value")).toContainText("3.10");
  await expect(page.getByTestId("cz-301-slider-value")).toContainText("3.80");
  const exactTotalTbr = await page.getByTestId("kpi-total-tbr").textContent();
  await page.getByTestId("apply-design").click();
  await expect(page.getByTestId("scalar-source")).toHaveText("Surrogate Prediction");
  await expect(page.getByTestId("kpi-total-tbr")).not.toHaveText(exactTotalTbr ?? "1.12856");

  // Design -> Neutronics; only the real Nuclear Heating Z-slice controls are active.
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByRole("heading", { name: "Field controls" })).toBeVisible();
  await expect(page.getByTestId("field-selector")).toBeDisabled();
  await expect(page.getByTestId("field-selector")).toHaveValue("nuclear_heating");
  await expect(page.getByTestId("viewport-state")).toContainText("Total Nuclear Heating");
  await expect(page.getByTestId("mode-iso-surface")).toBeDisabled();
  await expect(page.getByTestId("axis-x")).toBeDisabled();
  await expect(page.getByTestId("axis-y")).toBeDisabled();
  await expect(page.getByTestId("log-scale")).toBeDisabled();

  const initialLayer = await page.getByTestId("scientific-field-ready").getAttribute("data-z-layer");
  const initialBounds = await page.getByTestId("scientific-field-ready").getAttribute("data-z-layer-bounds");
  await page.getByRole("slider", { name: "Z position" }).press("End");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-z-layer", initialLayer ?? "");
  await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-z-layer-bounds", initialBounds ?? "");
  await expect(page.getByTestId("preview-status")).toContainText("layer");
  await expect(page.getByTestId("scientific-scalar-bar")).toContainText("Z layer");

  await page.getByTestId("mode-off").click();
  await expect(page.getByTestId("preview-status")).toContainText("Total Nuclear Heating · display off");
  await expect(page.getByTestId("scientific-scalar-bar")).toBeHidden();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "false");
  await expect(page.getByTestId("geometry-ready")).toBeAttached();
  await page.getByTestId("mode-slice").click();
  await expect(page.getByTestId("scientific-scalar-bar")).toBeVisible();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "true");
  await expect(page.getByTestId("preview-status")).toContainText("reference MCNP simulation");
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

  // Scientific clipping is still unavailable and cannot masquerade as a working control.
  await expect(page.getByRole("button", { name: "Section plane — unavailable" })).toBeDisabled();
  await page.locator(".disabled-tool").hover();
  await expect(page.getByRole("tooltip")).toContainText("Clipping is deferred for this milestone");

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
  await expect(page.getByTestId("reset-camera")).toBeEnabled();
  await page.getByTestId("reset-camera").click();
  await expect(page.getByTestId("preview-status")).toContainText("Camera reset to engineering view");
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
