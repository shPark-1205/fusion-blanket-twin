export type WorkspaceSection =
  | "overview"
  | "design"
  | "neutronics"
  | "thermal-hydraulics"
  | "performance";

export type GeometrySource = "Parametric CSG" | "STEP";
export type ScalarSource = "Simulation" | "Surrogate Prediction";
export type FieldSource = "Not connected";
export type VisualizationMode = "Off" | "Slice" | "Iso-surface";
export type SliceAxis = "X" | "Y" | "Z";
export type ComponentId = "armor" | "breeder" | "multiplier" | "structure" | "coolant";

export interface DesignParameter {
  id: "pz_206" | "cz_301_radius";
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: "cm";
}

export interface DesignState {
  caseId: string;
  parameters: Record<DesignParameter["id"], DesignParameter>;
  breederRatio: number;
}

export interface ScalarKPIs {
  totalTbr: number;
  li6Tbr: number | null;
  li7Tbr: number | null;
  multiplying: number | null;
}

export interface FieldMetadata {
  id: string;
  displayName: string;
  category: "Flux" | "Heating";
  units: string;
  logRecommended: boolean;
  range: [number, number] | null;
}

export interface TwinProvenance {
  geometry: GeometrySource;
  scalarKpis: ScalarSource;
  field: FieldSource;
  cfxAvailable: boolean;
  experimentAvailable: boolean;
}

export interface ComponentState {
  id: ComponentId;
  label: "Armor" | "Breeder" | "Multiplier" | "Structure" | "Coolant";
  color: string;
  visible: boolean;
  description: string;
}

export interface TwinState {
  design: DesignState;
  kpis: ScalarKPIs;
  fields: FieldMetadata[];
  activeFieldId: string;
  provenance: TwinProvenance;
  components: ComponentState[];
  coolant: { medium: string; pressureMpa: number; inletC: number; outletC: number };
  nwlMwM2: number;
}
