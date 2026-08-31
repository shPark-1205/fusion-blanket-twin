"use client";

import { ControlPanel } from "@/components/control-panel";
import { EngineeringPlot } from "@/components/engineering-plot";
import { KpiRail } from "@/components/kpi-rail";
import { BlanketViewport } from "@/components/blanket-viewport";
import { TopBar } from "@/components/top-bar";
import { WorkspaceNav } from "@/components/workspace-nav";

export function TwinWorkspace() {
  return (
    <main className="twin-app">
      <TopBar />
      <div className="workstation">
        <WorkspaceNav />
        <ControlPanel />
        <div className="center-stage">
          <BlanketViewport />
          <EngineeringPlot />
        </div>
        <KpiRail />
      </div>
    </main>
  );
}
