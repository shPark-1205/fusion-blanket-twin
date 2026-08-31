import { create } from "zustand";
import { mockTwinState } from "./mock-twin-state";
import type { ComponentId, ComponentState, SliceAxis, VisualizationMode, WorkspaceSection } from "./twin-types";

export type CameraCommand = { action: "reset" | "fit"; sequence: number };

interface TwinUiState {
  section: WorkspaceSection;
  pz206: number;
  cz301: number;
  appliedPz206: number;
  appliedCz301: number;
  activeFieldId: string;
  visualizationMode: VisualizationMode;
  sliceAxis: SliceAxis;
  useLogScale: boolean;
  slicePositions: Record<SliceAxis, number>;
  selectedComponentId: ComponentId;
  componentVisibility: Record<ComponentId, boolean>;
  componentOpacity: Record<ComponentId, number>;
  cameraCommand: CameraCommand;
  setSection: (section: WorkspaceSection) => void;
  setPz206: (value: number) => void;
  setCz301: (value: number) => void;
  applyGeometry: () => void;
  resetGeometry: () => void;
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

export const useTwinStore = create<TwinUiState>((set) => ({
  section: "overview",
  pz206: mockTwinState.design.parameters.pz_206.value,
  cz301: mockTwinState.design.parameters.cz_301_radius.value,
  appliedPz206: mockTwinState.design.parameters.pz_206.value,
  appliedCz301: mockTwinState.design.parameters.cz_301_radius.value,
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
  setSection: (section) => set({ section }),
  setPz206: (pz206) => set({ pz206 }),
  setCz301: (cz301) => set({ cz301 }),
  applyGeometry: () => set((state) => ({ appliedPz206: state.pz206, appliedCz301: state.cz301 })),
  resetGeometry: () => set({
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
