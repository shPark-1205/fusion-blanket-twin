"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { mockTwinState } from "@/lib/mock-twin-state";
import { useTwinStore } from "@/lib/twin-store";

const profileShape = [
  { x: 0, value: 15 }, { x: 10, value: 26 }, { x: 20, value: 39 }, { x: 30, value: 57 },
  { x: 40, value: 69 }, { x: 50, value: 64 }, { x: 60, value: 49 }, { x: 70, value: 41 },
  { x: 80, value: 28 }, { x: 90, value: 22 }, { x: 100, value: 13 },
];

const designTrend = [
  { x: 0, value: 34 }, { x: 1, value: 38 }, { x: 2, value: 43 }, { x: 3, value: 45 },
  { x: 4, value: 52 }, { x: 5, value: 56 }, { x: 6, value: 63 }, { x: 7, value: 67 },
  { x: 8, value: 73 }, { x: 9, value: 77 },
];

export function EngineeringPlot() {
  const section = useTwinStore((state) => state.section);
  const fieldId = useTwinStore((state) => state.activeFieldId);
  const field = mockTwinState.fields.find((item) => item.id === fieldId)!;
  const thermal = section === "thermal-hydraulics";
  const performance = section === "performance";
  const title = thermal ? "Thermal profile" : performance ? "Illustrative DOE trend" : "Illustrative radial shape";
  const data = performance ? designTrend : profileShape;

  return (
    <section className="engineering-plot">
      <div className="plot-heading">
        <div><span>{performance ? "SCALAR RESPONSE" : "AUXILIARY VIEW"}</span><h3>{title}</h3></div>
        <div className="plot-status">
          <Badge tone={thermal ? "muted" : performance ? "cyan" : "amber"}>
            {thermal ? "CFX unavailable" : "Presentation placeholder"}
          </Badge>
          <span>{performance ? "PZ / CZ DOE" : field.displayName}</span>
        </div>
      </div>
      <div className={`chart-wrap ${thermal ? "chart-disabled" : ""}`}>
        {thermal ? (
          <div className="chart-empty"><strong>--</strong><span>Dataset not connected</span></div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {performance ? (
              <LineChart data={data} margin={{ top: 8, right: 8, left: -25, bottom: -2 }}>
                <CartesianGrid stroke="rgba(125,148,164,.12)" vertical={false} />
                <XAxis dataKey="x" stroke="#52616d" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#52616d" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <Line type="monotone" dataKey="value" stroke="#35c4d2" strokeWidth={1.5} dot={{ r: 2, fill: "#0b1115", stroke: "#35c4d2" }} />
              </LineChart>
            ) : (
              <AreaChart data={data} margin={{ top: 8, right: 8, left: -25, bottom: -2 }}>
                <defs><linearGradient id="plotFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8953d" stopOpacity=".25" /><stop offset="1" stopColor="#d8953d" stopOpacity="0" /></linearGradient></defs>
                <CartesianGrid stroke="rgba(125,148,164,.12)" vertical={false} />
                <XAxis dataKey="x" stroke="#52616d" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#52616d" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                <Area type="monotone" dataKey="value" stroke="#d8953d" strokeWidth={1.5} fill="url(#plotFill)" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
        {!thermal && <span className="plot-watermark">ILLUSTRATIVE SHAPE / NO SCIENTIFIC VALUES</span>}
      </div>
    </section>
  );
}
