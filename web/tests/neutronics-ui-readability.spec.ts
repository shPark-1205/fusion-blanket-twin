import { expect, test, type Page } from "@playwright/test";

import { installScientificFieldFixture } from "./scientific-field-fixture";

test.beforeEach(async ({ page }) => {
  await installScientificFieldFixture(page);
});

async function openNeutronics(page: Page, module = false) {
  await page.goto("/");
  await expect(page.getByTestId("geometry-ready")).toBeAttached();
  await page.getByTestId("nav-neutronics").click();
  await expect(page.getByTestId("scientific-field-ready")).toBeAttached();
  if (module) {
    await page.getByTestId("view-scale-module").click();
    await expect(page.getByTestId("geometry-ready")).toHaveAttribute("data-view-scale", "module");
  }
}

async function expectReadableNumber(page: Page, testId: string) {
  const input = page.getByTestId(testId);
  const box = await input.boundingBox();
  expect(box, `${testId} should have a visible click target`).not.toBeNull();
  expect(box!.width, `${testId} should fit scientific notation`).toBeGreaterThanOrEqual(145);
  expect(box!.height, `${testId} should be easy to click`).toBeGreaterThanOrEqual(36);
  const textFits = await input.evaluate((element: HTMLInputElement) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.font = style.font;
    const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20;
    return context.measureText(element.value).width <= available;
  });
  expect(textFits, `${testId} should display its complete value`).toBe(true);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    panel: document.querySelector("[data-testid='control-panel']")?.scrollWidth ?? 0,
    panelWidth: document.querySelector("[data-testid='control-panel']")?.clientWidth ?? 0,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.panel).toBeLessThanOrEqual(dimensions.panelWidth + 1);
}

test("Single Cell scientific numbers and sliders remain usable at 1366×768", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await openNeutronics(page);
  await page.getByTestId("scientific-range-manual").click();
  await expectReadableNumber(page, "scientific-range-min");
  await expectReadableNumber(page, "scientific-range-max");
  await expectReadableNumber(page, "scientific-slice-position-slice-1-input");
  for (const axis of ["x", "y", "z"] as const) {
    await page.getByTestId(`axis-${axis}`).click();
    await expectReadableNumber(page, "slice-position-input");
    const input = page.getByTestId("slice-position-input");
    const minimum = Number(await input.getAttribute("min"));
    const maximum = Number(await input.getAttribute("max"));
    const requested = Number((minimum + (maximum - minimum) * 0.55).toFixed(1));
    await input.fill(String(requested));
    await input.blur();
    await expect.poll(async () => Number(await page.getByTestId("scientific-slice-slice-1").getAttribute("data-global-slice-position-mm"))).toBe(requested);
  }
  await page.getByTestId("scientific-slice-opacity-slice-1").press("Home");
  await expect(page.getByTestId("scientific-slice-slice-1")).toHaveAttribute("data-slice-opacity", "0.25");
  await page.getByTestId("mode-iso-surface").click();
  await expectReadableNumber(page, "iso-value-input");
  await expectNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("Module scientific controls stay inside the panel at 1600×900", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await openNeutronics(page, true);
  await page.getByTestId("scientific-range-manual").click();
  await expectReadableNumber(page, "scientific-range-min");
  await expectReadableNumber(page, "scientific-range-max");
  await expectReadableNumber(page, "slice-position-input");
  await expectReadableNumber(page, "scientific-slice-position-slice-1-input");
  await page.getByTestId("mode-iso-surface").click();
  await expectReadableNumber(page, "iso-value-input");
  await expectNoHorizontalOverflow(page);
});

test("scientific notation stays visible and editable in Manual Linear and Log range", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openNeutronics(page);
  await page.getByTestId("field-selector").selectOption("neutron_flux");
  await page.getByTestId("scientific-range-manual").click();
  await page.getByTestId("scientific-range-max").fill("5.42894e+14");
  await page.getByTestId("scientific-range-min").fill("1.385519e+14");
  await expect(page.getByTestId("scientific-scalar-bar")).toHaveAttribute("data-display-range", "138551900000000,542894000000000");
  await expectReadableNumber(page, "scientific-range-min");
  await expectReadableNumber(page, "scientific-range-max");
  await page.getByTestId("log-scale").check();
  await expect(page.getByTestId("scientific-field-ready")).toHaveAttribute("data-scale-mode", "log");
  await expectReadableNumber(page, "scientific-range-min");
  await expectReadableNumber(page, "scientific-range-max");
  await expectNoHorizontalOverflow(page);
});
