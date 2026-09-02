"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Box, Focus, Maximize2, Minimize2, RotateCcw, RotateCw } from "lucide-react";
import type { CameraState, GeometryReadyMetrics } from "@/components/blanket-three-scene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BLANKET_GEOMETRY_ADAPTER } from "@/lib/blanket-geometry";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";
import { SCIENTIFIC_COLOR_GRADIENT, SCIENTIFIC_ZERO_COLOR, scalarDomain } from "@/lib/scientific-field";

const BlanketThreeScene = dynamic(
  () => import("@/components/blanket-three-scene").then((module) => module.BlanketThreeScene),
  { ssr: false },
);

type GeometryState = "loading" | "ready" | "error";

export function BlanketViewport() {
  const viewportRef = useRef<HTMLElement>(null);
  const [geometryState, setGeometryState] = useState<GeometryState>("loading");
  const [geometryError, setGeometryError] = useState("");
  const [metrics, setMetrics] = useState<GeometryReadyMetrics | null>(null);
  const [cameraState, setCameraState] = useState<CameraState | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const section = useTwinStore((state) => state.section);
  const fieldId = useTwinStore((state) => state.activeFieldId);
  const mode = useTwinStore((state) => state.visualizationMode);
  const scientificSlices = useTwinStore((state) => state.scientificSlices);
  const activeScientificSliceId = useTwinStore((state) => state.activeScientificSliceId);
  const activeScientificSlice = scientificSlices.find((slice) => slice.id === activeScientificSliceId) ?? scientificSlices[0] ?? null;
  const axis = activeScientificSlice?.axis ?? "Z";
  const log = useTwinStore((state) => state.useLogScale);
  const geometryStatus = useTwinStore((state) => state.geometryStatus);
  const geometry = useTwinStore((state) => state.geometry);
  const sectionViewEnabled = useTwinStore((state) => state.sectionViewEnabled);
  const sectionViewAxis = useTwinStore((state) => state.sectionViewAxis);
  const sectionViewPositionMm = useTwinStore((state) => state.sectionViewPositionMm);
  const sectionViewFlip = useTwinStore((state) => state.sectionViewFlip);
  const hasParametricGeometry = geometry !== null;
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
  const scientificLayer = activeScientificSlice;
  const scientificLayerIndex = scientificLayer?.layerIndex ?? null;
  const activeRecord = scientificField?.manifest.fields[fieldId] ?? null;
  const sectionBounds = geometry?.bounds_mm?.length === 6
    ? geometry.bounds_mm
    : [...BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.min, ...BLANKET_GEOMETRY_ADAPTER.sourceBoundsMm.max];
  const sectionAxisIndex = sectionViewAxis === "X" ? 0 : sectionViewAxis === "Y" ? 1 : 2;
  const sectionBoundsIndex = geometry?.bounds_mm?.length === 6 ? sectionAxisIndex * 2 : sectionAxisIndex;
  const sectionMinimum = sectionBounds[sectionBoundsIndex];
  const sectionMaximum = geometry?.bounds_mm?.length === 6 ? sectionBounds[sectionBoundsIndex + 1] : sectionBounds[sectionAxisIndex + 3];
  const sectionPosition = Math.min(sectionMaximum, Math.max(sectionMinimum, sectionViewPositionMm));
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
  const handleCameraState = useCallback((state: CameraState) => setCameraState(state), []);

  useEffect(() => {
    const handleFullscreen = () => setFullscreen(document.fullscreenElement === viewportRef.current);
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  const runCameraCommand = (action: "reset" | "fit" | "roll-cw" | "roll-ccw") => {
    requestCamera(action);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewportRef.current?.requestFullscreen();
    } catch {
      // Fullscreen is optional in embedded/browser-test contexts.
    }
  };

  return (
    <section ref={viewportRef} className="viewport" aria-label="Interactive Web CAD geometry" data-testid="geometry-viewport">
      <div className="viewport-header">
        <div>
          <span className="viewport-kicker"><Box size={12} /> WEB CAD GEOMETRY</span>
          <h2>Blanket Unit Cell <small>/ {hasParametricGeometry ? "Parametric CSG · Python provider" : "Fixed GLB derived from STEP"}</small></h2>
        </div>
        <div className="viewport-state" data-testid="viewport-state">
          <span><i className={geometryState === "error" ? "is-error" : ""} /> {neutronics ? fieldDisplayName : "Web CAD Geometry"}</span>
          <Badge tone={geometryState === "ready" ? "green" : geometryState === "error" ? "amber" : "muted"}>
            {geometryState === "error" ? (hasParametricGeometry ? "Parametric geometry" : "GLB fallback") : geometryStatus === "loading" ? "Generating geometry" : geometryStatus === "success" ? "Parametric geometry ready" : geometryState === "ready" ? "Geometry ready" : "Loading geometry"}
          </Badge>
        </div>
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="viewport-toolbar" aria-label="Web CAD viewport tools">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Reset camera" disabled={geometryState !== "ready" && !hasParametricGeometry} onClick={() => runCameraCommand("reset")} data-testid="reset-camera"><RotateCcw size={14} /></Button>
          </TooltipTrigger><TooltipContent>Reset camera · Restore the engineering view</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Fit assembly" disabled={geometryState !== "ready" && !hasParametricGeometry} onClick={() => runCameraCommand("fit")} data-testid="fit-assembly"><Focus size={14} /></Button>
          </TooltipTrigger><TooltipContent>Fit assembly · Frame all visible geometry</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Roll current view clockwise 90 degrees" disabled={geometryState !== "ready" && !hasParametricGeometry} onClick={() => runCameraCommand("roll-cw")} data-testid="roll-cw"><RotateCw size={14} /></Button>
          </TooltipTrigger><TooltipContent>Roll current view clockwise 90°</TooltipContent></Tooltip>
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Roll current view counterclockwise 90 degrees" disabled={geometryState !== "ready" && !hasParametricGeometry} onClick={() => runCameraCommand("roll-ccw")} data-testid="roll-ccw"><RotateCcw size={14} /></Button>
          </TooltipTrigger><TooltipContent>Roll current view counterclockwise 90°</TooltipContent></Tooltip>
          <span className="toolbar-divider" />
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} disabled={geometryState !== "ready" && !hasParametricGeometry} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </Button>
          </TooltipTrigger><TooltipContent>{fullscreen ? "Exit fullscreen" : "Open geometry viewport fullscreen"}</TooltipContent></Tooltip>
        </div>
      </TooltipProvider>

      <div className="geometry-canvas-shell">
        <BlanketThreeScene cameraCommand={cameraCommand} onReady={handleReady} onError={handleError} onCameraState={handleCameraState} />
        {geometryState === "loading" && (
          <div className="geometry-load-state" role="status" data-testid="geometry-loading">
            <span className="geometry-spinner" /><strong>Loading blanket geometry</strong><small>Reading GLB presentation asset</small>
          </div>
        )}
        {geometryState === "error" && !hasParametricGeometry && (
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
            <div className="scalar-zero-key"><i style={{ background: SCIENTIFIC_ZERO_COLOR }} /><span>Zero / nonpositive hidden</span></div>
            <small>{scientificLayer ? `${axis} layer ${scientificLayer.lowerBoundMm.toFixed(1)}–${scientificLayer.upperBoundMm.toFixed(1)} mm · center ${scientificLayer.centerMm.toFixed(1)} mm` : `${scaleLabel} · raw cell values`}</small>
            <small>{scientificSlices.filter((slice) => slice.visible).length} visible slice{scientificSlices.filter((slice) => slice.visible).length === 1 ? "" : "s"} · raw cell values</small>
            {log && <small>Positive range starts at {activeRecord.positive_minimum?.toExponential(2)}</small>}
          </div>
        )}
      </div>

      {metrics && (
        <div
          className="geometry-diagnostics"
          data-testid="geometry-ready"
          data-load-ms={metrics.totalMs.toFixed(1)}
          data-resource-ms={metrics.resourceMs?.toFixed(1) ?? "unknown"}
          data-camera-position={cameraState?.position.map((value) => value.toFixed(4)).join(",") ?? "unknown"}
          data-camera-target={cameraState?.target.map((value) => value.toFixed(4)).join(",") ?? "unknown"}
          data-camera-up={cameraState?.up.map((value) => value.toFixed(4)).join(",") ?? "unknown"}
           data-geometry-source={hasParametricGeometry ? "parametric-csg" : "glb"}
           data-primary-geometry-root-count="1"
           data-component-count={metrics.meshes}
           data-section-enabled={sectionViewEnabled}
           data-section-axis={sectionViewAxis}
           data-section-position-mm={sectionPosition.toFixed(2)}
           data-section-flip={sectionViewFlip}
           data-clipping-plane-count={sectionViewEnabled ? "1" : "0"}
           data-section-plane-visible={sectionViewEnabled}
           data-section-material-policy="component-opacity-controlled"
         >
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
          data-position-mm={scientificLayer?.requestedPositionMm.toFixed(1) ?? "unknown"}
          data-z-mm={scientificSlices.find((slice) => slice.axis === "Z")?.requestedPositionMm.toFixed(1) ?? "unknown"}
          data-layer={scientificLayerIndex}
          data-z-layer={axis === "Z" ? scientificLayerIndex : "inactive"}
          data-layer-bounds={scientificLayer ? `${scientificLayer.lowerBoundMm},${scientificLayer.upperBoundMm}` : "unknown"}
          data-z-layer-bounds={axis === "Z" && scientificLayer ? `${scientificLayer.lowerBoundMm},${scientificLayer.upperBoundMm}` : "inactive"}
          data-rendered-mm={scientificLayer?.centerMm.toFixed(1) ?? "unknown"}
          data-rendered-z-mm={scientificLayer?.centerMm.toFixed(1) ?? "unknown"}
          data-slice-count={scientificSlices.length}
          data-visible-slice-count={scientificSlices.filter((slice) => slice.visible).length}
          data-active-slice-id={activeScientificSliceId ?? "unknown"}
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
      {scientificField && scientificStatus === "ready" && scientificSlices.map((slice) => (
        <span
          key={slice.id}
          className="geometry-diagnostics"
          data-testid={`scientific-slice-${slice.id}`}
          data-slice-id={slice.id}
          data-slice-axis={slice.axis}
          data-slice-layer={slice.layerIndex}
          data-slice-center-mm={slice.centerMm.toFixed(2)}
          data-slice-bounds-mm={`${slice.lowerBoundMm},${slice.upperBoundMm}`}
          data-slice-visible={slice.visible}
          data-slice-opacity={slice.opacity}
        />
      ))}
      <div className="viewport-footer">
        <span>PROJECT AXES: +Z = TOKAMAK +R · Z=0 PLASMA-FACING ARMOR</span>
        <span>SOURCE / DISPLAY: MM</span>
        <span>{metrics ? `${metrics.triangles.toLocaleString()} TRIANGLES · ${metrics.meshes} MESHES` : "FIXED GLB FALLBACK"}</span>
      </div>
    </section>
  );
}
