"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, Eye, EyeOff, Focus, Maximize2, Minimize2, RotateCcw, ScanLine } from "lucide-react";
import type { GeometryReadyMetrics } from "@/components/blanket-three-scene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";
import { SCIENTIFIC_COLOR_GRADIENT, SCIENTIFIC_ZERO_COLOR, scalarDomain, selectedLayer } from "@/lib/scientific-field";

const BlanketThreeScene = dynamic(
  () => import("@/components/blanket-three-scene").then((module) => module.BlanketThreeScene),
  { ssr: false },
);

type GeometryState = "loading" | "ready" | "error";

function UnavailableTool({ label, reason, children }: { label: string; reason: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="disabled-tool">
          <Button variant="ghost" size="icon" aria-label={`${label} — unavailable`} disabled>{children}</Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label} · {reason}</TooltipContent>
    </Tooltip>
  );
}

function ComponentControls() {
  const selectedId = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const toggleComponent = useTwinStore((state) => state.toggleComponent);

  return (
    <div className="component-legend" aria-label="Web CAD component selection and visibility">
      {mockTwinState.components.map((component) => (
        <div key={component.id} className={cn("component-control", selectedId === component.id && "is-selected")}>
          <button type="button" onClick={() => selectComponent(component.id)} aria-pressed={selectedId === component.id} data-testid={`component-${component.id}`}>
            <i style={{ backgroundColor: component.color }} />{component.label}
          </button>
          <button
            type="button"
            className="visibility-button"
            onClick={() => toggleComponent(component.id)}
            aria-label={`${visibility[component.id] ? "Hide" : "Show"} ${component.label}`}
            aria-pressed={visibility[component.id]}
            data-testid={`visibility-${component.id}`}
            title={`${visibility[component.id] ? "Hide" : "Show"} ${component.label}`}
          >
            {visibility[component.id] ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
        </div>
      ))}
    </div>
  );
}

export function BlanketViewport() {
  const viewportRef = useRef<HTMLElement>(null);
  const [geometryState, setGeometryState] = useState<GeometryState>("loading");
  const [geometryError, setGeometryError] = useState("");
  const [metrics, setMetrics] = useState<GeometryReadyMetrics | null>(null);
  const [cameraFeedback, setCameraFeedback] = useState("Orbit · zoom · pan enabled");
  const [fullscreen, setFullscreen] = useState(false);
  const section = useTwinStore((state) => state.section);
  const fieldId = useTwinStore((state) => state.activeFieldId);
  const mode = useTwinStore((state) => state.visualizationMode);
  const axis = useTwinStore((state) => state.sliceAxis);
  const log = useTwinStore((state) => state.useLogScale);
  const slicePositions = useTwinStore((state) => state.slicePositions);
  const pz = useTwinStore((state) => state.appliedPz206);
  const cz = useTwinStore((state) => state.appliedCz301);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const selectedComponentId = useTwinStore((state) => state.selectedComponentId);
  const cameraCommand = useTwinStore((state) => state.cameraCommand);
  const requestCamera = useTwinStore((state) => state.requestCamera);
  const scientificStatus = useTwinStore((state) => state.scientificFieldStatus);
  const scientificField = useTwinStore((state) => state.scientificField);
  const scientificError = useTwinStore((state) => state.scientificFieldError);
  const scientificMetrics = useTwinStore((state) => state.scientificLoadMetrics);
  const field = scientificField?.manifest.fields[fieldId] ?? mockTwinState.fields.find((item) => item.id === fieldId)!;
  const fieldDisplayName = "display_name" in field ? field.display_name : field.displayName;
  const neutronics = section === "neutronics";
  const scientificLayer = scientificField ? selectedLayer(scientificField.manifest, axis, slicePositions[axis]) : null;
  const scientificLayerIndex = scientificLayer?.index ?? null;
  const activeRecord = scientificField?.manifest.fields[fieldId] ?? null;
  const scaleLabel = log ? "Log" : "Linear";
  const scalarTicks = activeRecord
    ? Array.from({ length: 5 }, (_, index) => {
        const fraction = 1 - index / 4;
        if (log && activeRecord.positive_minimum !== null) {
          const minimum = Math.log10(activeRecord.positive_minimum);
          const maximum = Math.log10(activeRecord.web_range[1]);
          return 10 ** (minimum + (maximum - minimum) * fraction);
        }
        return activeRecord.web_range[0] + (activeRecord.web_range[1] - activeRecord.web_range[0]) * fraction;
      })
    : null;

  const handleReady = useCallback((readyMetrics: GeometryReadyMetrics) => {
    setMetrics(readyMetrics);
    setGeometryState("ready");
  }, []);
  const handleError = useCallback((message: string) => {
    setGeometryError(message);
    setGeometryState("error");
  }, []);

  useEffect(() => {
    const handleFullscreen = () => setFullscreen(document.fullscreenElement === viewportRef.current);
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  const displaySummary = neutronics
    ? mode === "Off"
      ? `${fieldDisplayName} · display off`
       : scientificLayer
         ? `${mode} · ${axis} selection ${slicePositions[axis].toFixed(1)} mm · layer ${scientificLayer.bounds_mm[0].toFixed(1)}–${scientificLayer.bounds_mm[1].toFixed(1)} mm · ${scaleLabel}`
         : `${mode} · ${axis} · ${slicePositions[axis].toFixed(1)} mm · ${scaleLabel}`
    : `Scalar design PZ ${pz.toFixed(2)} cm · CZ ${cz.toFixed(2)} cm · CAD fixed`;

  const runCameraCommand = (action: "reset" | "fit") => {
    requestCamera(action);
    setCameraFeedback(action === "reset" ? "Camera reset to engineering view" : "Assembly fitted to viewport");
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewportRef.current?.requestFullscreen();
      setCameraFeedback(document.fullscreenElement ? "Viewport entered fullscreen" : "Viewport exited fullscreen");
    } catch {
      setCameraFeedback("Fullscreen is unavailable in this browser context");
    }
  };

  return (
    <section ref={viewportRef} className="viewport" aria-label="Interactive Web CAD geometry" data-testid="geometry-viewport">
      <div className="viewport-header">
        <div>
          <span className="viewport-kicker"><Box size={12} /> WEB CAD GEOMETRY</span>
          <h2>Blanket Unit Cell <small>/ GLB derived from STEP</small></h2>
        </div>
        <div className="viewport-state" data-testid="viewport-state">
          <span><i className={geometryState === "error" ? "is-error" : ""} /> {neutronics ? fieldDisplayName : "Web CAD Geometry"}</span>
          <Badge tone={geometryState === "ready" ? "green" : geometryState === "error" ? "amber" : "muted"}>
            {geometryState === "ready" ? "Geometry ready" : geometryState === "error" ? "Asset unavailable" : "Loading geometry"}
          </Badge>
        </div>
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="viewport-toolbar" aria-label="Web CAD viewport tools">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Reset camera" disabled={geometryState !== "ready"} onClick={() => runCameraCommand("reset")} data-testid="reset-camera"><RotateCcw size={14} /></Button>
          </TooltipTrigger><TooltipContent>Reset camera · Restore the engineering view</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Fit assembly" disabled={geometryState !== "ready"} onClick={() => runCameraCommand("fit")} data-testid="fit-assembly"><Focus size={14} /></Button>
          </TooltipTrigger><TooltipContent>Fit assembly · Frame all visible geometry</TooltipContent></Tooltip>
          <UnavailableTool label="Section plane" reason="Clipping is deferred for this milestone"><ScanLine size={14} /></UnavailableTool>
          <span className="toolbar-divider" />
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} disabled={geometryState !== "ready"} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
          </TooltipTrigger><TooltipContent>{fullscreen ? "Exit fullscreen" : "Open geometry viewport fullscreen"}</TooltipContent></Tooltip>
        </div>
      </TooltipProvider>

      <div className="geometry-canvas-shell">
        <BlanketThreeScene cameraCommand={cameraCommand} onReady={handleReady} onError={handleError} />
        {geometryState === "loading" && (
          <div className="geometry-load-state" role="status" data-testid="geometry-loading">
            <span className="geometry-spinner" /><strong>Loading blanket geometry</strong><small>Reading GLB presentation asset</small>
          </div>
        )}
        {geometryState === "error" && (
          <div className="geometry-load-state geometry-error" role="alert" data-testid="geometry-error">
            <Box size={24} /><strong>Blanket geometry asset unavailable</strong><small>{geometryError}</small><code>public/models/blanket_unit_cell.glb</code>
          </div>
        )}
        {neutronics && scientificStatus !== "ready" && scientificStatus !== "error" && (
          <div className="scientific-load-state" role="status" data-testid="scientific-loading">
            <span className="geometry-spinner" />
            <strong>{scientificStatus === "loading-scalars" ? "Loading scalar array" : scientificStatus === "loading-geometry" ? "Validating scientific geometry" : "Loading scientific metadata"}</strong>
            <small>Reference MCNP simulation · {fieldDisplayName}</small>
          </div>
        )}
        {neutronics && scientificStatus === "error" && (
          <div className="scientific-load-state scientific-error" role="alert" data-testid="scientific-error">
            <AlertTriangle size={20} />
            <strong>Scientific field asset unavailable</strong>
            <small>{scientificError}</small>
            <span>CAD and scalar Twin API remain independent.</span>
          </div>
        )}
        {neutronics && scientificStatus === "ready" && mode === "Slice" && scientificField && activeRecord && scalarTicks && (
          <div className="scientific-scalar-bar" data-testid="scientific-scalar-bar">
            <div className="scalar-bar-heading"><strong>{activeRecord.display_name}</strong><span>{activeRecord.display_units} · {scaleLabel}</span></div>
            <div className="scalar-bar-body">
              <div className="scalar-gradient" style={{ background: SCIENTIFIC_COLOR_GRADIENT }} />
              <div className="scalar-ticks">
                {scalarTicks.map((tick, index) => <span key={`${tick}-${index}`}>{tick.toExponential(2)}</span>)}
              </div>
            </div>
            <div className="scalar-zero-key"><i style={{ background: SCIENTIFIC_ZERO_COLOR }} /><span>Zero / nonpositive</span></div>
            <small>{scientificLayer ? `${axis} layer ${scientificLayer.bounds_mm[0].toFixed(1)}–${scientificLayer.bounds_mm[1].toFixed(1)} mm · center ${scientificLayer.center_mm.toFixed(1)} mm` : `${scaleLabel} · raw cell values`}</small>
            {log && <small>Positive range starts at {activeRecord.positive_minimum?.toExponential(2)}</small>}
          </div>
        )}
      </div>

      <div className="preview-status" data-testid="preview-status">
        <span>{displaySummary}</span>
        <small>{neutronics ? "Displayed 3D field: reference MCNP simulation · independent of selected design" : cameraFeedback}</small>
      </div>

      <ComponentControls />
      {metrics && (
        <div className="geometry-diagnostics" data-testid="geometry-ready" data-load-ms={metrics.totalMs.toFixed(1)} data-resource-ms={metrics.resourceMs?.toFixed(1) ?? "unknown"}>
          {mockTwinState.components.map((component) => (
            <span key={component.id} data-testid={`geometry-group-${component.id}`} data-visible={visibility[component.id]} data-selected={selectedComponentId === component.id} data-mesh-count={metrics.groups[component.id]} />
          ))}
        </div>
      )}
      {scientificField && scientificStatus === "ready" && (
        <div
          className="geometry-diagnostics"
          data-testid="scientific-field-ready"
          data-cell-count={scientificField.manifest.mesh.cell_count}
          data-active-field={fieldId}
          data-slice-axis={axis}
          data-scale-mode={log ? "log" : "linear"}
          data-position-mm={slicePositions[axis].toFixed(1)}
          data-z-mm={slicePositions.Z.toFixed(1)}
          data-layer={scientificLayerIndex}
          data-z-layer={axis === "Z" ? scientificLayerIndex : "inactive"}
          data-layer-bounds={scientificLayer ? scientificLayer.bounds_mm.join(",") : "unknown"}
          data-z-layer-bounds={axis === "Z" && scientificLayer ? scientificLayer.bounds_mm.join(",") : "inactive"}
          data-rendered-mm={scientificLayer?.center_mm.toFixed(1) ?? "unknown"}
          data-rendered-z-mm={scientificLayer?.center_mm.toFixed(1) ?? "unknown"}
          data-visible={neutronics && mode === "Slice"}
          data-load-ms={scientificMetrics?.totalMs?.toFixed(1) ?? "unknown"}
          data-metadata-ms={scientificMetrics?.metadataMs?.toFixed(1) ?? "unknown"}
          data-geometry-validation-ms={scientificMetrics?.geometryValidationMs?.toFixed(1) ?? "unknown"}
          data-scalar-download-ms={scientificMetrics?.scalarDownloadMs?.toFixed(1) ?? "unknown"}
          data-scalar-parse-ms={scientificMetrics?.scalarParseMs?.toFixed(1) ?? "unknown"}
          data-render-ms={scientificMetrics?.firstRenderMs?.toFixed(1) ?? "unknown"}
          data-slice-update-ms={scientificMetrics?.sliceUpdateMs?.toFixed(1) ?? "unknown"}
          data-field-switch-ms={scientificMetrics?.fieldSwitchMs?.toFixed(1) ?? "unknown"}
          data-probe-ms={scientificMetrics?.probeMs?.toFixed(1) ?? "unknown"}
          data-scalar-domain={activeRecord ? scalarDomain(activeRecord, log ? "log" : "linear").join(",") : "unknown"}
        />
      )}
      <div className="viewport-footer">
        <span>PROJECT AXES: +Z = TOKAMAK +R · Z=0 PLASMA-FACING ARMOR</span>
        <span>SOURCE / DISPLAY: MM</span>
        <span>{metrics ? `${metrics.triangles.toLocaleString()} TRIANGLES · ${metrics.meshes} MESHES` : "GLB DERIVED FROM STEP"}</span>
      </div>
    </section>
  );
}
