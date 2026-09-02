import { create } from "zustand";
import { mockTwinState } from "./mock-twin-state";
import { twinApi, TwinApiError } from "./twin-api";
import { geometryApi, type GeometryDesignResponse } from "./geometry-api";
import {
  buildVoxelProbe,
  loadAllScientificFieldValues,
  loadScientificFieldValues,
  loadScientificManifest,
  selectedLayer,
  voxelFromPoint,
  type ScientificFieldData,
  type ScientificFieldId,
  type ScientificFieldStatus,
  type ScientificLoadMetrics,
  type ScientificProbeStatus,
  type ScientificVoxelProbe,
} from "./scientific-field";
import type {
  ComponentId,
  ComponentState,
  DesignDomain,
  PredictionStatus,
  GeometryStatus,
  ScalarPredictionResponse,
  SliceAxis,
  TwinApiHealth,
  TwinApiStatus,
  VisualizationMode,
  WorkspaceSection,
} from "./twin-types";

export type CameraCommand = {
  action: "reset" | "fit" | "roll-cw" | "roll-ccw";
  sequence: number;
};

interface TwinUiState {
  section: WorkspaceSection;
  pz206: number;
  cz301: number;
  appliedPz206: number;
  appliedCz301: number;
  designDomain: DesignDomain | null;
  apiHealth: TwinApiHealth | null;
  apiStatus: TwinApiStatus;
  predictionStatus: PredictionStatus;
  prediction: ScalarPredictionResponse | null;
  predictionError: string | null;
  geometryStatus: GeometryStatus;
  geometry: GeometryDesignResponse | null;
  geometryError: string | null;
  appliedGeometryPz206: number | null;
  appliedGeometryCz301: number | null;
  scientificFieldStatus: ScientificFieldStatus;
  scientificField: ScientificFieldData | null;
  scientificFieldError: string | null;
  scientificLoadMetrics: ScientificLoadMetrics | null;
  scientificProbe: ScientificVoxelProbe | null;
  scientificProbeStatus: ScientificProbeStatus;
  scientificProbeError: string | null;
  activeFieldId: ScientificFieldId;
  visualizationMode: VisualizationMode;
  sliceAxis: SliceAxis;
  useLogScale: boolean;
  slicePositions: Record<SliceAxis, number>;
  selectedComponentId: ComponentId;
  componentVisibility: Record<ComponentId, boolean>;
  componentOpacity: Record<ComponentId, number>;
  scientificSliceOpacity: number;
  cameraCommand: CameraCommand;
  initializeTwinApi: () => Promise<void>;
  initializeScientificField: () => Promise<void>;
  reportScientificRender: (firstRenderMs: number | null, sliceUpdateMs: number) => void;
  setSection: (section: WorkspaceSection) => void;
  setPz206: (value: number) => void;
  setCz301: (value: number) => void;
  applyDesign: () => Promise<void>;
  resetDesign: () => void;
  setActiveField: (id: ScientificFieldId) => void;
  setVisualizationMode: (mode: VisualizationMode) => void;
  setSliceAxis: (axis: SliceAxis) => void;
  setUseLogScale: (enabled: boolean) => void;
  setSlicePosition: (axis: SliceAxis, value: number) => void;
  probeScientificVoxel: (pointMm: [number, number, number]) => Promise<void>;
  clearScientificProbe: () => void;
  selectComponent: (id: ComponentId) => void;
  toggleComponent: (id: ComponentId) => void;
  setComponentOpacity: (id: ComponentId, opacity: number) => void;
  setScientificSliceOpacity: (opacity: number) => void;
  requestCamera: (action: CameraCommand["action"]) => void;
}

let initializationPromise: Promise<void> | null = null;
let scientificInitializationPromise: Promise<void> | null = null;

export const useTwinStore = create<TwinUiState>((set, get) => ({
  section: "overview",
  pz206: mockTwinState.design.parameters.pz_206.value,
  cz301: mockTwinState.design.parameters.cz_301_radius.value,
  appliedPz206: mockTwinState.design.parameters.pz_206.value,
  appliedCz301: mockTwinState.design.parameters.cz_301_radius.value,
  designDomain: null,
  apiHealth: null,
  apiStatus: "checking",
  predictionStatus: "idle",
  prediction: null,
  predictionError: null,
  geometryStatus: "idle",
  geometry: null,
  geometryError: null,
  appliedGeometryPz206: null,
  appliedGeometryCz301: null,
  scientificFieldStatus: "idle",
  scientificField: null,
  scientificFieldError: null,
  scientificLoadMetrics: null,
  scientificProbe: null,
  scientificProbeStatus: "idle",
  scientificProbeError: null,
  activeFieldId: mockTwinState.activeFieldId,
  visualizationMode: "Slice",
  sliceAxis: "Z",
  useLogScale: false,
  slicePositions: { X: 0, Y: 0, Z: 460.5 },
  selectedComponentId: "breeder",
  componentVisibility: Object.fromEntries(
    mockTwinState.components.map((component: ComponentState) => [component.id, component.visible]),
  ) as Record<ComponentId, boolean>,
  componentOpacity: { armor: 1, breeder: 1, multiplier: 1, structure: 1, coolant: 1 },
  scientificSliceOpacity: 1,
  cameraCommand: { action: "reset", sequence: 0 },
  initializeTwinApi: () => {
    initializationPromise ??= initializeTwinState();
    return initializationPromise;
  },
  initializeScientificField: () => {
    scientificInitializationPromise ??= initializeScientificState();
    return scientificInitializationPromise;
  },
  reportScientificRender: (firstRenderMs, sliceUpdateMs) => set((state) => ({
    scientificLoadMetrics: state.scientificLoadMetrics
      ? {
          ...state.scientificLoadMetrics,
          firstRenderMs: state.scientificLoadMetrics.firstRenderMs ?? firstRenderMs,
          sliceUpdateMs,
        }
      : null,
  })),
  setSection: (section) => set({ section }),
  setPz206: (pz206) => set({ pz206 }),
  setCz301: (cz301) => set({ cz301 }),
  applyDesign: async () => {
    const { pz206, cz301 } = get();
    set({ predictionStatus: "pending", predictionError: null, geometryStatus: "loading", geometryError: null });
    const [predictionResult, geometryResult] = await Promise.allSettled([
      twinApi.predictScalars({ pz_206: pz206, cz_301_radius: cz301 }),
      geometryApi.design({ pz_206: pz206, cz_301_radius: cz301 }),
    ]);
    if (predictionResult.status === "fulfilled") {
      set({
        appliedPz206: predictionResult.value.design.pz_206,
        appliedCz301: predictionResult.value.design.cz_301_radius,
        apiStatus: "connected",
        prediction: predictionResult.value,
        predictionStatus: "success",
        predictionError: null,
      });
    } else {
      const error = predictionResult.reason;
      set({
        apiStatus: isBackendUnavailable(error) ? "offline" : "connected",
        predictionStatus: "error",
        predictionError: errorMessage(error),
      });
    }
    if (geometryResult.status === "fulfilled") {
      const result = geometryResult.value;
      set({
        geometryStatus: "success",
        geometry: result,
        geometryError: null,
        appliedGeometryPz206: result.design.pz_206,
        appliedGeometryCz301: result.design.cz_301_radius,
      });
    } else {
      set({ geometryStatus: "error", geometryError: errorMessage(geometryResult.reason) });
    }
  },
  resetDesign: () => set({
    pz206: mockTwinState.design.parameters.pz_206.value,
    cz301: mockTwinState.design.parameters.cz_301_radius.value,
  }),
  setActiveField: (activeFieldId) => {
    set({ activeFieldId });
    void loadActiveScientificField(activeFieldId as ScientificFieldId, false);
  },
  setVisualizationMode: (visualizationMode) => set({
    visualizationMode,
    scientificProbe: visualizationMode === "Off" ? null : get().scientificProbe,
    scientificProbeStatus: visualizationMode === "Off" ? "idle" : get().scientificProbeStatus,
  }),
  setSliceAxis: (sliceAxis) => set((state) => ({
    sliceAxis,
    scientificProbe: null,
    scientificProbeStatus: "idle",
    slicePositions: state.scientificField
      ? {
          ...state.slicePositions,
          [sliceAxis]: selectedLayer(
            state.scientificField.manifest,
            sliceAxis,
            state.slicePositions[sliceAxis],
          ).center_mm,
        }
      : state.slicePositions,
  })),
  setUseLogScale: (useLogScale) => set({ useLogScale }),
  setSlicePosition: (axis, value) => set((state) => ({
    slicePositions: { ...state.slicePositions, [axis]: value },
    scientificProbe: null,
    scientificProbeStatus: "idle",
  })),
  probeScientificVoxel: async (pointMm) => {
    const state = get();
    if (!state.scientificField || state.visualizationMode !== "Slice" || state.scientificFieldStatus === "error") return;
    const indices = voxelFromPoint(
      state.scientificField.manifest,
      state.sliceAxis,
      state.slicePositions[state.sliceAxis],
      pointMm,
    );
    if (!indices) {
      set({ scientificProbe: null, scientificProbeStatus: "error", scientificProbeError: "Clicked point is outside the MCNP FMESH." });
      return;
    }
    const started = performance.now();
    set({ scientificProbeStatus: "loading", scientificProbeError: null });
    try {
      const { valuesByField, metrics } = await loadAllScientificFieldValues(
        state.scientificField.manifest,
        state.scientificField.valuesByField,
      );
      const probe = buildVoxelProbe(state.scientificField.manifest, valuesByField, indices);
      set((latest) => ({
        scientificField: latest.scientificField ? { ...latest.scientificField, valuesByField } : latest.scientificField,
        scientificProbe: probe,
        scientificProbeStatus: "ready",
        scientificProbeError: null,
        scientificLoadMetrics: latest.scientificLoadMetrics
          ? {
              ...latest.scientificLoadMetrics,
              scalarDownloadMs: (latest.scientificLoadMetrics.scalarDownloadMs ?? 0) + metrics.downloadMs,
              scalarParseMs: (latest.scientificLoadMetrics.scalarParseMs ?? 0) + metrics.parseMs,
              probeMs: performance.now() - started,
            }
          : null,
      }));
    } catch (error) {
      set({ scientificProbeStatus: "error", scientificProbeError: errorMessage(error) });
    }
  },
  clearScientificProbe: () => set({ scientificProbe: null, scientificProbeStatus: "idle", scientificProbeError: null }),
  selectComponent: (selectedComponentId) => set({ selectedComponentId }),
  toggleComponent: (id) => set((state) => ({
    componentVisibility: { ...state.componentVisibility, [id]: !state.componentVisibility[id] },
  })),
  setComponentOpacity: (id, opacity) => set((state) => ({
    componentOpacity: { ...state.componentOpacity, [id]: Math.max(0.15, Math.min(1, opacity)) },
  })),
  setScientificSliceOpacity: (opacity) => set({ scientificSliceOpacity: Math.max(0.25, Math.min(1, opacity)) }),
  requestCamera: (action) => set((state) => ({ cameraCommand: { action, sequence: state.cameraCommand.sequence + 1 } })),
}));

async function initializeScientificState(): Promise<void> {
  useTwinStore.setState({ scientificFieldStatus: "loading-metadata", scientificFieldError: null });
  try {
    const { manifest, metrics } = await loadScientificManifest((scientificFieldStatus) => {
      useTwinStore.setState({ scientificFieldStatus });
    });
    const data: ScientificFieldData = { manifest, valuesByField: {} };
    useTwinStore.setState((state) => ({
      scientificField: data,
      scientificFieldStatus: "loading-scalars",
      scientificFieldError: null,
      scientificLoadMetrics: metrics,
      slicePositions: {
        ...state.slicePositions,
        X: manifest.slicing.axes.X.default_position_mm,
        Y: manifest.slicing.axes.Y.default_position_mm,
        Z: manifest.slicing.axes.Z.default_position_mm,
      },
    }));
    await loadActiveScientificField(manifest.default_field_key, true);
  } catch (error) {
    useTwinStore.setState({
      scientificFieldStatus: "error",
      scientificFieldError: error instanceof Error ? error.message : "Scientific field could not be loaded.",
    });
  }
}

async function loadActiveScientificField(activeFieldId: ScientificFieldId, initialLoad: boolean): Promise<void> {
  const state = useTwinStore.getState();
  if (!state.scientificField) return;
  if (state.scientificField.valuesByField[activeFieldId]) {
    useTwinStore.setState({ scientificFieldStatus: "ready", scientificFieldError: null });
    return;
  }
  const started = performance.now();
  useTwinStore.setState({ scientificFieldStatus: "loading-scalars", scientificFieldError: null });
  try {
    const result = await loadScientificFieldValues(state.scientificField.manifest, activeFieldId, (scientificFieldStatus) => {
      useTwinStore.setState({ scientificFieldStatus });
    });
    useTwinStore.setState((latest) => ({
      scientificField: latest.scientificField
        ? {
            ...latest.scientificField,
            valuesByField: { ...latest.scientificField.valuesByField, [activeFieldId]: result.values },
          }
        : latest.scientificField,
      scientificFieldStatus: "ready",
      scientificFieldError: null,
      scientificLoadMetrics: latest.scientificLoadMetrics
        ? {
            ...latest.scientificLoadMetrics,
            scalarDownloadMs: initialLoad ? result.metrics.downloadMs : latest.scientificLoadMetrics.scalarDownloadMs,
            scalarParseMs: initialLoad ? result.metrics.parseMs : latest.scientificLoadMetrics.scalarParseMs,
            totalMs: initialLoad ? (latest.scientificLoadMetrics.totalMs ?? 0) + result.metrics.downloadMs + result.metrics.parseMs : latest.scientificLoadMetrics.totalMs,
            fieldSwitchMs: initialLoad ? latest.scientificLoadMetrics.fieldSwitchMs : performance.now() - started,
          }
        : null,
    }));
  } catch (error) {
    useTwinStore.setState({
      scientificFieldStatus: "error",
      scientificFieldError: errorMessage(error),
    });
  }
}

async function initializeTwinState(): Promise<void> {
  useTwinStore.setState({ apiStatus: "checking", predictionStatus: "idle", predictionError: null });
  const initial = useTwinStore.getState();
  void loadInitialGeometry(initial.pz206, initial.cz301);
  try {
    const health = await twinApi.health();
    if (health.status !== "ok" || health.scalar_prediction !== "ready") {
      throw new TwinApiError("Scalar prediction model is unavailable.", 503);
    }
    const domain = await twinApi.designDomain();
    useTwinStore.setState({ apiHealth: health, apiStatus: "connected", designDomain: domain });
    const { pz206, cz301 } = useTwinStore.getState();
    useTwinStore.setState({ predictionStatus: "pending" });
    const prediction = await twinApi.predictScalars({ pz_206: pz206, cz_301_radius: cz301 });
    useTwinStore.setState({
      appliedPz206: prediction.design.pz_206,
      appliedCz301: prediction.design.cz_301_radius,
      prediction,
      predictionStatus: "success",
      predictionError: null,
    });
  } catch (error) {
    useTwinStore.setState({
      apiStatus: "offline",
      predictionStatus: "error",
      predictionError: errorMessage(error),
    });
  }
}

async function loadInitialGeometry(pz206: number, cz301: number): Promise<void> {
  useTwinStore.setState({ geometryStatus: "loading", geometryError: null });
  try {
    const geometry = await geometryApi.design({ pz_206: pz206, cz_301_radius: cz301 });
    useTwinStore.setState({
      geometryStatus: "success",
      geometry,
      geometryError: null,
      appliedGeometryPz206: geometry.design.pz_206,
      appliedGeometryCz301: geometry.design.cz_301_radius,
    });
  } catch (error) {
    useTwinStore.setState({ geometryStatus: "error", geometryError: errorMessage(error) });
  }
}

function isBackendUnavailable(error: unknown): boolean {
  return !(error instanceof TwinApiError) || error.status === null || error.status >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Scalar prediction failed.";
}
