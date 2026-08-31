"use client";

import {
  Activity,
  Boxes,
  ChartNoAxesCombined,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTwinStore } from "@/lib/twin-store";
import type { WorkspaceSection } from "@/lib/twin-types";

const items: { id: WorkspaceSection; label: string; icon: LucideIcon; unavailable?: boolean }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "design", label: "Design", icon: Boxes },
  { id: "neutronics", label: "Neutronics", icon: Activity },
  { id: "thermal-hydraulics", label: "Thermal-Hydraulics", icon: Gauge, unavailable: true },
  { id: "performance", label: "Performance", icon: ChartNoAxesCombined },
];

export function WorkspaceNav() {
  const section = useTwinStore((state) => state.section);
  const setSection = useTwinStore((state) => state.setSection);

  return (
    <nav className="workspace-nav" aria-label="Twin workspace">
      <div className="nav-label">WORKSPACE</div>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`nav-${item.id}`}
            aria-current={section === item.id ? "page" : undefined}
            aria-label={item.unavailable ? `${item.label} — dataset unavailable` : item.label}
            className={cn("nav-item", section === item.id && "nav-item-active")}
            onClick={() => setSection(item.id)}
          >
            <span className="nav-index">0{index + 1}</span>
            <Icon size={15} strokeWidth={1.7} />
            <span className="nav-text">{item.label}</span>
            {item.unavailable && <span className="nav-dot" title="Data unavailable" />}
          </button>
        );
      })}
      <div className="nav-coordinate">
        <span>VIEWER AXIS</span>
        <strong>+Z</strong>
        <small>TOKAMAK +R</small>
      </div>
    </nav>
  );
}
