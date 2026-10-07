import { expect, test } from "@playwright/test";

import { installScientificFieldFixture } from "./scientific-field-fixture";

test.beforeEach(async ({ page }) => {
  await installScientificFieldFixture(page);
});

async function openNeutronics(page: Parameters<typeof installScientificFieldFixture>[0], module = false) {
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached({ timeout: 15_000 });
  if (module) {
    await page.getByTestId("view-scale-module").click();
    await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-view-scale", "module");
  }
}

async function moveSliceOnAxis(page: Parameters<typeof installScientificFieldFixture>[0], axis: "x" | "y" | "z") {
  await page.getByTestId(`axis-${axis}`).click();
  const slider = page.getByRole("slider", { name: `${axis.toUpperCase()} position` });
  const before = await page.getByTestId("scientific-slice-slice-1").getAttribute("data-global-slice-position-mm");
  const current = Number(await slider.getAttribute("aria-valuenow"));
  const maximum = Number(await slider.getAttribute("aria-valuemax"));
  await slider.press(Math.abs(current - maximum) < 0.001 ? "Home" : "End");
  await expect(page.getByTestId("scientific-slice-slice-1")).not.toHaveAttribute("data-global-slice-position-mm", before ?? "");
}

test.describe("Slice position controls", () => {
  test("Single Cell X/Y/Z sliders move the rendered raw slice plane", async ({ page }) => {
    await openNeutronics(page);
    for (const axis of ["x", "y", "z"] as const) await moveSliceOnAxis(page, axis);
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "true");
  });

  test("Module X/Y/Z sliders use global coordinates and preserve raw-layer mapping", async ({ page }) => {
    await openNeutronics(page, true);
    for (const axis of ["x", "y", "z"] as const) await moveSliceOnAxis(page, axis);
    await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-scientific-overlay", "true");
    await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-intersected-cell-count", /[1-9]/);
  });

  test("opacity and multiple slice selection remain independent", async ({ page }) => {
    await openNeutronics(page);
    const first = page.getByTestId("scientific-slice-slice-1");
    await page.getByTestId("scientific-slice-opacity-slice-1").press("Home");
    await expect(first).toHaveAttribute("data-slice-opacity", "0.25");
    await page.getByTestId("add-scientific-slice").click();
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-slice-count", "2");
    const firstPosition = await first.getAttribute("data-global-slice-position-mm");
    await page.getByTestId("select-scientific-slice-slice-2").click();
    await page.getByTestId("scientific-slice-position-slice-2").press("End");
    await expect(page.getByTestId("scientific-slice-slice-2")).toHaveAttribute("data-slice-visible", "true");
    await expect(first).toHaveAttribute("data-global-slice-position-mm", firstPosition ?? "");
  });
});

test.describe("Manual scientific display ranges", () => {
  test("Auto and Manual ranges update the shared scalar bar range", async ({ page }) => {
    await openNeutronics(page);
    const scalarBar = page.getByTestId("scientific-scalar-bar");
    await expect(page.getByTestId("scientific-range-auto")).toHaveAttribute("data-state", "on");
    await expect(scalarBar).toHaveAttribute("data-display-range-mode", "auto");
    await page.getByTestId("scientific-range-manual").click();
    await page.getByTestId("scientific-range-min").fill("10");
    await page.getByTestId("scientific-range-max").fill("20");
    await expect(scalarBar).toHaveAttribute("data-display-range-mode", "manual");
    await expect(scalarBar).toHaveAttribute("data-display-range", "10,20");
    await expect(page.getByTestId("scientific-range-applied")).toContainText("1.000e+1");
    await page.getByTestId("scientific-range-reset").click();
    await expect(scalarBar).toHaveAttribute("data-display-range-mode", "auto");
  });

  test("Linear and Log ranges validate safely and preserve raw probe values", async ({ page }) => {
    await openNeutronics(page);
    await page.getByTestId("scientific-range-manual").click();
    await page.getByTestId("scientific-range-min").fill("1");
    await page.getByTestId("scientific-range-max").fill("20");
    await page.getByTestId("log-scale").check();
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-scale-mode", "log");
    await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range", "1,20");
    await page.getByTestId("scientific-range-min").fill("0");
    await expect(page.getByTestId("scientific-range-error")).toContainText("greater than zero");
    await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range", "1,20");
    await page.getByTestId("log-scale").uncheck();
    await page.getByTestId("probe-layer-center").click();
    await expect(page.getByTestId("probe-panel")).toContainText("Total Nuclear Heating");
    await expect(page.getByTestId("probe-panel")).toContainText("3.9000e+1 W/cm³");
    await page.getByTestId("scientific-range-max").fill("0.5");
    await expect(page.getByTestId("scientific-range-error")).toContainText("greater than Min");
    await expect(page.getByTestId("probe-panel")).toContainText("3.9000e+1 W/cm³");
  });

  test("manual ranges are kept per scientific field", async ({ page }) => {
    await openNeutronics(page);
    await page.getByTestId("scientific-range-manual").click();
    await page.getByTestId("scientific-range-min").fill("10");
    await page.getByTestId("scientific-range-max").fill("20");
    await page.getByTestId("field-selector").selectOption("photon_flux");
    await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range-mode", "auto");
    await page.getByTestId("field-selector").selectOption("nuclear_heating");
    await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range", "10,20");
  });
});

test.describe("Iso visualization", () => {
  test("Single Cell Iso creates geometry and responds to Iso Value and field changes", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openNeutronics(page);
    await expect(page.getByTestId("mode-iso-surface")).toBeEnabled();
    await page.getByTestId("mode-iso-surface").click();
    await expect(page.getByTestId("iso-controls")).toBeVisible();
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-iso-geometry-nonempty", "true");
    const initialIsoValue = await page.getByTestId("scientific-field-ready").getAttribute("data-iso-value");
    await page.getByTestId("iso-value-input").fill("65");
    await expect(page.getByTestId("scientific-field-ready")).not.toHaveAttribute("data-iso-value", initialIsoValue ?? "");
    await page.getByTestId("field-selector").selectOption("photon_flux");
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-active-field", "photon_flux");
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-iso-geometry-nonempty", "true");
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("Module Iso reuses one local reference geometry across all 28 cells", async ({ page }) => {
    await openNeutronics(page, true);
    await page.getByTestId("mode-iso-surface").click();
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-rendered-patch-count", "28");
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-iso-shared-geometry", "true");
    await expect(page.getByTestId("module-scientific-notice")).toContainText("repeated across module cells for visualization");
    await expect(page.getByTestId("module-scientific-notice")).toContainText("not a module-scale MCNP simulation");
  });

  test("Slice to Iso to Slice preserves the existing raw slice", async ({ page }) => {
    await openNeutronics(page);
    const before = await page.getByTestId("scientific-slice-slice-1").getAttribute("data-slice-layer");
    await page.getByTestId("mode-iso-surface").click();
    await expect(page.getByTestId("scientific-scalar-bar")).toContainText("interpolated visualization geometry");
    await page.getByTestId("section-view-toggle").check();
    await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-clipping-plane-count", "1");
    await page.getByTestId("mode-slice").click();
    await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-slice-layer", before ?? "");
    await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-visible", "true");
  });
});
