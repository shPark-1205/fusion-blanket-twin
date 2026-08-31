import { Activity, Atom, Database, Hexagon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { mockTwinState } from "@/lib/mock-twin-state";

export function TopBar() {
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
        <Badge tone="green"><Activity size={10} /> Presentation Ready</Badge>
        <Badge tone="muted"><Database size={10} /> Scientific 3D not connected</Badge>
        <div className="case-select" aria-label="Current representative design">
          <Hexagon size={13} />
          <span><small>REFERENCE DESIGN</small>{mockTwinState.design.caseId}</span>
        </div>
      </div>
    </header>
  );
}
