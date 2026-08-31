"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Eye, EyeOff, Focus, Maximize2, Minimize2, RotateCcw, ScanLine } from "lucide-react";
import type { GeometryReadyMetrics } from "@/components/blanket-three-scene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";

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
  const field = mockTwinState.fields.find((item) => item.id === fieldId)!;
  const neutronics = section === "neutronics";

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
      ? `${field.displayName} · display off`
      : `${mode} · ${axis} · ${slicePositions[axis]} mm · ${log ? "Log" : "Linear"}`
    : `Applied PZ ${pz.toFixed(2)} cm · CZ ${cz.toFixed(2)} cm`;

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
          <span><i className={geometryState === "error" ? "is-error" : ""} /> {neutronics ? field.displayName : "Web CAD Geometry"}</span>
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
      </div>

      <div className="geometry-provenance">
        <span>GEOMETRY<strong>Web CAD Geometry</strong></span>
        <span>SOURCE<strong>GLB derived from STEP</strong></span>
        <span>SCIENTIFIC FIELD<strong className="is-unavailable">Not connected</strong></span>
      </div>

      <div className="preview-status" data-testid="preview-status">
        <span>{displaySummary}</span>
        <small>{neutronics ? "Scientific field rendering not connected" : cameraFeedback}</small>
      </div>

      <ComponentControls />
      {metrics && (
        <div className="geometry-diagnostics" data-testid="geometry-ready" data-load-ms={metrics.totalMs.toFixed(1)} data-resource-ms={metrics.resourceMs?.toFixed(1) ?? "unknown"}>
          {mockTwinState.components.map((component) => (
            <span key={component.id} data-testid={`geometry-group-${component.id}`} data-visible={visibility[component.id]} data-selected={selectedComponentId === component.id} data-mesh-count={metrics.groups[component.id]} />
          ))}
        </div>
      )}
      <div className="viewport-footer">
        <span>PROJECT AXES: +Z = TOKAMAK +R · Z=0 PLASMA-FACING ARMOR</span>
        <span>SOURCE / DISPLAY: MM</span>
        <span>{metrics ? `${metrics.triangles.toLocaleString()} TRIANGLES · ${metrics.meshes} MESHES` : "GLB DERIVED FROM STEP"}</span>
      </div>
    </section>
  );
}
