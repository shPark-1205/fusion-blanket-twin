export type WorkspaceSection =
  | "overview"
  | "design"
  | "neutronics"
  | "thermal-hydraulics"
  | "performance";

export type GeometrySource = "Parametric CSG" | "STEP" | "Fixed representative GLB";
export type ScalarSource = "Simulation" | "Surrogate Prediction";
export type FieldSource = "Not connected" | "Reference MCNP Field";
export type VisualizationMode = "Off" | "Slice" | "Iso-surface";
export type SliceAxis = "X" | "Y" | "Z";
export type ComponentId = "armor" | "breeder" | "multiplier" | "structure" | "coolant";
export type ViewScale = "single-cell" | "module";
export type ScientificFieldId =
  | "neutron_flux"
  | "photon_flux"
  | "neutron_heating"
  | "photon_heating"
  | "nuclear_heating";

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

export type TwinApiStatus = "checking" | "connected" | "offline";
export type PredictionStatus = "idle" | "pending" | "success" | "error";
export type GeometryStatus = "idle" | "loading" | "success" | "error";

export interface TwinApiHealth {
  status: "ok" | "degraded";
  api_version: string;
  scalar_prediction: "ready" | "unavailable";
  case_count: number;
  startup_seconds: number;
}

export interface DesignVariableDomain {
  minimum: number;
  maximum: number;
  levels: number[];
  unit: "cm";
}

export interface DesignDomain {
  pz_206: DesignVariableDomain;
  cz_301_radius: DesignVariableDomain;
}

export interface ScalarPredictionRequest {
  pz_206: number;
  cz_301_radius: number;
}

export interface ScalarPredictionResponse {
  design: ScalarPredictionRequest & {
    units: { pz_206: "cm"; cz_301_radius: "cm" };
  };
  kpis: {
    total_tbr: number;
    li6_tbr: number;
    li7_tbr: number;
    multiplying: number;
  };
  metadata: {
    source: "simulation" | "surrogate";
    status: "exact" | "predicted";
    domain_status: "exact" | "boundary" | "interpolation" | "extrapolation";
    warning: string | null;
    nearest_case: string;
    nearest_design: ScalarPredictionRequest & { units: { pz_206: "cm"; cz_301_radius: "cm" } };
    nearest_distance: number;
    model_name: string;
    model_metadata: Record<string, unknown>;
  };
}

export interface FieldMetadata {
  id: ScientificFieldId;
  displayName: string;
  category: "Flux" | "Heating";
  units: string;
  logRecommended: boolean;
  range: [number, number] | null;
}

export interface ScientificSlice {
  id: string;
  axis: SliceAxis;
  requestedPositionMm: number;
  layerIndex: number;
  lowerBoundMm: number;
  upperBoundMm: number;
  centerMm: number;
  visible: boolean;
  opacity: number;
  label?: string;
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
  fields: FieldMetadata[];
  activeFieldId: ScientificFieldId;
  provenance: TwinProvenance;
  components: ComponentState[];
  coolant: { medium: string; pressureMpa: number; inletC: number; outletC: number };
  nwlMwM2: number;
}
