"use client";

import { AlertTriangle, Check, CircleOff, Database, FlaskConical, RotateCcw, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";
import type { SliceAxis, VisualizationMode } from "@/lib/twin-types";

const sectionMeta = {
  overview: ["SYSTEM", "Twin overview"],
  design: ["GEOMETRY", "Design variables"],
  neutronics: ["MCNP", "Field controls"],
  "thermal-hydraulics": ["CFX", "Thermal-hydraulics"],
  performance: ["METRICS", "Performance"],
} as const;

function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="panel-heading">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
    </div>
  );
}

function MetricRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value} {unit && <small>{unit}</small>}</strong>
    </div>
  );
}

function ParameterControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  testId,
  unit = "cm",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  testId: string;
  unit?: "cm" | "mm";
}) {
  return (
    <div className="parameter-control">
      <div className="parameter-header">
        <label>{label}</label>
        <output data-testid={`${testId}-value`}>{value.toFixed(2)} <small>{unit}</small></output>
      </div>
      <Slider
        data-testid={testId}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
        aria-label={label}
      />
      <div className="range-labels"><span>{min.toFixed(2)}</span><span>{max.toFixed(2)}</span></div>
    </div>
  );
}

function OverviewControls() {
  const appliedPz206 = useTwinStore((state) => state.appliedPz206);
  const appliedCz301 = useTwinStore((state) => state.appliedCz301);
  const apiStatus = useTwinStore((state) => state.apiStatus);
  const prediction = useTwinStore((state) => state.prediction);
  return (
    <>
      <div className="status-block">
        <div className={`status-icon ${apiStatus === "connected" ? "status-icon-ok" : ""}`}><Check size={14} /></div>
        <div><strong>{apiStatus === "connected" ? "Python twin connected" : "CAD presentation available"}</strong><span>{apiStatus === "connected" ? "Scalar predictor ready" : "Scalar prediction API unavailable"}</span></div>
      </div>
      <div className="panel-section">
        <div className="section-label">DESIGN SNAPSHOT</div>
        <MetricRow label="PZ 206" value={appliedPz206.toFixed(2)} unit="cm" />
        <MetricRow label="CZ 301" value={appliedCz301.toFixed(2)} unit="cm" />
        <MetricRow label="Scalar source" value={prediction?.metadata.source === "simulation" ? "Simulation" : prediction ? "Surrogate" : "Unavailable"} />
      </div>
      <div className="panel-section">
        <div className="section-label">OPERATING BASIS</div>
        <MetricRow label="Coolant" value="Water" />
        <MetricRow label="Pressure" value="15.5" unit="MPa" />
        <MetricRow label="NWL" value="1.34" unit="MW/m²" />
      </div>
      <div className="info-note">
        <Database size={13} />
        <p>Scalar KPIs come from the Python twin API. The displayed GLB remains a fixed representative CAD asset; no vtk.js or MCNP field is connected.</p>
      </div>
    </>
  );
}

function DesignControls() {
  const pz206 = useTwinStore((state) => state.pz206);
  const cz301 = useTwinStore((state) => state.cz301);
  const appliedPz206 = useTwinStore((state) => state.appliedPz206);
  const appliedCz301 = useTwinStore((state) => state.appliedCz301);
  const designDomain = useTwinStore((state) => state.designDomain);
  const predictionStatus = useTwinStore((state) => state.predictionStatus);
  const predictionError = useTwinStore((state) => state.predictionError);
  const setPz206 = useTwinStore((state) => state.setPz206);
  const setCz301 = useTwinStore((state) => state.setCz301);
  const applyDesign = useTwinStore((state) => state.applyDesign);
  const resetDesign = useTwinStore((state) => state.resetDesign);
  const pz = mockTwinState.design.parameters.pz_206;
  const cz = mockTwinState.design.parameters.cz_301_radius;
  const pending = pz206 !== appliedPz206 || cz301 !== appliedCz301;
  const atDefaults = pz206 === pz.value && cz301 === cz.value;
  const pzDomain = designDomain?.pz_206;
  const czDomain = designDomain?.cz_301_radius;
  const applying = predictionStatus === "pending";
  const stateText = applying
    ? "Updating prediction…"
    : predictionStatus === "error"
      ? `${predictionError ?? "Prediction unavailable"}${pending ? " · design pending" : ""}`
      : pending
        ? "Prediction pending"
        : `Predicted · PZ ${appliedPz206.toFixed(2)} · CZ ${appliedCz301.toFixed(2)} cm`;

  return (
    <>
      <div className="panel-section panel-section-first">
        <div className="section-label">CURRENT DOE CONTROLS</div>
        <ParameterControl label="PZ 206" value={pz206} min={pzDomain?.minimum ?? pz.min} max={pzDomain?.maximum ?? pz.max} step={pz.step} onChange={setPz206} testId="pz-206-slider" />
        <ParameterControl label="CZ 301 radius" value={cz301} min={czDomain?.minimum ?? cz.min} max={czDomain?.maximum ?? cz.max} step={cz.step} onChange={setCz301} testId="cz-301-slider" />
        <div className="geometry-actions">
          <Button onClick={() => void applyDesign()} data-testid="apply-design" disabled={!pending || applying}>
            <ScanLine size={13} /> Apply Design
          </Button>
          <Button variant="outline" onClick={resetDesign} data-testid="reset-design" disabled={atDefaults || applying}>
            <RotateCcw size={13} /> Reset
          </Button>
        </div>
        <div className={`apply-state ${(pending || applying || predictionStatus === "error") ? "apply-state-pending" : ""}`} data-testid="prediction-status">
          <span />{stateText}
        </div>
      </div>
      <div className="design-space">
        <div className="section-label">DESIGN SPACE / 10 × 10 DOE</div>
        <div className="doe-grid" aria-label="Design-space position">
          {Array.from({ length: 100 }, (_, i) => <i key={i} className={i === 99 ? "active" : ""} />)}
        </div>
        <div className="range-labels"><span>PZ GROUP</span><span>CZ GROUP</span></div>
      </div>
      <div className="info-note">
        <FlaskConical size={13} />
        <p>Apply Design requests real scalar KPIs. The Web CAD asset is fixed and does not deform to these PZ/CZ values; parametric web geometry is not connected.</p>
      </div>
    </>
  );
}

function NeutronicsControls() {
  const fieldId = useTwinStore((state) => state.activeFieldId);
  const mode = useTwinStore((state) => state.visualizationMode);
  const axis = useTwinStore((state) => state.sliceAxis);
  const log = useTwinStore((state) => state.useLogScale);
  const slicePositions = useTwinStore((state) => state.slicePositions);
  const setField = useTwinStore((state) => state.setActiveField);
  const setMode = useTwinStore((state) => state.setVisualizationMode);
  const setAxis = useTwinStore((state) => state.setSliceAxis);
  const setLog = useTwinStore((state) => state.setUseLogScale);
  const setSlicePosition = useTwinStore((state) => state.setSlicePosition);
  const active = mockTwinState.fields.find((field) => field.id === fieldId)!;

  return (
    <>
      <div className="panel-section panel-section-first">
        <label className="section-label" htmlFor="field-selector">ACTIVE FIELD</label>
        <select id="field-selector" data-testid="field-selector" value={fieldId} onChange={(event) => setField(event.target.value)} className="technical-select">
          {mockTwinState.fields.map((field) => <option key={field.id} value={field.id}>{field.displayName}</option>)}
        </select>
        <div className="field-meta">
          <Badge tone={active.category === "Heating" ? "amber" : "cyan"}>{active.category}</Badge>
          <span>{active.units}</span>
        </div>
      </div>
      <div className="panel-section">
        <div className="section-label">VISUALIZATION MODE</div>
        <ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as VisualizationMode)} className="segmented" data-testid="visualization-mode">
          {(["Off", "Slice", "Iso-surface"] as VisualizationMode[]).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`mode-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className="panel-section">
        <div className="section-label">SLICE AXIS</div>
        <ToggleGroup type="single" value={axis} onValueChange={(value) => value && setAxis(value as SliceAxis)} className="segmented">
          {(["X", "Y", "Z"] as SliceAxis[]).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`axis-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
        </ToggleGroup>
        <ParameterControl
          label={`${axis} position`}
          value={slicePositions[axis]}
          min={axis === "Z" ? 0 : -73}
          max={axis === "Z" ? 921 : 73}
          step={1}
          onChange={(value) => setSlicePosition(axis, value)}
          testId="slice-position"
          unit="mm"
        />
      </div>
      <label className="switch-row">
        <span><strong>Logarithmic scale</strong><small>{active.logRecommended ? "Recommended for this field" : "Linear display default"}</small></span>
        <input type="checkbox" checked={log} onChange={(event) => setLog(event.target.checked)} data-testid="log-scale" />
        <i />
      </label>
      <MetricRow label="Display state" value={`${mode} · ${axis} · ${slicePositions[axis]} mm · ${log ? "Log" : "Linear"}`} />
      <MetricRow label="Field range" value="Unavailable" />
      <div className="info-note"><AlertTriangle size={13} /><p>Mock/local display state only. No MCNP values, contours, slices, or iso-surfaces are rendered.</p></div>
    </>
  );
}

function ThermalControls() {
  return (
    <>
      <div className="unavailable-block">
        <div className="status-icon"><CircleOff size={17} /></div>
        <Badge tone="muted">Unavailable</Badge>
        <h2>CFX dataset not connected</h2>
        <p>The interface is prepared for future thermal-hydraulics fields without implying an active data connection.</p>
      </div>
      <div className="panel-section">
        <div className="section-label">FUTURE FIELD CATALOG</div>
        {["Solid Temperature", "Coolant Temperature", "Pressure", "Velocity"].map((field) => (
          <div className="disabled-field" key={field} aria-disabled="true"><span>{field}</span><small>Unavailable</small></div>
        ))}
      </div>
      <div className="info-note"><Database size={13} /><p>CFX integration, field ingestion, and coupled validation are outside this milestone.</p></div>
    </>
  );
}

function PerformanceControls() {
  const prediction = useTwinStore((state) => state.prediction);
  const predictionStatus = useTwinStore((state) => state.predictionStatus);
  const source = prediction?.metadata.source === "simulation" ? "Simulation" : "Surrogate Prediction";
  return (
    <>
      <div className="panel-section panel-section-first">
        <div className="section-label">BREEDING PERFORMANCE</div>
        <div className="primary-reading"><span>Total TBR</span><strong>{prediction ? prediction.kpis.total_tbr.toFixed(5) : "--"}</strong><Badge tone={prediction?.metadata.source === "simulation" ? "green" : "cyan"}>{predictionStatus === "pending" ? "Updating" : prediction ? source : "Unavailable"}</Badge></div>
      </div>
      <div className="panel-section">
        <MetricRow label="Li-6 TBR" value={prediction ? prediction.kpis.li6_tbr.toFixed(5) : "--"} />
        <MetricRow label="Li-7 TBR" value={prediction ? prediction.kpis.li7_tbr.toFixed(5) : "--"} />
        <MetricRow label="Multiplying" value={prediction ? prediction.kpis.multiplying.toFixed(5) : "--"} />
      </div>
      <div className="panel-section">
        <div className="section-label">REFERENCE CONDITIONS</div>
        <MetricRow label="Breeder fraction" value="0.326" />
        <MetricRow label="NWL" value="1.34" unit="MW/m²" />
      </div>
      <div className="info-note"><FlaskConical size={13} /><p>Values are returned by the Python ScalarPredictionService. Exact DOE coordinates use simulation results; other points are labeled surrogate predictions.</p></div>
    </>
  );
}

export function ControlPanel() {
  const section = useTwinStore((state) => state.section);
  const [eyebrow, title] = sectionMeta[section];
  return (
    <aside className="control-panel" data-testid="control-panel">
      <PanelHeading eyebrow={eyebrow} title={title} />
      <div className="control-scroll">
        {section === "overview" && <OverviewControls />}
        {section === "design" && <DesignControls />}
        {section === "neutronics" && <NeutronicsControls />}
        {section === "thermal-hydraulics" && <ThermalControls />}
        {section === "performance" && <PerformanceControls />}
      </div>
    </aside>
  );
}
