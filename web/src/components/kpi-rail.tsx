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
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: "cyan" | "amber";
}) {
  return (
    <div className={`kpi ${accent ? `kpi-${accent}` : ""}`}>
      <span>{label}</span>
      <strong>{value}<small>{unit}</small></strong>
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
  const activeField = mockTwinState.fields.find((field) => field.id === activeFieldId)!;
  const selectedComponent = mockTwinState.components.find((component) => component.id === selectedComponentId)!;

  return (
    <aside className="kpi-rail">
      <div className="rail-section kpi-section">
        <div className="rail-title"><span>PERFORMANCE</span><Badge tone="green">Simulation</Badge></div>
        <div className="kpi-grid">
          <Kpi label="Total TBR" value={mockTwinState.kpis.totalTbr.toFixed(3)} accent="cyan" />
          <Kpi label="Li-6 TBR" value="--" />
          <Kpi label="Li-7 TBR" value="--" />
          <Kpi label="Multiplying" value="--" />
        </div>
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
          <span>Active display<strong>{section === "neutronics" ? activeField.displayName : "Geometry preview"}</strong></span>
        </div>
      </div>

      <div className="rail-section provenance-section">
        <div className="rail-title"><span>DATA PROVENANCE</span><Database size={13} /></div>
        <ProvenanceRow label="Geometry" value={mockTwinState.provenance.geometry} />
        <ProvenanceRow label="Scalar KPI" value={mockTwinState.provenance.scalarKpis} />
        <ProvenanceRow label="Scientific 3D" value={mockTwinState.provenance.field} unavailable />
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
