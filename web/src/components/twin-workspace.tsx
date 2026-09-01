"use client";

import { useEffect } from "react";

import { ControlPanel } from "@/components/control-panel";
import { EngineeringPlot } from "@/components/engineering-plot";
import { KpiRail } from "@/components/kpi-rail";
import { BlanketViewport } from "@/components/blanket-viewport";
import { TopBar } from "@/components/top-bar";
import { WorkspaceNav } from "@/components/workspace-nav";
import { useTwinStore } from "@/lib/twin-store";

export function TwinWorkspace() {
  const initializeTwinApi = useTwinStore((state) => state.initializeTwinApi);
  const initializeScientificField = useTwinStore((state) => state.initializeScientificField);

  useEffect(() => {
    void initializeTwinApi();
    void initializeScientificField();
  }, [initializeScientificField, initializeTwinApi]);

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
