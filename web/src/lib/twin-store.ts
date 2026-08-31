import { create } from "zustand";
import { mockTwinState } from "./mock-twin-state";
import { twinApi, TwinApiError } from "./twin-api";
import type {
  ComponentId,
  ComponentState,
  DesignDomain,
  PredictionStatus,
  ScalarPredictionResponse,
  SliceAxis,
  TwinApiHealth,
  TwinApiStatus,
  VisualizationMode,
  WorkspaceSection,
} from "./twin-types";

export type CameraCommand = { action: "reset" | "fit"; sequence: number };

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
  activeFieldId: string;
  visualizationMode: VisualizationMode;
  sliceAxis: SliceAxis;
  useLogScale: boolean;
  slicePositions: Record<SliceAxis, number>;
  selectedComponentId: ComponentId;
  componentVisibility: Record<ComponentId, boolean>;
  componentOpacity: Record<ComponentId, number>;
  cameraCommand: CameraCommand;
  initializeTwinApi: () => Promise<void>;
  setSection: (section: WorkspaceSection) => void;
  setPz206: (value: number) => void;
  setCz301: (value: number) => void;
  applyDesign: () => Promise<void>;
  resetDesign: () => void;
  setActiveField: (id: string) => void;
  setVisualizationMode: (mode: VisualizationMode) => void;
  setSliceAxis: (axis: SliceAxis) => void;
  setUseLogScale: (enabled: boolean) => void;
  setSlicePosition: (axis: SliceAxis, value: number) => void;
  selectComponent: (id: ComponentId) => void;
  toggleComponent: (id: ComponentId) => void;
  setComponentOpacity: (id: ComponentId, opacity: number) => void;
  requestCamera: (action: CameraCommand["action"]) => void;
}

let initializationPromise: Promise<void> | null = null;

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
  activeFieldId: mockTwinState.activeFieldId,
  visualizationMode: "Slice",
  sliceAxis: "Z",
  useLogScale: false,
  slicePositions: { X: 0, Y: 0, Z: 420 },
  selectedComponentId: "breeder",
  componentVisibility: Object.fromEntries(
    mockTwinState.components.map((component: ComponentState) => [component.id, component.visible]),
  ) as Record<ComponentId, boolean>,
  componentOpacity: { armor: 0.62, breeder: 1, multiplier: 0.82, structure: 0.38, coolant: 0.28 },
  cameraCommand: { action: "reset", sequence: 0 },
  initializeTwinApi: () => {
    initializationPromise ??= initializeTwinState();
    return initializationPromise;
  },
  setSection: (section) => set({ section }),
  setPz206: (pz206) => set({ pz206 }),
  setCz301: (cz301) => set({ cz301 }),
  applyDesign: async () => {
    const { pz206, cz301 } = get();
    set({ predictionStatus: "pending", predictionError: null });
    try {
      const prediction = await twinApi.predictScalars({ pz_206: pz206, cz_301_radius: cz301 });
      set({
        appliedPz206: prediction.design.pz_206,
        appliedCz301: prediction.design.cz_301_radius,
        apiStatus: "connected",
        prediction,
        predictionStatus: "success",
        predictionError: null,
      });
    } catch (error) {
      set({
        apiStatus: isBackendUnavailable(error) ? "offline" : "connected",
        predictionStatus: "error",
        predictionError: errorMessage(error),
      });
    }
  },
  resetDesign: () => set({
    pz206: mockTwinState.design.parameters.pz_206.value,
    cz301: mockTwinState.design.parameters.cz_301_radius.value,
  }),
  setActiveField: (activeFieldId) => set({ activeFieldId }),
  setVisualizationMode: (visualizationMode) => set({ visualizationMode }),
  setSliceAxis: (sliceAxis) => set({ sliceAxis }),
  setUseLogScale: (useLogScale) => set({ useLogScale }),
  setSlicePosition: (axis, value) => set((state) => ({ slicePositions: { ...state.slicePositions, [axis]: value } })),
  selectComponent: (selectedComponentId) => set({ selectedComponentId }),
  toggleComponent: (id) => set((state) => ({
    componentVisibility: { ...state.componentVisibility, [id]: !state.componentVisibility[id] },
  })),
  setComponentOpacity: (id, opacity) => set((state) => ({
    componentOpacity: { ...state.componentOpacity, [id]: Math.max(0.15, Math.min(1, opacity)) },
  })),
  requestCamera: (action) => set((state) => ({ cameraCommand: { action, sequence: state.cameraCommand.sequence + 1 } })),
}));

async function initializeTwinState(): Promise<void> {
  useTwinStore.setState({ apiStatus: "checking", predictionStatus: "idle", predictionError: null });
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

function isBackendUnavailable(error: unknown): boolean {
  return !(error instanceof TwinApiError) || error.status === null || error.status >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Scalar prediction failed.";
}
