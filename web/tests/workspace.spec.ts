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

  await page.goto("/");
  await expect(page).toHaveTitle(/Fusion Blanket Digital Twin/);
  await expect(page.getByRole("heading", { name: "Blanket Unit Cell" })).toBeVisible();
  await expect(page.getByText("PRESENTATION PREVIEW", { exact: true })).toBeVisible();
  await expect(page.getByText("Scientific 3D not connected", { exact: true })).toBeVisible();

  // Overview -> Design and both design sliders mutate visible local state.
  await page.getByTestId("nav-design").click();
  await expect(page.getByRole("heading", { name: "Design variables" })).toBeVisible();
  await expect(page.getByTestId("reset-geometry")).toBeDisabled();
  await page.getByRole("slider", { name: "PZ 206" }).press("Home");
  await expect(page.getByTestId("pz-206-slider-value")).toContainText("2.60");
  await page.getByRole("slider", { name: "CZ 301 radius" }).press("Home");
  await expect(page.getByTestId("reset-geometry")).toBeEnabled();
  await expect(page.getByTestId("cz-301-slider-value")).toContainText("3.60");
  await expect(page.getByText("Geometry update pending", { exact: true })).toBeVisible();
  await page.getByTestId("apply-geometry").click();
  await expect(page.getByText(/Applied · PZ 2\.60 · CZ 3\.60 cm/)).toBeVisible();
  await expect(page.getByTestId("preview-status")).toContainText("Applied PZ 2.60 cm · CZ 3.60 cm");
  await page.getByTestId("reset-geometry").click();
  await expect(page.getByText("Geometry update pending", { exact: true })).toBeVisible();

  // Design -> Neutronics and every mock display control produces visible feedback.
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByRole("heading", { name: "Field controls" })).toBeVisible();
  await page.getByTestId("field-selector").selectOption("neutron_flux");
  await expect(page.getByTestId("viewport-state")).toContainText("Neutron Flux");
  await page.getByTestId("field-selector").selectOption("photon_flux");
  await expect(page.getByTestId("viewport-state")).toContainText("Photon Flux");

  await page.getByTestId("mode-off").click();
  await expect(page.getByTestId("preview-status")).toContainText("Photon Flux · display off");
  await page.getByTestId("mode-slice").click();
  await expect(page.getByTestId("preview-status")).toContainText("Slice · Z · 420 mm · Linear");
  await page.getByTestId("mode-iso-surface").click();
  await expect(page.getByTestId("preview-status")).toContainText("Iso-surface · Z · 420 mm · Linear");

  for (const axis of ["x", "y", "z"] as const) {
    await page.getByTestId(`axis-${axis}`).click();
    await expect(page.getByTestId(`axis-${axis}`)).toHaveAttribute("data-state", "on");
  }
  await page.getByRole("slider", { name: "Z position" }).press("End");
  await expect(page.getByTestId("preview-status")).toContainText("Z · 921 mm");
  await page.getByTestId("log-scale").check();
  await expect(page.getByTestId("preview-status")).toContainText("Log");
  await page.getByTestId("log-scale").uncheck();
  await expect(page.getByTestId("preview-status")).toContainText("Linear");

  // Component selection and visibility update both the preview and selected-component panel.
  await page.getByTestId("component-armor").click();
  await expect(page.getByTestId("selected-component-name")).toHaveText("Armor");
  await page.getByTestId("visibility-armor").click();
  await expect(page.getByTestId("visibility-armor")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".selected-section")).toContainText("Hidden");

  // True scientific viewport operations do not masquerade as working controls.
  for (const label of ["Reset camera", "Fit assembly", "Scientific section plane", "3D component layers", "Fullscreen 3D viewport"]) {
    await expect(page.getByRole("button", { name: `${label} — unavailable` })).toBeDisabled();
  }
  await page.locator(".disabled-tool").first().hover();
  await expect(page.getByRole("tooltip")).toContainText("Available after scientific 3D integration");

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
