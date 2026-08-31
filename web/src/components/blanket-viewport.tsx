"use client";

import { Box, Eye, EyeOff, Focus, Layers3, Maximize2, RotateCcw, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";

function UnavailableTool({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="disabled-tool">
          <Button variant="ghost" size="icon" aria-label={`${label} — unavailable`} disabled>{children}</Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label} · Available after scientific 3D integration</TooltipContent>
    </Tooltip>
  );
}

function BlanketSchematic() {
  const selectedId = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const layers = [
    { id: "armor", x: 92, width: 45 },
    { id: "structure", x: 145, width: 68 },
    { id: "multiplier", x: 221, width: 122 },
    { id: "breeder", x: 351, width: 228 },
    { id: "coolant", x: 587, width: 101 },
  ];

  return (
    <div className="blanket-model" aria-label="Presentation preview of blanket components">
      <svg viewBox="0 0 780 420" role="img">
        <title>Conceptual layered blanket component preview; not scientific geometry</title>
        <defs>
          <pattern id="previewHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#ffffff" strokeOpacity=".06" strokeWidth="2" />
          </pattern>
        </defs>
        <g className="preview-flow" aria-hidden="true">
          <text x="34" y="190">PLASMA</text><path d="M36 210H75" />
          <text x="706" y="190">+R</text><path d="M696 210h45" />
        </g>
        <rect x="84" y="78" width="612" height="260" rx="5" className="preview-frame" />
        {layers.map((layer) => {
          const component = mockTwinState.components.find((item) => item.id === layer.id)!;
          const visible = visibility[layer.id];
          const selected = selectedId === layer.id;
          return (
            <g
              key={layer.id}
              className={cn("preview-layer", selected && "is-selected", !visible && "is-hidden")}
              role="button"
              tabIndex={0}
              aria-label={`Select ${component.label} component`}
              aria-pressed={selected}
              onClick={() => selectComponent(layer.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectComponent(layer.id);
                }
              }}
            >
              <rect x={layer.x} y="86" width={layer.width} height="244" fill={visible ? component.color : "#263139"} />
              <rect x={layer.x} y="86" width={layer.width} height="244" fill="url(#previewHatch)" />
              <text x={layer.x + layer.width / 2} y="358" textAnchor="middle">{component.label.toUpperCase()}</text>
            </g>
          );
        })}
        <g className="coolant-channels" opacity={visibility.coolant ? 1 : 0.15} aria-hidden="true">
          {[0, 1, 2].map((index) => <circle key={index} cx={612 + index * 29} cy="205" r="10" />)}
        </g>
      </svg>
      <div className="model-caption">
        <span>PRESENTATION PREVIEW</span>
        <strong>CONCEPTUAL LAYERS · NOT CAD OR FIELD DATA</strong>
      </div>
    </div>
  );
}

function ComponentControls() {
  const selectedId = useTwinStore((state) => state.selectedComponentId);
  const visibility = useTwinStore((state) => state.componentVisibility);
  const selectComponent = useTwinStore((state) => state.selectComponent);
  const toggleComponent = useTwinStore((state) => state.toggleComponent);

  return (
    <div className="component-legend" aria-label="Component selection and visibility">
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
  const section = useTwinStore((state) => state.section);
  const fieldId = useTwinStore((state) => state.activeFieldId);
  const mode = useTwinStore((state) => state.visualizationMode);
  const axis = useTwinStore((state) => state.sliceAxis);
  const log = useTwinStore((state) => state.useLogScale);
  const slicePositions = useTwinStore((state) => state.slicePositions);
  const pz = useTwinStore((state) => state.appliedPz206);
  const cz = useTwinStore((state) => state.appliedCz301);
  const field = mockTwinState.fields.find((item) => item.id === fieldId)!;
  const neutronics = section === "neutronics";
  const displaySummary = neutronics
    ? mode === "Off"
      ? `${field.displayName} · display off`
      : `${mode} · ${axis} · ${slicePositions[axis]} mm · ${log ? "Log" : "Linear"}`
    : `Applied PZ ${pz.toFixed(2)} cm · CZ ${cz.toFixed(2)} cm`;

  return (
    <section className="viewport" aria-label="Geometry presentation preview" data-testid="geometry-preview">
      <div className="viewport-header">
        <div>
          <span className="viewport-kicker"><Box size={12} /> GEOMETRY PREVIEW</span>
          <h2>Blanket Unit Cell <small>/ Conceptual component layout</small></h2>
        </div>
        <div className="viewport-state" data-testid="viewport-state">
          <span><i /> {neutronics ? field.displayName : "Local design state"}</span>
          <Badge tone={neutronics ? "amber" : "cyan"}>{neutronics ? "Mock display" : "Presentation preview"}</Badge>
        </div>
      </div>
      <TooltipProvider delayDuration={150}>
        <div className="viewport-toolbar" aria-label="Scientific viewport tools unavailable">
          <UnavailableTool label="Reset camera"><RotateCcw size={14} /></UnavailableTool>
          <UnavailableTool label="Fit assembly"><Focus size={14} /></UnavailableTool>
          <UnavailableTool label="Scientific section plane"><ScanLine size={14} /></UnavailableTool>
          <UnavailableTool label="3D component layers"><Layers3 size={14} /></UnavailableTool>
          <span className="toolbar-divider" />
          <UnavailableTool label="Fullscreen 3D viewport"><Maximize2 size={14} /></UnavailableTool>
        </div>
      </TooltipProvider>
      <BlanketSchematic />
      <div className="preview-status" data-testid="preview-status">
        <span>{displaySummary}</span>
        <small>{neutronics && mode !== "Off" ? "State only — no scientific field rendered" : "No vtk.js renderer connected"}</small>
      </div>
      <ComponentControls />
      <div className="viewport-footer">
        <span>COORDINATE CONVENTION: +Z = TOKAMAK +R</span>
        <span>DISPLAY UNITS: MM</span>
        <span>PRESENTATION ONLY</span>
      </div>
    </section>
  );
}
