"use client";

import { AlertTriangle, Check, CircleOff, Database, FlaskConical, RotateCcw, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";
import type { ScientificFieldId, SliceAxis, VisualizationMode } from "@/lib/twin-types";
import { axisBoundaries, selectedLayer } from "@/lib/scientific-field";

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
        <p>Scalar KPIs come from the Python twin API. The GLB remains fixed; the reference MCNP field is loaded independently and never follows arbitrary PZ/CZ selections.</p>
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
  const scientificStatus = useTwinStore((state) => state.scientificFieldStatus);
  const scientificField = useTwinStore((state) => state.scientificField);
  const scientificError = useTwinStore((state) => state.scientificFieldError);
  const probe = useTwinStore((state) => state.scientificProbe);
  const probeStatus = useTwinStore((state) => state.scientificProbeStatus);
  const probeError = useTwinStore((state) => state.scientificProbeError);
  const probeVoxel = useTwinStore((state) => state.probeScientificVoxel);
  const clearProbe = useTwinStore((state) => state.clearScientificProbe);
  const active = scientificField?.manifest.fields[fieldId] ?? mockTwinState.fields.find((field) => field.id === fieldId)!;
  const activeDisplayName = "display_name" in active ? active.display_name : active.displayName;
  const activeCategory = "quantity_type" in active ? active.quantity_type : active.category;
  const activeUnits = "display_units" in active ? active.display_units : active.units;
  const currentBoundaries = scientificField ? axisBoundaries(scientificField.manifest, axis) : [0, 921];
  const layerMetadata = scientificField ? selectedLayer(scientificField.manifest, axis, slicePositions[axis]) : null;
  const sliceRange = scientificField ? scientificField.manifest.fields[fieldId].slice_ranges[axis][layerMetadata!.index] : null;
  const statusLabel = scientificStatus === "ready"
    ? "Loaded MCNP Simulation"
    : scientificStatus === "error"
      ? "Scientific asset unavailable"
      : scientificStatus.replaceAll("-", " ");
  const displayScale = log ? "Log" : "Linear";
  const logDisabled = !scientificField || !scientificField.manifest.fields[fieldId].log_scale_supported;
  const probeLayerCenter = () => {
    if (!scientificField || !layerMetadata) return;
    const x = axisBoundaries(scientificField.manifest, "X");
    const y = axisBoundaries(scientificField.manifest, "Y");
    const z = axisBoundaries(scientificField.manifest, "Z");
    const point: [number, number, number] = [
      (x[0] + x[x.length - 1]) / 2,
      (y[0] + y[y.length - 1]) / 2,
      (z[0] + z[z.length - 1]) / 2,
    ];
    point[axis === "X" ? 0 : axis === "Y" ? 1 : 2] = layerMetadata.center_mm;
    void probeVoxel(point);
  };

  return (
    <>
      <div className="panel-section panel-section-first">
        <label className="section-label" htmlFor="field-selector">ACTIVE FIELD</label>
        <select
          id="field-selector"
          data-testid="field-selector"
          value={fieldId}
          disabled={!scientificField}
          className="technical-select"
          onChange={(event) => setField(event.target.value as ScientificFieldId)}
        >
          {(scientificField?.manifest.field_order ?? mockTwinState.fields.map((field) => field.id)).map((id) => {
            const field = scientificField?.manifest.fields[id] ?? mockTwinState.fields.find((item) => item.id === id)!;
            const displayName = "display_name" in field ? field.display_name : field.displayName;
            return <option key={id} value={id}>{displayName}</option>;
          })}
        </select>
        <div className="field-meta">
          <Badge tone={activeCategory === "Heating" ? "amber" : "cyan"}>{activeCategory}</Badge>
          <span>{activeUnits}</span>
        </div>
      </div>
      <div className="panel-section">
        <div className="section-label">VISUALIZATION MODE</div>
        <ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as VisualizationMode)} className="segmented" data-testid="visualization-mode">
          {(["Off", "Slice"] as VisualizationMode[]).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`mode-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
          <ToggleGroupItem value="Iso-surface" data-testid="mode-iso-surface" disabled title="Unavailable in this milestone">Iso</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="panel-section">
        <div className="section-label">SLICE AXIS</div>
        <ToggleGroup type="single" value={axis} onValueChange={(value) => value && setAxis(value as SliceAxis)} className="segmented" data-testid="slice-axis">
          {(["X", "Y", "Z"] as SliceAxis[]).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`axis-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
        </ToggleGroup>
        <ParameterControl
          label={`${axis} position`}
          value={slicePositions[axis]}
          min={currentBoundaries[0]}
          max={currentBoundaries.at(-1)!}
          step={1}
          onChange={(value) => setSlicePosition(axis, value)}
          testId="slice-position"
          unit="mm"
        />
      </div>
      <label className="switch-row">
        <span><strong>Logarithmic scale</strong><small>{logDisabled ? "Unavailable for non-positive-only data" : "Visualization-only · zero cells use the below-range color"}</small></span>
        <input type="checkbox" checked={log && !logDisabled} disabled={logDisabled} onChange={(event) => setLog(event.target.checked)} data-testid="log-scale" />
        <i />
      </label>
      <MetricRow label="Display state" value={`${mode} · ${axis} · ${slicePositions[axis].toFixed(1)} mm · ${displayScale}`} />
      <MetricRow label={`Containing ${axis} layer`} value={layerMetadata ? `${layerMetadata.bounds_mm[0].toFixed(1)} – ${layerMetadata.bounds_mm[1].toFixed(1)}` : "Unavailable"} unit={layerMetadata ? "mm" : undefined} />
      <MetricRow label="Rendered at center" value={layerMetadata ? layerMetadata.center_mm.toFixed(1) : "Unavailable"} unit={layerMetadata ? "mm" : undefined} />
      <MetricRow label="Global range" value={scientificField ? `${scientificField.manifest.fields[fieldId].web_range[0].toExponential(3)} – ${scientificField.manifest.fields[fieldId].web_range[1].toExponential(3)}` : "Unavailable"} unit={scientificField ? scientificField.manifest.fields[fieldId].display_units : undefined} />
      <MetricRow label="Slice range" value={sliceRange ? `${sliceRange[0].toExponential(3)} – ${sliceRange[1].toExponential(3)}` : "Unavailable"} unit={sliceRange ? scientificField?.manifest.fields[fieldId].display_units : undefined} />
      <MetricRow label="3D field" value={statusLabel} />
      <div className="probe-panel" data-testid="probe-panel">
        <div className="section-label">RAW VOXEL PROBE</div>
        {probeStatus === "loading" && <p data-testid="probe-loading">Loading all field values for probe…</p>}
        {probeStatus === "error" && <p data-testid="probe-error">{probeError}</p>}
        {probe ? (
          <>
            <div className="probe-heading">
              <strong data-testid="probe-indices">i {probe.indices.i} · j {probe.indices.j} · k {probe.indices.k}</strong>
              <Button variant="ghost" size="sm" onClick={clearProbe} data-testid="clear-probe">Clear</Button>
            </div>
            <MetricRow label="X interval" value={`${probe.boundsMm.x[0].toFixed(1)} – ${probe.boundsMm.x[1].toFixed(1)}`} unit="mm" />
            <MetricRow label="Y interval" value={`${probe.boundsMm.y[0].toFixed(1)} – ${probe.boundsMm.y[1].toFixed(1)}`} unit="mm" />
            <MetricRow label="Z interval" value={`${probe.boundsMm.z[0].toFixed(1)} – ${probe.boundsMm.z[1].toFixed(1)}`} unit="mm" />
            <MetricRow label="Cell center" value={probe.centerMm.map((value) => value.toFixed(1)).join(", ")} unit="mm" />
            <div className="probe-subheading">PHYSICAL QUANTITIES</div>
            {scientificField?.manifest.field_order.map((id) => (
              <MetricRow key={id} label={scientificField.manifest.fields[id].display_name} value={probe.values[id].toExponential(4)} unit={scientificField.manifest.fields[id].display_units} />
            ))}
            <div
              className="probe-validation"
              data-testid="heating-consistency"
              title="Numerical consistency check: Nuclear Heating - (Neutron Heating + Photon Heating)"
            >
              <span><Check size={13} /> Heating consistency</span>
              <small>Residual: {probe.nuclearHeatingConsistency.difference.toExponential(3)} W/cm³</small>
              <p>Nuclear Heating − (Neutron Heating + Photon Heating)</p>
            </div>
          </>
        ) : probeStatus !== "loading" && probeStatus !== "error" ? (
          <>
            <p>Click the active slice to inspect one raw MCNP voxel.</p>
            <Button variant="outline" size="sm" onClick={probeLayerCenter} disabled={!scientificField || mode !== "Slice"} data-testid="probe-layer-center">Probe Layer Center</Button>
          </>
        ) : null}
      </div>
      <div className="info-note"><AlertTriangle size={13} /><p>{scientificStatus === "error" ? `${scientificError} CAD and scalar prediction remain available.` : `Reference MCNP simulation · ${activeDisplayName} raw containing-voxel cell values · no interpolation. This field does not follow the selected design.`}</p></div>
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
