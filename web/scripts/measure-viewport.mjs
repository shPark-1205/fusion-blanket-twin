import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://127.0.0.1:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const runtimeErrors = [];
page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
page.on("pageerror", (error) => runtimeErrors.push(error.message));

const navigationStarted = performance.now();
await page.goto(url);
await page.getByTestId("geometry-ready").waitFor({ state: "attached", timeout: 15_000 });
const readyMs = performance.now() - navigationStarted;
const diagnostics = await page.getByTestId("geometry-ready").evaluate((element) => ({
  loaderTotalMs: Number(element.dataset.loadMs),
  resourceMs: element.dataset.resourceMs === "unknown" ? null : Number(element.dataset.resourceMs),
}));

const visibilityResponseMs = await page.evaluate(async () => {
  const button = document.querySelector('[data-testid="visibility-coolant"]');
  const diagnostic = document.querySelector('[data-testid="geometry-group-coolant"]');
  const started = performance.now();
  button.click();
  await new Promise(requestAnimationFrame);
  if (diagnostic.dataset.visible !== "false") throw new Error("Visibility state did not update");
  return performance.now() - started;
});

const selectionResponseMs = await page.evaluate(async () => {
  const button = document.querySelector('[data-testid="component-armor"]');
  const readout = document.querySelector('[data-testid="selected-component-name"]');
  const started = performance.now();
  button.click();
  await new Promise(requestAnimationFrame);
  if (readout.textContent !== "Armor") throw new Error("Selection state did not update");
  return performance.now() - started;
});

const canvas = page.locator("canvas");
const bounds = await canvas.boundingBox();
if (!bounds) throw new Error("Canvas bounds unavailable");
await page.mouse.click(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.5);
const selectedAfterViewportClick = await page.getByTestId("selected-component-name").textContent();
await page.mouse.move(bounds.x + bounds.width * 0.54, bounds.y + bounds.height * 0.5);
const hoverLabel = await page.locator(".geometry-hover-label").textContent({ timeout: 5_000 });

await page.evaluate(() => {
  window.__orbitFrames = [];
  window.__orbitDone = false;
  let previous = performance.now();
  const sample = (now) => {
    window.__orbitFrames.push(now - previous);
    previous = now;
    if (window.__orbitFrames.length < 45) requestAnimationFrame(sample);
    else window.__orbitDone = true;
  };
  requestAnimationFrame(sample);
});
await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.5);
await page.mouse.down();
for (let step = 1; step <= 24; step += 1) {
  await page.mouse.move(bounds.x + bounds.width * (0.55 + step * 0.004), bounds.y + bounds.height * (0.5 - step * 0.002), { steps: 1 });
}
await page.mouse.up();
await page.waitForFunction(() => window.__orbitDone === true);
const frameTimes = await page.evaluate(() => window.__orbitFrames.slice(1));
const averageFrameMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;

console.log(JSON.stringify({
  url,
  readyFromNavigationMs: readyMs,
  ...diagnostics,
  visibilityResponseMs,
  selectionResponseMs,
  selectedAfterViewportClick,
  hoverLabel,
  orbitAverageFrameMs: averageFrameMs,
  orbitApproximateFps: 1000 / averageFrameMs,
  orbitWorstFrameMs: Math.max(...frameTimes),
  runtimeErrors,
}, null, 2));
await browser.close();
