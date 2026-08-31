import { expect, test } from "@playwright/test";

const desktopSizes = [
  { name: "1366x768", width: 1366, height: 768 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

const sections = ["overview", "design", "neutronics", "thermal-hydraulics", "performance"] as const;

test("captures every workspace at each requested desktop resolution", async ({ page }) => {
  for (const size of desktopSizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await expect(page.getByTestId("geometry-ready")).toBeAttached({ timeout: 15_000 });
    for (const section of sections) {
      await page.getByTestId(`nav-${section}`).click();
      await expect(page.getByTestId(`nav-${section}`)).toHaveAttribute("aria-current", "page");
      await page.screenshot({ path: `screenshots/qa-${section}-${size.name}.png`, animations: "disabled" });
    }
  }
});
