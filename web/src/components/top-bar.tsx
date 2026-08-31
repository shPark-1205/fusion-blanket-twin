"use client";

import { Activity, Atom, Database, Hexagon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTwinStore } from "@/lib/twin-store";

export function TopBar() {
  const apiStatus = useTwinStore((state) => state.apiStatus);
  const prediction = useTwinStore((state) => state.prediction);
  const statusLabel = apiStatus === "connected" ? "Twin API · Connected" : apiStatus === "offline" ? "Twin API · Offline" : "Twin API · Checking";
  return (
    <header className="top-bar">
      <div className="brand-lockup">
        <div className="brand-mark"><Atom size={19} strokeWidth={1.5} /></div>
        <div>
          <div className="brand-title">FUSION BLANKET</div>
          <div className="brand-subtitle">DIGITAL TWIN</div>
        </div>
      </div>
      <div className="top-context">
        <span className="context-kicker">ENGINEERING WORKSPACE</span>
        <span className="context-divider" />
        <span className="context-title">Solid Breeder Unit Cell</span>
      </div>
      <div className="top-status">
        <Badge tone={apiStatus === "connected" ? "green" : apiStatus === "offline" ? "amber" : "muted"} data-testid="api-status">
          <Activity size={10} /> {statusLabel}
        </Badge>
        <Badge tone="muted"><Database size={10} /> Scientific 3D not connected</Badge>
        <div className="case-select" aria-label="Nearest simulation case">
          <Hexagon size={13} />
          <span><small>NEAREST SIMULATION</small><strong data-testid="nearest-case">{prediction?.metadata.nearest_case ?? "--"}</strong></span>
        </div>
      </div>
    </header>
  );
}
