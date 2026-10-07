export interface ScientificPerformanceDiagnostics {
  sliderInputEvents: number;
  scientificStateUpdates: number;
  moduleIntersectionCalculations: number;
  globalToLocalMappings: number;
  sliceExtractionCalls: number;
  colorMappingCalls: number;
  bufferGeometryCreations: number;
  bufferAttributeAllocations: number;
  scientificComponentRenders: number;
  scientificSceneRenders: number;
  blanketModelRenders: number;
  viewportRenders: number;
  geometryCacheHits: number;
  geometryCacheMisses: number;
  fieldRequestCount: number;
  renderedPatchCount: number;
  lastInputAtMs: number | null;
  lastRenderAtMs: number | null;
  lastInputToRenderMs: number | null;
  lastSliceExtractionMs: number | null;
  lastBufferGeometryCreationMs: number | null;
}

declare global {
  interface Window {
    __fusionScientificPerformance?: ScientificPerformanceDiagnostics;
  }
}

const isDevelopment = process.env.NODE_ENV !== "production";

const diagnostics: ScientificPerformanceDiagnostics = {
  sliderInputEvents: 0,
  scientificStateUpdates: 0,
  moduleIntersectionCalculations: 0,
  globalToLocalMappings: 0,
  sliceExtractionCalls: 0,
  colorMappingCalls: 0,
  bufferGeometryCreations: 0,
  bufferAttributeAllocations: 0,
  scientificComponentRenders: 0,
  scientificSceneRenders: 0,
  blanketModelRenders: 0,
  viewportRenders: 0,
  geometryCacheHits: 0,
  geometryCacheMisses: 0,
  fieldRequestCount: 0,
  renderedPatchCount: 0,
  lastInputAtMs: null,
  lastRenderAtMs: null,
  lastInputToRenderMs: null,
  lastSliceExtractionMs: null,
  lastBufferGeometryCreationMs: null,
};

let publishPending = false;
function publish() {
  if (!isDevelopment || typeof window === "undefined" || publishPending) return;
  publishPending = true;
  queueMicrotask(() => {
    publishPending = false;
    window.__fusionScientificPerformance = { ...diagnostics };
  });
}

function increment(key: Exclude<keyof ScientificPerformanceDiagnostics, "lastInputAtMs" | "lastRenderAtMs" | "lastInputToRenderMs" | "lastSliceExtractionMs" | "lastBufferGeometryCreationMs">, amount = 1) {
  if (!isDevelopment) return;
  diagnostics[key] += amount;
  publish();
}

export function recordScientificSliderInput() {
  if (!isDevelopment) return;
  diagnostics.sliderInputEvents += 1;
  diagnostics.lastInputAtMs = performance.now();
  publish();
}

export function recordScientificStateUpdate() {
  increment("scientificStateUpdates");
}

export function recordModuleIntersectionCalculation() {
  increment("moduleIntersectionCalculations");
}

export function recordGlobalToLocalMapping() {
  increment("globalToLocalMappings");
}

export function recordSliceExtraction() {
  increment("sliceExtractionCalls");
}

export function recordSliceExtractionDuration(milliseconds: number) {
  if (!isDevelopment) return;
  diagnostics.lastSliceExtractionMs = milliseconds;
  publish();
}

export function recordBufferGeometryCreationDuration(milliseconds: number) {
  if (!isDevelopment) return;
  diagnostics.lastBufferGeometryCreationMs = milliseconds;
  publish();
}

export function recordColorMapping(amount = 1) {
  increment("colorMappingCalls", amount);
}

export function recordBufferGeometryCreation() {
  increment("bufferGeometryCreations");
}

export function recordBufferAttributeAllocation() {
  increment("bufferAttributeAllocations");
}

export function recordScientificComponentRender() {
  increment("scientificComponentRenders");
}

export function recordScientificSceneRender() {
  increment("scientificSceneRenders");
}

export function recordBlanketModelRender() {
  increment("blanketModelRenders");
}

export function recordViewportRender() {
  increment("viewportRenders");
}

export function recordGeometryCacheHit() {
  increment("geometryCacheHits");
}

export function recordGeometryCacheMiss() {
  increment("geometryCacheMisses");
}

export function recordScientificFieldRequest() {
  increment("fieldRequestCount");
}

export function recordScientificRender(renderedPatchCount: number) {
  if (!isDevelopment) return;
  const now = performance.now();
  diagnostics.renderedPatchCount = renderedPatchCount;
  diagnostics.lastRenderAtMs = now;
  diagnostics.lastInputToRenderMs = diagnostics.lastInputAtMs === null ? null : now - diagnostics.lastInputAtMs;
  publish();
}

export function resetScientificPerformanceDiagnostics() {
  if (!isDevelopment) return;
  (Object.keys(diagnostics) as Array<keyof ScientificPerformanceDiagnostics>).forEach((key) => {
    if (key === "lastInputAtMs" || key === "lastRenderAtMs" || key === "lastInputToRenderMs" || key === "lastSliceExtractionMs" || key === "lastBufferGeometryCreationMs") diagnostics[key] = null;
    else diagnostics[key] = 0;
  });
  publish();
}
