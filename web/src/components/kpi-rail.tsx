"use client";

import { Box, CircleOff, Database, Layers3, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";

function Kpi({
  label,
  value,
  unit,
  accent,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: "cyan" | "amber";
  testId?: string;
}) {
  return (
    <div className={`kpi ${accent ? `kpi-${accent}` : ""}`}>
      <span>{label}</span>
      <strong data-testid={testId}>{value}<small>{unit}</small></strong>
      <i />
    </div>
  );
}

function ProvenanceRow({
  label,
  value,
  unavailable,
}: {
  label: string;
  value: string;
  unavailable?: boolean;
}) {
  return (
    <div className="provenance-row">
      <span>{label}</span>
      <strong className={unavailable ? "is-unavailable" : ""}>
        {unavailable ? <CircleOff size={10} /> : <ShieldCheck size={10} />}
        {value}
      </strong>
    </div>
  );
}

export function KpiRail() {
  const section = useTwinStore((state) => state.section);
  const activeFieldId = useTwinStore((state) => state.activeFieldId);
  const selectedComponentId = useTwinStore((state) => state.selectedComponentId);
  const componentVisibility = useTwinStore((state) => state.componentVisibility);
  const componentOpacity = useTwinStore((state) => state.componentOpacity);
  const setComponentOpacity = useTwinStore((state) => state.setComponentOpacity);
  const prediction = useTwinStore((state) => state.prediction);
  const predictionStatus = useTwinStore((state) => state.predictionStatus);
  const predictionError = useTwinStore((state) => state.predictionError);
  const scientificStatus = useTwinStore((state) => state.scientificFieldStatus);
  const activeField = mockTwinState.fields.find((field) => field.id === activeFieldId)!;
  const selectedComponent = mockTwinState.components.find((component) => component.id === selectedComponentId)!;
  const scalarSource = prediction?.metadata.source === "simulation" ? "Simulation" : "Surrogate Prediction";
  const scalarBadge = predictionStatus === "pending" ? "Updating" : prediction ? scalarSource : "Unavailable";

  return (
    <aside className="kpi-rail">
      <div className="rail-section kpi-section">
        <div className="rail-title"><span>PERFORMANCE</span><Badge tone={prediction?.metadata.source === "simulation" ? "green" : prediction ? "cyan" : "muted"} data-testid="scalar-source">{scalarBadge}</Badge></div>
        <div className="kpi-grid">
          <Kpi label="Total TBR" value={prediction ? prediction.kpis.total_tbr.toFixed(5) : "--"} accent="cyan" testId="kpi-total-tbr" />
          <Kpi label="Li-6 TBR" value={prediction ? prediction.kpis.li6_tbr.toFixed(5) : "--"} testId="kpi-li6-tbr" />
          <Kpi label="Li-7 TBR" value={prediction ? prediction.kpis.li7_tbr.toFixed(5) : "--"} testId="kpi-li7-tbr" />
          <Kpi label="Multiplying" value={prediction ? prediction.kpis.multiplying.toFixed(5) : "--"} testId="kpi-multiplying" />
        </div>
        {predictionStatus === "pending" && <div className="prediction-message" data-testid="prediction-updating">Updating prediction…</div>}
        {predictionStatus === "error" && <div className="prediction-message prediction-message-error" data-testid="prediction-error">{predictionError}</div>}
        {prediction?.metadata.warning && <div className="prediction-message prediction-message-warning" data-testid="extrapolation-warning">{prediction.metadata.warning}</div>}
      </div>

      <div className="rail-section selected-section">
        <div className="rail-title"><span>SELECTED COMPONENT</span><Layers3 size={13} /></div>
        <div className="component-readout">
          <div className="component-symbol"><Box size={18} /></div>
          <div><strong data-testid="selected-component-name">{selectedComponent.label}</strong><span>{selectedComponent.description}</span></div>
          <Badge tone={componentVisibility[selectedComponentId] ? "cyan" : "muted"}>{componentVisibility[selectedComponentId] ? "Visible" : "Hidden"}</Badge>
        </div>
        <div className="compact-pairs">
          <span>Component state<strong>{componentVisibility[selectedComponentId] ? "Shown" : "Hidden"}</strong></span>
          <span>Active display<strong>{section === "neutronics" ? activeField.displayName : "Web CAD"}</strong></span>
        </div>
        <label className="opacity-control">
          <span>Presentation opacity <output data-testid="component-opacity-value">{Math.round(componentOpacity[selectedComponentId] * 100)}%</output></span>
          <input
            type="range"
            min="15"
            max="100"
            step="5"
            value={Math.round(componentOpacity[selectedComponentId] * 100)}
            aria-label={`${selectedComponent.label} opacity`}
            data-testid="component-opacity"
            onChange={(event) => setComponentOpacity(selectedComponentId, Number(event.target.value) / 100)}
          />
        </label>
      </div>

      <div className="rail-section provenance-section">
        <div className="rail-title"><span>DATA PROVENANCE</span><Database size={13} /></div>
        <ProvenanceRow label="Geometry" value="GLB derived from STEP" />
        <ProvenanceRow label="Scalar KPIs" value={prediction ? scalarSource : "Unavailable"} unavailable={!prediction} />
        <ProvenanceRow label="Domain state" value={prediction?.metadata.domain_status ?? "Unavailable"} unavailable={!prediction} />
        <ProvenanceRow label="Nearest simulation" value={prediction?.metadata.nearest_case ?? "Unavailable"} unavailable={!prediction} />
        <ProvenanceRow label="3D scientific field" value={scientificStatus === "ready" ? "Loaded MCNP Simulation" : scientificStatus === "error" ? "Asset unavailable" : "Loading"} unavailable={scientificStatus !== "ready"} />
        <ProvenanceRow label="Field" value={scientificStatus === "ready" ? "Total Nuclear Heating" : "Unavailable"} unavailable={scientificStatus !== "ready"} />
        <ProvenanceRow label="Thermal / CFX" value="Unavailable" unavailable />
        <ProvenanceRow label="Experiment" value="Future / unavailable" unavailable />
      </div>

      <div className="rail-disclaimer">
        <span>VIRTUAL BLANKET</span>
        <p>No live sensor or experimental connection is active.</p>
      </div>
    </aside>
  );
}
