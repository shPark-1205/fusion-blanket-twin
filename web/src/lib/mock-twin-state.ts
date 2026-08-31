import type { TwinState } from "./twin-types";

// Presentation-only state. A future backend adapter will satisfy the same contracts.
export const mockTwinState: TwinState = {
  design: {
    caseId: "REP-0326",
    breederRatio: 0.326,
    parameters: {
      pz_206: { id: "pz_206", label: "PZ 206", value: 5.6, min: 2.6, max: 5.6, step: 0.05, unit: "cm" },
      cz_301_radius: { id: "cz_301_radius", label: "CZ 301", value: 4.8, min: 3.6, max: 4.8, step: 0.01, unit: "cm" },
    },
  },
  kpis: { totalTbr: 1.233, li6Tbr: null, li7Tbr: null, multiplying: null },
  fields: [
    { id: "neutron_flux", displayName: "Neutron Flux", category: "Flux", units: "n/cm²/s", logRecommended: true, range: null },
    { id: "photon_flux", displayName: "Photon Flux", category: "Flux", units: "n/cm²/s", logRecommended: true, range: null },
    { id: "neutron_heating", displayName: "Neutron Heating", category: "Heating", units: "W/cm³", logRecommended: false, range: null },
    { id: "photon_heating", displayName: "Photon Heating", category: "Heating", units: "W/cm³", logRecommended: false, range: null },
    { id: "nuclear_heating", displayName: "Total Nuclear Heating", category: "Heating", units: "W/cm³", logRecommended: false, range: null },
  ],
  activeFieldId: "nuclear_heating",
  provenance: {
    geometry: "Parametric CSG",
    scalarKpis: "Simulation",
    field: "Not connected",
    cfxAvailable: false,
    experimentAvailable: false,
  },
  components: [
    { id: "armor", label: "Armor", color: "#92a2ad", visible: true, description: "Plasma-facing armor" },
    { id: "breeder", label: "Breeder", color: "#28b8c7", visible: true, description: "Solid breeder region" },
    { id: "multiplier", label: "Multiplier", color: "#d79a42", visible: true, description: "Neutron multiplier region" },
    { id: "structure", label: "Structure", color: "#657385", visible: true, description: "Structural material" },
    { id: "coolant", label: "Coolant", color: "#418bd4", visible: true, description: "Water coolant channel" },
  ],
  coolant: { medium: "Water", pressureMpa: 15.5, inletC: 295, outletC: 325 },
  nwlMwM2: 1.34,
};
