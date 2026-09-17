import { create } from "zustand";
import { mockTwinState } from "./mock-twin-state";
import { twinApi, TwinApiError } from "./twin-api";
import { geometryApi, type GeometryDesignResponse } from "./geometry-api";
import { MODULE_LAYOUT_V1, moduleAxisBounds, moduleCellTranslationMm } from "./module-layout";
import {
  axisBoundaries,
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
  ScientificSlice,
  ViewScale,
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
  useLogScale: boolean;
  scientificSlices: ScientificSlice[];
  activeScientificSliceId: string | null;
  selectedComponentId: ComponentId;
  componentVisibility: Record<ComponentId, boolean>;
  componentOpacity: Record<ComponentId, number>;
  scientificSliceOpacity: number;
  sectionViewEnabled: boolean;
  sectionViewAxis: SliceAxis;
  sectionViewPositionMm: number;
  sectionViewFlip: boolean;
  viewScale: ViewScale;
  selectedCellId: string | null;
  cameraCommand: CameraCommand;
  initializeTwinApi: () => Promise<void>;
  initializeScientificField: () => Promise<void>;
  reportScientificRender: (firstRenderMs: number | null, sliceUpdateMs: number, renderedSliceCount?: number, renderedVertexCount?: number, renderedPatchCount?: number) => void;
  setSection: (section: WorkspaceSection) => void;
  setPz206: (value: number) => void;
  setCz301: (value: number) => void;
  applyDesign: () => Promise<void>;
  resetDesign: () => void;
  setActiveField: (id: ScientificFieldId) => void;
  setVisualizationMode: (mode: VisualizationMode) => void;
  addScientificSlice: () => void;
  removeScientificSlice: (id: string) => void;
  selectScientificSlice: (id: string) => void;
  setScientificSliceAxis: (id: string, axis: SliceAxis) => void;
  setScientificSlicePosition: (id: string, value: number) => void;
  setScientificSliceVisible: (id: string, visible: boolean) => void;
  setScientificSliceOpacity: (id: string, opacity: number) => void;
  setAllScientificSliceOpacity: (opacity: number) => void;
  setUseLogScale: (enabled: boolean) => void;
  probeScientificVoxel: (sliceId: string, pointMm: [number, number, number], moduleCellId?: string, localSlicePositionMm?: number) => Promise<void>;
  clearScientificProbe: () => void;
  selectComponent: (id: ComponentId) => void;
  toggleComponent: (id: ComponentId) => void;
  setComponentOpacity: (id: ComponentId, opacity: number) => void;
  setSectionViewEnabled: (enabled: boolean) => void;
  setSectionViewAxis: (axis: SliceAxis) => void;
  setSectionViewPosition: (positionMm: number) => void;
  setSectionViewFlip: (flip: boolean) => void;
  setViewScale: (viewScale: ViewScale) => void;
  selectCell: (cellId: string | null) => void;
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
  useLogScale: false,
  scientificSlices: [],
  activeScientificSliceId: null,
  selectedComponentId: "breeder",
  componentVisibility: Object.fromEntries(
    mockTwinState.components.map((component: ComponentState) => [component.id, component.visible]),
  ) as Record<ComponentId, boolean>,
  componentOpacity: { armor: 1, breeder: 1, multiplier: 1, structure: 1, coolant: 1 },
  scientificSliceOpacity: 1,
  sectionViewEnabled: false,
  sectionViewAxis: "Z",
  sectionViewPositionMm: 460.5,
  sectionViewFlip: false,
  viewScale: "single-cell",
  selectedCellId: null,
  cameraCommand: { action: "reset", sequence: 0 },
  initializeTwinApi: () => {
    initializationPromise ??= initializeTwinState();
    return initializationPromise;
  },
  initializeScientificField: () => {
    scientificInitializationPromise ??= initializeScientificState();
    return scientificInitializationPromise;
  },
  reportScientificRender: (firstRenderMs, sliceUpdateMs, renderedSliceCount, renderedVertexCount, renderedPatchCount) => set((state) => ({
    scientificLoadMetrics: state.scientificLoadMetrics
      ? {
          ...state.scientificLoadMetrics,
          firstRenderMs: state.scientificLoadMetrics.firstRenderMs ?? firstRenderMs,
          sliceUpdateMs,
          ...(renderedSliceCount === undefined ? {} : { renderedSliceCount }),
          ...(renderedVertexCount === undefined ? {} : { renderedVertexCount }),
          ...(renderedPatchCount === undefined ? {} : { renderedPatchCount }),
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
  setVisualizationMode: (visualizationMode) => set((state) => {
    if (visualizationMode === "Slice" && state.scientificSlices.length === 0 && state.scientificField) {
      const slice = createScientificSlice(
        state.scientificField.manifest,
        "slice-1",
        state.scientificField.manifest.slicing.default_axis,
        defaultSlicePosition(state.scientificField.manifest, state.viewScale, state.scientificField.manifest.slicing.default_axis),
        state.scientificSliceOpacity,
        true,
        undefined,
        state.viewScale,
      );
      return { visualizationMode, scientificSlices: [slice], activeScientificSliceId: slice.id, scientificProbe: null, scientificProbeStatus: "idle" };
    }
    return {
      visualizationMode,
      scientificProbe: visualizationMode === "Off" ? null : state.scientificProbe,
      scientificProbeStatus: visualizationMode === "Off" ? "idle" : state.scientificProbeStatus,
    };
  }),
  addScientificSlice: () => set((state) => {
    if (!state.scientificField || state.scientificSlices.length >= MAX_SCIENTIFIC_SLICES) {
      return { scientificFieldError: `Maximum of ${MAX_SCIENTIFIC_SLICES} scientific slices reached.` };
    }
    const active = state.scientificSlices.find((slice) => slice.id === state.activeScientificSliceId);
    const axis = active?.axis ?? "Z";
    const position = active?.requestedPositionMm ?? defaultSlicePosition(state.scientificField.manifest, state.viewScale, axis);
    const slice = createScientificSlice(state.scientificField.manifest, nextSliceId(state.scientificSlices), axis, position, state.scientificSliceOpacity, true, undefined, state.viewScale);
    return {
      scientificSlices: [...state.scientificSlices, slice],
      activeScientificSliceId: slice.id,
      scientificFieldError: null,
      scientificProbe: null,
      scientificProbeStatus: "idle",
    };
  }),
  removeScientificSlice: (id) => set((state) => {
    if (state.scientificSlices.length <= 1) return state;
    const index = state.scientificSlices.findIndex((slice) => slice.id === id);
    if (index < 0) return state;
    const scientificSlices = state.scientificSlices.filter((slice) => slice.id !== id);
    const activeScientificSliceId = state.activeScientificSliceId === id
      ? scientificSlices[Math.max(0, index - 1)]?.id ?? scientificSlices[0]?.id ?? null
      : state.activeScientificSliceId;
    return {
      scientificSlices,
      activeScientificSliceId,
      scientificProbe: state.scientificProbe?.sliceId === id ? null : state.scientificProbe,
      scientificProbeStatus: state.scientificProbe?.sliceId === id ? "idle" : state.scientificProbeStatus,
    };
  }),
  selectScientificSlice: (id) => set((state) => state.scientificSlices.some((slice) => slice.id === id)
    ? { activeScientificSliceId: id }
    : state),
  setScientificSliceAxis: (id, axis) => set((state) => {
    if (!state.scientificField) return state;
    return {
      scientificSlices: state.scientificSlices.map((slice) => slice.id === id
        ? createScientificSlice(state.scientificField!.manifest, id, axis, defaultSlicePosition(state.scientificField!.manifest, state.viewScale, axis), slice.opacity, slice.visible, slice.label, state.viewScale)
        : slice),
      scientificProbe: state.scientificProbe?.sliceId === id ? null : state.scientificProbe,
      scientificProbeStatus: state.scientificProbe?.sliceId === id ? "idle" : state.scientificProbeStatus,
    };
  }),
  setScientificSlicePosition: (id, value) => set((state) => {
    if (!state.scientificField) return state;
    return {
      scientificSlices: state.scientificSlices.map((slice) => slice.id === id
        ? createScientificSlice(state.scientificField!.manifest, id, slice.axis, value, slice.opacity, slice.visible, slice.label, state.viewScale)
        : slice),
      scientificProbe: state.scientificProbe?.sliceId === id ? null : state.scientificProbe,
      scientificProbeStatus: state.scientificProbe?.sliceId === id ? "idle" : state.scientificProbeStatus,
    };
  }),
  setScientificSliceVisible: (id, visible) => set((state) => ({
    scientificSlices: state.scientificSlices.map((slice) => slice.id === id ? { ...slice, visible } : slice),
  })),
  setScientificSliceOpacity: (id, opacity) => set((state) => ({
    scientificSlices: state.scientificSlices.map((slice) => slice.id === id ? { ...slice, opacity: clampSliceOpacity(opacity) } : slice),
  })),
  setUseLogScale: (useLogScale) => set({ useLogScale }),
  setAllScientificSliceOpacity: (opacity) => set((state) => ({
    scientificSliceOpacity: clampSliceOpacity(opacity),
    scientificSlices: state.scientificSlices.map((slice) => ({ ...slice, opacity: clampSliceOpacity(opacity) })),
  })),
  probeScientificVoxel: async (sliceId, pointMm, moduleCellId, localSlicePositionMm) => {
    const state = get();
    if (!state.scientificField || state.visualizationMode !== "Slice" || state.scientificFieldStatus === "error") return;
    const slice = state.scientificSlices.find((item) => item.id === sliceId);
    if (!slice || !slice.visible) return;
    const indices = voxelFromPoint(
      state.scientificField.manifest,
      slice.axis,
      localSlicePositionMm ?? slice.requestedPositionMm,
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
      const selectedCell = state.viewScale === "module"
        ? MODULE_LAYOUT_V1.cells.find((cell) => cell.cellId === (moduleCellId ?? state.selectedCellId)) ?? null
        : null;
      const probe = buildVoxelProbe(
        state.scientificField.manifest,
        valuesByField,
        indices,
        sliceId,
        slice.axis,
        slice.label,
        selectedCell
          ? {
              cellId: selectedCell.cellId,
              row: selectedCell.row,
              column: selectedCell.column,
              q: selectedCell.q,
              r: selectedCell.r,
              translationMm: moduleCellTranslationMm(selectedCell),
            }
          : undefined,
      );
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
  setSectionViewEnabled: (sectionViewEnabled) => set({ sectionViewEnabled }),
  setSectionViewAxis: (sectionViewAxis) => set({ sectionViewAxis }),
  setSectionViewPosition: (sectionViewPositionMm) => set({ sectionViewPositionMm }),
  setSectionViewFlip: (sectionViewFlip) => set({ sectionViewFlip }),
  setViewScale: (viewScale) => set((state) => ({
    viewScale,
    selectedCellId: viewScale === "module" ? state.selectedCellId : null,
    scientificSlices: state.scientificField
      ? state.scientificSlices.map((slice) => createScientificSlice(state.scientificField!.manifest, slice.id, slice.axis, slice.requestedPositionMm, slice.opacity, slice.visible, slice.label, viewScale))
      : state.scientificSlices,
    scientificProbe: null,
    scientificProbeStatus: "idle",
    scientificProbeError: null,
    cameraCommand: { action: "fit", sequence: state.cameraCommand.sequence + 1 },
  })),
  selectCell: (selectedCellId) => set({ selectedCellId, scientificProbe: null, scientificProbeStatus: "idle", scientificProbeError: null }),
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
      scientificSlices: state.scientificSlices.length > 0
        ? state.scientificSlices
        : [createScientificSlice(manifest, "slice-1", manifest.slicing.default_axis, defaultSlicePosition(manifest, state.viewScale, manifest.slicing.default_axis), state.scientificSliceOpacity, true, undefined, state.viewScale)],
      activeScientificSliceId: state.activeScientificSliceId ?? (state.scientificSlices.length > 0 ? state.scientificSlices[0].id : "slice-1"),
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

export const MAX_SCIENTIFIC_SLICES = 6;

function clampSliceOpacity(opacity: number) {
  return Math.max(0.25, Math.min(1, opacity));
}

function nextSliceId(slices: ScientificSlice[]) {
  const used = new Set(slices.map((slice) => slice.id));
  let index = slices.length + 1;
  while (used.has(`slice-${index}`)) index += 1;
  return `slice-${index}`;
}

function createScientificSlice(
  manifest: ScientificFieldData["manifest"],
  id: string,
  axis: SliceAxis,
  requestedPositionMm: number,
  opacity: number,
  visible = true,
  label?: string,
  viewScale: ViewScale = "single-cell",
): ScientificSlice {
  const bounds = viewScale === "module" ? moduleAxisBounds(MODULE_LAYOUT_V1, axis) : axisBoundaries(manifest, axis);
  const boundedPosition = Math.min(bounds[1], Math.max(bounds[0], requestedPositionMm));
  const localBounds = axisBoundaries(manifest, axis);
  const localPosition = Math.min(localBounds.at(-1)!, Math.max(localBounds[0], boundedPosition));
  const layer = selectedLayer(manifest, axis, localPosition);
  return {
    id,
    axis,
    requestedPositionMm: boundedPosition,
    layerIndex: layer.index,
    lowerBoundMm: layer.bounds_mm[0],
    upperBoundMm: layer.bounds_mm[1],
    centerMm: layer.center_mm,
    visible,
    opacity: clampSliceOpacity(opacity),
    label: label ?? id,
  };
}

function defaultSlicePosition(manifest: ScientificFieldData["manifest"], viewScale: ViewScale, axis: SliceAxis) {
  if (viewScale === "module" && axis !== "Z") {
    const bounds = moduleAxisBounds(MODULE_LAYOUT_V1, axis);
    return (bounds[0] + bounds[1]) / 2;
  }
  return manifest.slicing.axes[axis].default_position_mm;
}
