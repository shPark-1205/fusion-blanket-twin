"use client";

import { AlertTriangle, Check, CircleOff, Database, Eye, EyeOff, FlaskConical, Plus, RotateCcw, ScanLine, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BLANKET_GEOMETRY_ADAPTER } from "@/lib/blanket-geometry";
import { mockTwinState } from "@/lib/mock-twin-state";
import { MODULE_LAYOUT_V1, moduleAxisBounds, moduleCellTranslationMm, moduleCellsIntersectingSlice } from "@/lib/module-layout";
import { MAX_SCIENTIFIC_SLICES, useTwinStore } from "@/lib/twin-store";
import type { ScientificFieldId, ScientificSlice, SliceAxis, ViewScale, VisualizationMode } from "@/lib/twin-types";
import { axisBoundaries } from "@/lib/scientific-field";
import type { CSSProperties } from "react";

const sectionMeta = {
  overview: ["SYSTEM", "Twin overview"],
  design: ["GEOMETRY", "Design variables"],
  neutronics: ["MCNP", "Field controls"],
  "thermal-hydraulics": ["CFX", "Thermal-hydraulics"],
  performance: ["METRICS", "Performance"],
} as const;

const moduleMapBounds = {
  minX: Math.min(...MODULE_LAYOUT_V1.cells.map((cell) => cell.positionMm.x)),
  maxX: Math.max(...MODULE_LAYOUT_V1.cells.map((cell) => cell.positionMm.x)),
  minY: Math.min(...MODULE_LAYOUT_V1.cells.map((cell) => cell.positionMm.y)),
  maxY: Math.max(...MODULE_LAYOUT_V1.cells.map((cell) => cell.positionMm.y)),
};

function moduleCellMapStyle(cell: (typeof MODULE_LAYOUT_V1.cells)[number]): CSSProperties {
  const xRange = moduleMapBounds.maxX - moduleMapBounds.minX;
  const yRange = moduleMapBounds.maxY - moduleMapBounds.minY;
  const mapPaddingX = 8;
  const mapPaddingY = 12;
  return {
    left: `${mapPaddingX + ((cell.positionMm.x - moduleMapBounds.minX) / xRange) * (100 - mapPaddingX * 2)}%`,
    top: `${mapPaddingY + ((moduleMapBounds.maxY - cell.positionMm.y) / yRange) * (100 - mapPaddingY * 2)}%`,
  };
}

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

function ScaleModeControls() {
  const viewScale = useTwinStore((state) => state.viewScale);
  const selectedCellId = useTwinStore((state) => state.selectedCellId);
  const setViewScale = useTwinStore((state) => state.setViewScale);
  const selectCell = useTwinStore((state) => state.selectCell);
  const selectedCell = MODULE_LAYOUT_V1.cells.find((cell) => cell.cellId === selectedCellId) ?? null;
  return (
    <div className="panel-section panel-section-first scale-mode-controls" data-testid="scale-mode-controls">
      <div className="section-label">VIEW SCALE</div>
      <ToggleGroup type="single" value={viewScale} onValueChange={(value) => value && setViewScale(value as ViewScale)} className="segmented" data-testid="view-scale-toggle">
        <ToggleGroupItem value="single-cell" data-testid="view-scale-single-cell">Single Cell</ToggleGroupItem>
        <ToggleGroupItem value="module" data-testid="view-scale-module">Module</ToggleGroupItem>
      </ToggleGroup>
      {viewScale === "module" ? (
        <div className="module-layout-summary" data-testid="module-layout-summary">
          <div><strong>Module Layout V1</strong><span data-testid="module-cell-count">{MODULE_LAYOUT_V1.cellCount} cells · geometry only</span></div>
          {selectedCell ? (
            <div className="selected-cell-summary" data-testid="selected-cell-info">
              <strong>{selectedCell.cellId}</strong>
              <span>row {selectedCell.row} · column {selectedCell.column} · q {selectedCell.q} · r {selectedCell.r}</span>
              <span>center {selectedCell.positionMm.x.toFixed(1)}, {selectedCell.positionMm.y.toFixed(1)}, {selectedCell.positionMm.z.toFixed(1)} mm</span>
            </div>
          ) : <span data-testid="selected-cell-info">Select a cell to inspect its shared design.</span>}
          <div className="module-cell-map" aria-label="Module cell occupancy">
            {MODULE_LAYOUT_V1.cells.map((cell) => (
              <button
                type="button"
                key={cell.cellId}
                className={selectedCellId === cell.cellId ? "is-selected" : ""}
                style={moduleCellMapStyle(cell)}
                onClick={() => selectCell(cell.cellId)}
                aria-label={`Select ${cell.cellId}`}
                aria-pressed={selectedCellId === cell.cellId}
                data-testid={`module-cell-${cell.cellId}`}
              >R{cell.row}C{cell.column}</button>
            ))}
          </div>
          <span data-testid="module-pitch-definition">Fixed pitch X {MODULE_LAYOUT_V1.pitchDefinition.pitchXmm.toFixed(2)} mm · Y {MODULE_LAYOUT_V1.pitchDefinition.pitchYmm.toFixed(2)} mm</span>
          <small>Fixed pitch from the unit-cell outer RAFM hex. No module-scale field data.</small>
        </div>
      ) : <p className="control-help">The stabilized single-cell viewer remains the default scale.</p>}
    </div>
  );
}

function ComponentDisplayControls() {
  const selectedId = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const opacity = useTwinStore((state) => state.componentOpacity);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const toggleComponent = useTwinStore((state) => state.toggleComponent);
  const setOpacity = useTwinStore((state) => state.setComponentOpacity);

  return (
    <div className="panel-section display-controls" data-testid="component-display-controls">
      <div className="section-label">COMPONENT DISPLAY</div>
      <p className="control-help">Select, hide, or adjust group opacity without changing the generated geometry.</p>
      {mockTwinState.components.map((component) => (
        <div className={`component-display-row ${selectedId === component.id ? "is-selected" : ""}`} key={component.id}>
          <div className="component-display-heading">
            <button type="button" onClick={() => selectComponent(component.id)} aria-pressed={selectedId === component.id} data-testid={`component-${component.id}`}>
              <i style={{ backgroundColor: component.color }} />{component.label}
            </button>
            <button type="button" className="component-display-visibility" onClick={() => toggleComponent(component.id)} aria-label={`${visibility[component.id] ? "Hide" : "Show"} ${component.label}`} aria-pressed={visibility[component.id]} data-testid={`visibility-${component.id}`}>
              {visibility[component.id] ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          </div>
          <label className="opacity-control">
            <span><strong>Opacity</strong><output data-testid={`opacity-${component.id}`}>{Math.round(opacity[component.id] * 100)}%</output></span>
            <input
              type="range"
              min="15"
              max="100"
              step="5"
              value={Math.round(opacity[component.id] * 100)}
              aria-label={`${component.label} opacity`}
              data-testid={`opacity-slider-${component.id}`}
              onChange={(event) => setOpacity(component.id, Number(event.target.value) / 100)}
            />
          </label>
          <small>{visibility[component.id] ? "Visible" : "Hidden"}</small>
        </div>
      ))}
    </div>
  );
}

function GeometrySectionControls() {
  const enabled = useTwinStore((state) => state.sectionViewEnabled);
  const axis = useTwinStore((state) => state.sectionViewAxis);
  const positionMm = useTwinStore((state) => state.sectionViewPositionMm);
  const flip = useTwinStore((state) => state.sectionViewFlip);
  const viewScale = useTwinStore((state) => state.viewScale);
  const geometryBounds = useTwinStore((state) => state.geometry?.bounds_mm ?? null);
  const setEnabled = useTwinStore((state) => state.setSectionViewEnabled);
  const setAxis = useTwinStore((state) => state.setSectionViewAxis);
  const setPosition = useTwinStore((state) => state.setSectionViewPosition);
  const setFlip = useTwinStore((state) => state.setSectionViewFlip);
  const fallbackBounds = [
    BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[0], BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[0],
    BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[1], BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[1],
    BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min[2], BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max[2],
  ];
  const bounds = viewScale === "module" ? MODULE_LAYOUT_V1.boundsMm : geometryBounds?.length === 6 ? geometryBounds : fallbackBounds;
  const axisIndex = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  const minimum = bounds[axisIndex * 2];
  const maximum = bounds[axisIndex * 2 + 1];
  const safeMinimum = Number.isFinite(minimum) ? minimum : fallbackBounds[axisIndex];
  const safeMaximum = Number.isFinite(maximum) ? maximum : fallbackBounds[axisIndex * 2 + 1];
  const clampedPosition = Math.min(safeMaximum, Math.max(safeMinimum, positionMm));
  const step = Math.max((safeMaximum - safeMinimum) / 200, 0.1);
  const handleAxisChange = (value: string) => {
    if (!value) return;
    const nextAxis = value as "X" | "Y" | "Z";
    const nextIndex = nextAxis === "X" ? 0 : nextAxis === "Y" ? 1 : 2;
    const nextMinimum = bounds[nextIndex * 2];
    const nextMaximum = bounds[nextIndex * 2 + 1];
    setAxis(nextAxis);
    setPosition((nextMinimum + nextMaximum) / 2);
  };

  return (
    <div className="panel-section display-controls section-view-controls" data-testid="section-view-controls">
      <div className="section-label">GEOMETRY SECTION VIEW</div>
      <label className="switch-row">
        <span><strong>Section View</strong><small>{enabled ? "CAD clipping active" : "CAD clipping off"}</small></span>
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} aria-label="Section View On / Off" data-testid="section-view-toggle" />
        <i />
      </label>
      <div className="section-view-axis">
        <div className="section-label">SECTION AXIS</div>
        <ToggleGroup type="single" value={axis} onValueChange={handleAxisChange} className="segmented" data-testid="section-axis">
          {(["X", "Y", "Z"] as const).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`section-axis-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <ParameterControl
        label="Section position"
        value={clampedPosition}
        min={safeMinimum}
        max={safeMaximum}
        step={step}
        onChange={setPosition}
        testId="section-position"
        unit="mm"
      />
      <label className="switch-row section-flip-row">
        <span><strong>Flip direction</strong><small>{flip ? "Keep the negative side" : "Keep the positive side"}</small></span>
        <input type="checkbox" checked={flip} onChange={(event) => setFlip(event.target.checked)} aria-label="Flip section direction" data-testid="section-flip" />
        <i />
      </label>
      <p className="control-help">Clips CAD geometry only. Open clipped surfaces do not receive generated cap faces.</p>
    </div>
  );
}

function ScientificDisplayControls() {
  const opacity = useTwinStore((state) => state.scientificSliceOpacity);
  const setOpacity = useTwinStore((state) => state.setAllScientificSliceOpacity);
  return (
    <div className="panel-section display-controls" data-testid="scientific-display-controls">
      <div className="section-label">SCIENTIFIC DISPLAY</div>
      <label className="opacity-control">
        <span><strong>All-slice opacity</strong><output data-testid="scientific-slice-opacity">{Math.round(opacity * 100)}%</output></span>
        <input
          type="range"
          min="25"
          max="100"
          step="5"
          value={Math.round(opacity * 100)}
          aria-label="Scientific slice opacity"
          data-testid="scientific-slice-opacity-slider"
          onChange={(event) => setOpacity(Number(event.target.value) / 100)}
        />
      </label>
      <p className="control-help">Visualization only; raw MCNP values and probe data are unchanged.</p>
    </div>
  );
}

function ModuleScientificNotice() {
  return (
    <div className="panel-section module-scientific-notice" data-testid="module-scientific-notice">
      <div className="section-label">SCIENTIFIC DISPLAY</div>
      <Badge tone="cyan">Tiled preview</Badge>
      <p>Tiled reference field</p>
      <small>Single-cell reference MCNP field · Reference case: 107-E · repeated across module cells for visualization · not a module-scale MCNP simulation.</small>
    </div>
  );
}

function ScientificSliceManager({
  slices,
  activeSliceId,
  onAdd,
  onRemove,
  onSelect,
  onAxis,
  onPosition,
  onVisible,
  onOpacity,
}: {
  slices: ScientificSlice[];
  activeSliceId: string | null;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onAxis: (id: string, axis: SliceAxis) => void;
  onPosition: (id: string, value: number) => void;
  onVisible: (id: string, visible: boolean) => void;
  onOpacity: (id: string, opacity: number) => void;
}) {
  const scientificField = useTwinStore((state) => state.scientificField);
  const viewScale = useTwinStore((state) => state.viewScale);
  return (
    <div className="panel-section scientific-slice-manager" data-testid="scientific-slice-manager">
      <div className="slice-manager-heading">
        <div>
          <div className="section-label">SLICE MANAGER</div>
          <p>{slices.length} of {MAX_SCIENTIFIC_SLICES} configured · raw cell layers</p>
        </div>
        <Button variant="outline" size="sm" onClick={onAdd} disabled={!scientificField || slices.length >= MAX_SCIENTIFIC_SLICES} data-testid="add-scientific-slice">
          <Plus size={13} /> Add Slice
        </Button>
      </div>
      {slices.map((slice, index) => {
        const bounds = scientificField ? (viewScale === "module" ? moduleAxisBounds(MODULE_LAYOUT_V1, slice.axis) : axisBoundaries(scientificField.manifest, slice.axis)) : [0, 921];
        const minimum = bounds[0];
        const maximum = bounds.at(-1)!;
        const intersectedCellCount = viewScale === "module" ? moduleCellsIntersectingSlice(MODULE_LAYOUT_V1, slice.axis, slice.requestedPositionMm).length : null;
        return (
          <div className={`scientific-slice-row ${activeSliceId === slice.id ? "is-active" : ""}`} key={slice.id} data-testid={`scientific-slice-row-${slice.id}`}>
            <div className="scientific-slice-row-heading">
              <button type="button" className="scientific-slice-select" onClick={() => onSelect(slice.id)} aria-pressed={activeSliceId === slice.id} data-testid={`select-scientific-slice-${slice.id}`}>
                <strong>Slice {index + 1}</strong>
                <small>{viewScale === "module" ? `${slice.axis} · ${slice.requestedPositionMm.toFixed(1)} mm · ${intersectedCellCount} cells` : `${slice.axis} · ${slice.centerMm.toFixed(1)} mm`}</small>
                <span>{slice.axis} · {slice.lowerBoundMm.toFixed(1)}–{slice.upperBoundMm.toFixed(1)} mm</span>
              </button>
              <label className="slice-visibility-control">
                <input type="checkbox" checked={slice.visible} onChange={(event) => onVisible(slice.id, event.target.checked)} aria-label={`${slice.visible ? "Hide" : "Show"} ${slice.id}`} data-testid={`scientific-slice-visible-${slice.id}`} />
                <span>Visible</span>
              </label>
              <Button variant="ghost" size="icon" onClick={() => onRemove(slice.id)} disabled={slices.length <= 1} aria-label={`Remove ${slice.id}`} data-testid={`remove-scientific-slice-${slice.id}`}>
                <Trash2 size={13} />
              </Button>
            </div>
            <div className="scientific-slice-summary">center {slice.centerMm.toFixed(1)} mm · layer {slice.layerIndex}</div>
            <ToggleGroup type="single" value={slice.axis} onValueChange={(value) => value && onAxis(slice.id, value as SliceAxis)} className="segmented scientific-slice-axis" aria-label={`${slice.id} axis`}>
              {(["X", "Y", "Z"] as SliceAxis[]).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`scientific-slice-${slice.id}-axis-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
            </ToggleGroup>
            <ParameterControl
              label={`${slice.id} position`}
              value={slice.requestedPositionMm}
              min={minimum}
              max={maximum}
              step={1}
              onChange={(value) => onPosition(slice.id, value)}
              testId={`scientific-slice-position-${slice.id}`}
              unit="mm"
            />
            <label className="opacity-control slice-opacity-control">
              <span><strong>Opacity</strong><output>{Math.round(slice.opacity * 100)}%</output></span>
              <input type="range" min="25" max="100" step="5" value={Math.round(slice.opacity * 100)} aria-label={`${slice.id} opacity`} data-testid={`scientific-slice-opacity-${slice.id}`} onChange={(event) => onOpacity(slice.id, Number(event.target.value) / 100)} />
            </label>
          </div>
        );
      })}
      {slices.length >= MAX_SCIENTIFIC_SLICES && <p className="slice-manager-limit" data-testid="scientific-slice-limit">Maximum of {MAX_SCIENTIFIC_SLICES} scientific slices reached.</p>}
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
        <p>Scalar KPIs come from the Python twin API. Parametric CSG geometry updates only after Apply Design; the reference MCNP field is loaded independently and never follows arbitrary PZ/CZ selections.</p>
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
  const prediction = useTwinStore((state) => state.prediction);
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
  const pzLevels = pzDomain?.levels ?? [];
  const czLevels = czDomain?.levels ?? [];
  const markerPosition = (pzValue: number, czValue: number) => {
    const pzMin = pzDomain?.minimum ?? pz.min;
    const pzMax = pzDomain?.maximum ?? pz.max;
    const czMin = czDomain?.minimum ?? cz.min;
    const czMax = czDomain?.maximum ?? cz.max;
    return {
      left: `${((pzValue - pzMin) / Math.max(pzMax - pzMin, 1e-9)) * 100}%`,
      bottom: `${((czValue - czMin) / Math.max(czMax - czMin, 1e-9)) * 100}%`,
    };
  };
  const nearest = prediction?.metadata.nearest_design;
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
        <div className="doe-plot" aria-label="Fixed DOE simulations with selected design marker" data-testid="design-space-plot">
          {pzLevels.flatMap((pzLevel) => czLevels.map((czLevel) => (
            <i key={`${pzLevel}-${czLevel}`} className="doe-point" style={markerPosition(pzLevel, czLevel)} title={`DOE simulation · PZ ${pzLevel.toFixed(2)} · CZ ${czLevel.toFixed(2)} cm`} />
          )))}
          <i className="design-marker selected" style={markerPosition(pz206, cz301)} data-testid="selected-design-marker" title="Selected design" />
          {appliedPz206 !== null && appliedCz301 !== null && <i className="design-marker applied" style={markerPosition(appliedPz206, appliedCz301)} data-testid="applied-design-marker" title="Applied geometry design" />}
          {prediction?.metadata.status === "exact" && <i className="design-marker exact" style={markerPosition(prediction.design.pz_206, prediction.design.cz_301_radius)} data-testid="exact-design-marker" title="Exact simulation case" />}
          {nearest && <i className="design-marker nearest" style={markerPosition(nearest.pz_206, nearest.cz_301_radius)} data-testid="nearest-design-marker" title={`Nearest simulation ${prediction?.metadata.nearest_case ?? ""}`} />}
        </div>
        <div className="range-labels"><span>PZ GROUP →</span><span>↑ CZ GROUP</span></div>
        <div className="design-space-legend"><span><i className="legend-dot selected" /> Selected</span><span><i className="legend-dot applied" /> Applied geometry</span><span><i className="legend-dot nearest" /> Nearest simulation</span></div>
      </div>
      <div className="info-note">
        <FlaskConical size={13} />
        <p>DOE simulations remain fixed. Apply Design requests scalar KPIs and Python parametric CSG geometry; the loaded reference MCNP field remains independent.</p>
      </div>
    </>
  );
}

function NeutronicsControls() {
  const fieldId = useTwinStore((state) => state.activeFieldId);
  const mode = useTwinStore((state) => state.visualizationMode);
  const slices = useTwinStore((state) => state.scientificSlices);
  const activeSliceId = useTwinStore((state) => state.activeScientificSliceId);
  const activeSlice = slices.find((slice) => slice.id === activeSliceId) ?? slices[0] ?? null;
  const axis = activeSlice?.axis ?? "Z";
  const log = useTwinStore((state) => state.useLogScale);
  const setField = useTwinStore((state) => state.setActiveField);
  const setMode = useTwinStore((state) => state.setVisualizationMode);
  const addSlice = useTwinStore((state) => state.addScientificSlice);
  const removeSlice = useTwinStore((state) => state.removeScientificSlice);
  const selectSlice = useTwinStore((state) => state.selectScientificSlice);
  const setSliceAxis = useTwinStore((state) => state.setScientificSliceAxis);
  const setSlicePosition = useTwinStore((state) => state.setScientificSlicePosition);
  const setSliceVisible = useTwinStore((state) => state.setScientificSliceVisible);
  const setSliceOpacity = useTwinStore((state) => state.setScientificSliceOpacity);
  const setLog = useTwinStore((state) => state.setUseLogScale);
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
  const viewScale = useTwinStore((state) => state.viewScale);
  const selectedCellId = useTwinStore((state) => state.selectedCellId);
  const selectedCell = MODULE_LAYOUT_V1.cells.find((cell) => cell.cellId === selectedCellId) ?? null;
  const currentBoundaries = scientificField ? (viewScale === "module" ? moduleAxisBounds(MODULE_LAYOUT_V1, axis) : axisBoundaries(scientificField.manifest, axis)) : [0, 921];
  const layerMetadata = activeSlice;
  const sliceRange = scientificField && layerMetadata && viewScale === "single-cell" ? scientificField.manifest.fields[fieldId].slice_ranges[axis][layerMetadata.layerIndex] : null;
  const statusLabel = scientificStatus === "ready"
    ? "Reference MCNP field"
    : scientificStatus === "error"
      ? "Scientific asset unavailable"
      : scientificStatus.replaceAll("-", " ");
  const displayScale = log ? "Log" : "Linear";
  const logDisabled = !scientificField || !scientificField.manifest.fields[fieldId].log_scale_supported;
  const probeLayerCenter = () => {
    if (!scientificField || !activeSlice) return;
    const x = axisBoundaries(scientificField.manifest, "X");
    const y = axisBoundaries(scientificField.manifest, "Y");
    const z = axisBoundaries(scientificField.manifest, "Z");
    const point: [number, number, number] = [
      (x[0] + x[x.length - 1]) / 2,
      (y[0] + y[y.length - 1]) / 2,
      (z[0] + z[z.length - 1]) / 2,
    ];
    const probeCell = viewScale === "module"
      ? selectedCell ?? moduleCellsIntersectingSlice(MODULE_LAYOUT_V1, activeSlice.axis, activeSlice.requestedPositionMm)[0] ?? null
      : null;
    const translation = probeCell ? moduleCellTranslationMm(probeCell) : [0, 0, 0] as [number, number, number];
    const axisIndex = activeSlice.axis === "X" ? 0 : activeSlice.axis === "Y" ? 1 : 2;
    point[axisIndex] = activeSlice.requestedPositionMm - translation[axisIndex];
    void probeVoxel(activeSlice.id, point, probeCell?.cellId, point[axisIndex]);
  };

  return (
    <>
      {viewScale === "module" && selectedCell && (
        <div className="panel-section module-reference-provenance" data-testid="module-reference-provenance">
          <div className="section-label">SELECTED-CELL REFERENCE FIELD</div>
          <Badge tone="cyan">Reference only</Badge>
          <p><strong>Single-cell reference MCNP field</strong></p>
          <small>Reference case: 107-E · repeated across module cells for visualization · not a module-scale simulation. Reference MCNP field remains fixed to case 107-E and may not correspond to the currently applied geometry.</small>
        </div>
      )}
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
        <ToggleGroup type="single" value={axis} onValueChange={(value) => value && activeSlice && setSliceAxis(activeSlice.id, value as SliceAxis)} className="segmented" data-testid="slice-axis">
          {(["X", "Y", "Z"] as SliceAxis[]).map((item) => <ToggleGroupItem key={item} value={item} data-testid={`axis-${item.toLowerCase()}`}>{item}</ToggleGroupItem>)}
        </ToggleGroup>
        <ParameterControl
          label={`${axis} position`}
          value={activeSlice?.requestedPositionMm ?? currentBoundaries[0]}
          min={currentBoundaries[0]}
          max={currentBoundaries.at(-1)!}
          step={1}
          onChange={(value) => activeSlice && setSlicePosition(activeSlice.id, value)}
          testId="slice-position"
          unit="mm"
        />
      </div>
      <ScientificSliceManager
        slices={slices}
        activeSliceId={activeSliceId}
        onAdd={addSlice}
        onRemove={removeSlice}
        onSelect={selectSlice}
        onAxis={setSliceAxis}
        onPosition={setSlicePosition}
        onVisible={setSliceVisible}
        onOpacity={setSliceOpacity}
      />
      <label className="switch-row">
        <span><strong>Logarithmic scale</strong><small>{logDisabled ? "Unavailable for non-positive-only data" : "Visualization-only · zero / nonpositive cells remain hidden"}</small></span>
        <input type="checkbox" checked={log && !logDisabled} disabled={logDisabled} onChange={(event) => setLog(event.target.checked)} data-testid="log-scale" />
        <i />
      </label>
      <MetricRow label="Display state" value={`${mode} · ${slices.filter((slice) => slice.visible).length}/${slices.length} slices · ${displayScale}`} />
      <MetricRow label={viewScale === "module" ? `Global ${axis} position` : `Containing ${axis} layer`} value={layerMetadata ? (viewScale === "module" ? layerMetadata.requestedPositionMm.toFixed(1) : `${layerMetadata.lowerBoundMm.toFixed(1)} – ${layerMetadata.upperBoundMm.toFixed(1)}`) : "Unavailable"} unit={layerMetadata ? "mm" : undefined} />
      <MetricRow label={viewScale === "module" ? "Reference local layer center" : "Rendered at center"} value={layerMetadata ? layerMetadata.centerMm.toFixed(1) : "Unavailable"} unit={layerMetadata ? "mm" : undefined} />
      <MetricRow label="Global range" value={scientificField ? `${scientificField.manifest.fields[fieldId].web_range[0].toExponential(3)} – ${scientificField.manifest.fields[fieldId].web_range[1].toExponential(3)}` : "Unavailable"} unit={scientificField ? scientificField.manifest.fields[fieldId].display_units : undefined} />
      <MetricRow label="Slice range" value={sliceRange ? `${sliceRange[0].toExponential(3)} – ${sliceRange[1].toExponential(3)}` : "Unavailable"} unit={sliceRange ? scientificField?.manifest.fields[fieldId].display_units : undefined} />
      <MetricRow label="Scientific field" value={statusLabel} />
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
            <MetricRow label="Slice" value={`${probe.sliceLabel} · ${probe.sliceAxis}`} />
            {probe.moduleCell && <MetricRow label="Module cell" value={`${probe.moduleCell.cellId} · row ${probe.moduleCell.row} · column ${probe.moduleCell.column} · q ${probe.moduleCell.q} · r ${probe.moduleCell.r}`} />}
            {probe.moduleCell && <MetricRow label="Reference case" value="107-E" />}
            <MetricRow label={probe.moduleCell ? "Local X interval" : "X interval"} value={`${probe.boundsMm.x[0].toFixed(1)} – ${probe.boundsMm.x[1].toFixed(1)}`} unit="mm" />
            <MetricRow label={probe.moduleCell ? "Local Y interval" : "Y interval"} value={`${probe.boundsMm.y[0].toFixed(1)} – ${probe.boundsMm.y[1].toFixed(1)}`} unit="mm" />
            <MetricRow label={probe.moduleCell ? "Local Z interval" : "Z interval"} value={`${probe.boundsMm.z[0].toFixed(1)} – ${probe.boundsMm.z[1].toFixed(1)}`} unit="mm" />
            <MetricRow label={probe.moduleCell ? "Local center" : "Cell center"} value={probe.centerMm.map((value) => value.toFixed(1)).join(", ")} unit="mm" />
            {probe.moduleCenterMm && <MetricRow label="Module center" value={probe.moduleCenterMm.map((value) => value.toFixed(1)).join(", ")} unit="mm" />}
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
            <Button variant="outline" size="sm" onClick={probeLayerCenter} disabled={!scientificField || !activeSlice || mode !== "Slice"} data-testid="probe-layer-center">Probe Layer Center</Button>
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
  const viewScale = useTwinStore((state) => state.viewScale);
  const [eyebrow, title] = sectionMeta[section];
  return (
    <aside className="control-panel" data-testid="control-panel">
      <PanelHeading eyebrow={eyebrow} title={title} />
      <div className="control-scroll">
        <ScaleModeControls />
        {section === "overview" && <OverviewControls />}
        {section === "design" && <DesignControls />}
        {section === "neutronics" && viewScale === "module" && <ModuleScientificNotice />}
        {section === "neutronics" && <NeutronicsControls />}
        {section === "thermal-hydraulics" && <ThermalControls />}
        {section === "performance" && <PerformanceControls />}
        {section !== "thermal-hydraulics" && <ComponentDisplayControls />}
        {section !== "thermal-hydraulics" && <GeometrySectionControls />}
        {section === "neutronics" && <ScientificDisplayControls />}
      </div>
    </aside>
  );
}
